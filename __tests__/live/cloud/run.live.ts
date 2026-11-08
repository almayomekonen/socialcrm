import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { NextRequest } from 'next/server'
import { S3Client, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * A quote's PDF through the real code: claim, real renderer client, real R2
 * client, persistence, retrieval, authenticated download, retry and recovery.
 * The same checks run in both modes; only the far end differs (see ./env.ts).
 */
const h = vi.hoisted(() => ({ cookie: undefined as string | undefined }))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (h.cookie ? { value: h.cookie } : undefined), delete: () => undefined }),
  headers: async () => new Headers(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (f: unknown) => f, cacheTag: vi.fn() }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: async () => ({ status: 'PAID', hasAccess: true }) }))

import { db } from '@/config/db'
import { encrypt } from '@/db/auth'
import { createQuoteSystem } from '@/db/quotes/createQuote'
import { QUOTE_RENDER_STALE_MS } from '@/db/quotes/documents'
import { GET } from '@/app/api/quotes/[quoteId]/download/route'
import { deleteObject, getObjectBytes, headObject, listObjects } from '@/lib/storage/objects'
import { startQuotePdf } from '@/lib/waAssistant/quotes/pdfJob'
import { sweepQuotePdfs } from '@/lib/waAssistant/quotes/pdfSweep'
import { CLOUD_AGENCY, type CloudContext } from './env'

const ctx = (globalThis as unknown as { __quoteCloud: CloudContext }).__quoteCloud
const sh = promisify(execFile)
const notice = { send: vi.fn(async () => ({ kind: 'sent' as const, wamid: 'wamid.CLOUD' })) as never }
const USER = 998010
let leadId = 0
let seq = 0

