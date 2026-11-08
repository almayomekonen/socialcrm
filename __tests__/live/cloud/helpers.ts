import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { S3Client, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3'
import { vi } from 'vitest'
import { assertHebrewFontsEmbedded, parsePdfFonts } from './pdfFonts'

const sh = promisify(execFile)

type Stored = { Body: Uint8Array; Metadata?: Record<string, string>; ContentType?: string }
export function installDryBucket() {
  const bucket = new Map<string, Stored>()
  ;(globalThis as unknown as { __dryBucket: Map<string, Stored> }).__dryBucket = bucket
  vi.spyOn(S3Client.prototype, 'send').mockImplementation((async (c: { input: { Key?: string; Prefix?: string; Body?: Uint8Array; Metadata?: Record<string, string>; ContentType?: string } }) => {
    const key = c.input.Key ?? ''
    if (c instanceof PutObjectCommand) return bucket.set(key, { Body: c.input.Body as Uint8Array, Metadata: c.input.Metadata, ContentType: c.input.ContentType }), {}
    if (c instanceof HeadObjectCommand) {
      const o = bucket.get(key)
      if (!o) throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } })
      return { ContentLength: o.Body.byteLength, ContentType: o.ContentType, Metadata: o.Metadata }
    }
    if (c instanceof GetObjectCommand) return { Body: { transformToByteArray: async () => bucket.get(key)!.Body } }
    if (c instanceof DeleteObjectCommand) return bucket.delete(key), {}
    if (c instanceof ListObjectsV2Command) return { Contents: [...bucket.keys()].filter((k) => k.startsWith(c.input.Prefix ?? '')).map((Key) => ({ Key, Size: 1 })) }
    throw new Error(`dry bucket: unexpected ${c.constructor.name}`)
  }) as never)
}

/** Reads a stored PDF with poppler. Every PDF read here must carry the embedded Hebrew font. */
export async function pdfText(bytes: Uint8Array) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quote-cloud-read-'))
  try {
    const f = path.join(dir, 'q.pdf')
    writeFileSync(f, bytes)
    const [text, fonts, info] = await Promise.all([sh('pdftotext', [f, '-']), sh('pdffonts', [f]), sh('pdfinfo', [f])])
    assertHebrewFontsEmbedded(parsePdfFonts(fonts.stdout))
    return { text: text.stdout, pages: Number(/Pages:\s+(\d+)/.exec(info.stdout)?.[1] ?? 0) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Both names a Content-Disposition header carries. */
export function filenameFrom(header: string | null): { utf8: string; ascii: string } {
  const utf8 = /filename\*=UTF-8''([^;]+)/.exec(header ?? '')?.[1]
  const ascii = /filename="([^"]*)"/.exec(header ?? '')?.[1]
  if (!utf8 || !ascii) throw new Error(`no filename in Content-Disposition: ${header}`)
  return { utf8: decodeURIComponent(utf8), ascii }
}