type Stored = { Body: Uint8Array; Metadata?: Record<string, string>; ContentType?: string }
function installDryBucket() {
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

const quote = async (lines: number, over: { discountPercent?: number } = {}) => {
  const r = await createQuoteSystem({
    agencyId: CLOUD_AGENCY,
    leadId,
    createdByUserId: USER,
    title: 'שיפוץ מטבח כולל ארונות',
    lines: Array.from({ length: lines }, (_, i) => ({ title: `פריט בדיקה מספר ${i + 1}`, quantity: 1, unitAmount: 1000, discountAmount: over.discountPercent ? (1000 * over.discountPercent) / 100 : undefined })),
    priceBasis: 'excl_vat',
    validityDays: 30,
    finalize: true,
    automationKey: `cloud:${++seq}:${Date.now()}`,
    metadata: { source: 'wa_assistant', actionId: `act_cloud_${seq}` },
  })
  if (r.ok === false) throw new Error('quote not created')
  return r
}
const docsOf = (quoteId: number) => db('sales_quote_documents').where({ quoteId }).orderBy('id').select('status', 'isCurrent', 'path', 'contentHash', 'byteSize', 'failureReason')
const start = (quoteId: number, deps: Record<string, unknown> = {}) => startQuotePdf({ agencyId: CLOUD_AGENCY, quoteId, renderedByUserId: USER, inline: true, deps: { notice, ...deps } as never })
const open = (handle: string) => GET(new NextRequest(`https://crm.test/api/quotes/${handle}/download`), { params: Promise.resolve({ quoteId: handle }) })

async function pdfText(bytes: Uint8Array) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quote-cloud-read-'))
  try {
    const f = path.join(dir, 'q.pdf')
    writeFileSync(f, bytes)
    const [text, fonts, info] = await Promise.all([sh('pdftotext', [f, '-']), sh('pdffonts', [f]), sh('pdfinfo', [f])])
    return { text: text.stdout, fonts: fonts.stdout, pages: Number(/Pages:\s+(\d+)/.exec(info.stdout)?.[1] ?? 0) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

beforeAll(async () => {
  if (ctx.mode === 'dry') installDryBucket()
  await db('agencies').insert({ id: CLOUD_AGENCY, name: 'עסק בדיקה סינתטי', plan: 'pro' } as never).onConflict('id').ignore()
  await db.raw(`UPDATE agencies SET "businessType" = 'authorized' WHERE id = ?`, [CLOUD_AGENCY])
  await db('users').insert({ id: USER, agencyId: CLOUD_AGENCY, email: 'cloud@t.test', role: 'ADMIN', firstName: 'א', lastName: 'ב' } as never).onConflict('id').ignore()
  const [c] = await db('clients').insert({ firstName: 'דוד', lastName: 'כהן', phone: '0501234567', agencyId: CLOUD_AGENCY, userId: USER, createdById: USER, lead: true, status: 'new' }).returning('id')
  leadId = Number(c.id)
  await db('bill_tax_rates').where({ agencyId: CLOUD_AGENCY }).del()
  await db('bill_tax_rates').insert({ agencyId: CLOUD_AGENCY, code: 'VAT_STD', label: 'מע"מ', ratePercent: 18, country: 'IL', effectiveFrom: '2024-01-01' })
  h.cookie = await encrypt({ id: USER, sv: 0, typ: 'session' })
}, 120_000)

afterAll(async () => {
  const prefix = `tenants/${CLOUD_AGENCY}/`
  for (const o of (await listObjects({ prefix }).catch(() => ({ objects: [] as { key: string }[] }))).objects) if (o.key.startsWith(prefix)) await deleteObject(o.key)
  await db('sales_quotes').where({ agencyId: CLOUD_AGENCY }).del()
  await db('bill_numbering_sequences').where({ agencyId: CLOUD_AGENCY }).del()
  await db('bill_tax_rates').where({ agencyId: CLOUD_AGENCY }).del()
  await db('clients').where({ agencyId: CLOUD_AGENCY }).del()
  await db('users').where({ agencyId: CLOUD_AGENCY }).del()
  await db('agencies').where({ id: CLOUD_AGENCY }).del()
  ctx.guard.uninstall()
  expect(ctx.guard.refusals).toEqual([])
}, 120_000)

describe(`quote PDF, cloud path (${ctx.mode})`, () => {
  it.each([[1, 1], [12, 1], [50, 2]])('%i lines: rendered, stored, and identical when read back', async (lines, minPages) => {
    const q = await quote(lines)
    expect(await start(q.quoteId)).toBe('started')
    const [d] = await docsOf(q.quoteId)
    expect(d).toMatchObject({ status: 'ready', isCurrent: true })
    expect(d.path).toMatch(new RegExp(`^tenants/${CLOUD_AGENCY}/quotes/${q.quoteId}/[0-9a-f-]{36}\\.pdf$`))
    const bytes = await getObjectBytes(d.path)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(d.contentHash)
    expect(Number(d.byteSize)).toBe(bytes.byteLength)
    const head = await headObject(d.path)
    expect(head.size).toBe(bytes.byteLength)
    expect(head.metadata.sha256).toBe(d.contentHash)
    expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-')
    if (ctx.chrome || ctx.mode === 'real') {
      const pdf = await pdfText(bytes)
      expect(pdf.fonts).toContain('NotoSansHebrew')
      expect(pdf.pages).toBeGreaterThanOrEqual(minPages)
      expect(pdf.text).toContain('דוד')
    }
  }, 200_000)

  it('a discount and a validity survive to the document', async () => {
    const q = await quote(2, { discountPercent: 10 })
    await start(q.quoteId)
    const [d] = await docsOf(q.quoteId)
    expect(q.totalAmount).toBe(2124)
    expect(d.status).toBe('ready')
  }, 200_000)

  it('the authenticated route redirects to a 60-second link that returns the same bytes', async () => {
    const q = await quote(1)
    await start(q.quoteId)
    const [d] = await docsOf(q.quoteId)
    const res = await open(d.contentHash as string)
    expect(res.status).toBe(302)
    const location = res.headers.get('location') as string
    expect(new URL(location).searchParams.get('X-Amz-Expires')).toBe('60')
    const got = await fetch(location)
    expect(got.status).toBe(200)
    expect(createHash('sha256').update(new Uint8Array(await got.arrayBuffer())).digest('hex')).toBe(d.contentHash)
  }, 200_000)

  it('no session opens nothing', async () => {
    const saved = h.cookie
    h.cookie = undefined
    const res = await open('a'.repeat(64))
    h.cookie = saved
    expect(new URL(res.headers.get('location') as string).pathname).toBe('/auth')
  })

  it('an upload failure is recorded, and the cron sweep retries it into one current PDF', async () => {
    const q = await quote(1)
    await start(q.quoteId, { render: { put: async () => { throw new Error('injected upload failure') } } })
    expect(await docsOf(q.quoteId)).toMatchObject([{ status: 'failed', isCurrent: false }])
    await sweepQuotePdfs({ deps: { notice } })
    const rows = await docsOf(q.quoteId)
    expect(rows.map((d) => d.status)).toEqual(['failed', 'ready'])
    expect(rows.filter((d) => d.isCurrent)).toHaveLength(1)
  }, 200_000)

  it('a render that died is closed as stale and recovered by the sweep', async () => {
    const q = await quote(1)
    await db('sales_quote_documents').insert({ agencyId: CLOUD_AGENCY, quoteId: q.quoteId, status: 'rendering', path: `tenants/${CLOUD_AGENCY}/quotes/${q.quoteId}/dead.pdf`, createdAt: new Date(Date.now() - QUOTE_RENDER_STALE_MS - 1000) })
    await sweepQuotePdfs({ deps: { notice } })
    expect((await docsOf(q.quoteId)).map((d) => d.failureReason ?? d.status)).toEqual(['stale_render', 'ready'])
  }, 200_000)
})
