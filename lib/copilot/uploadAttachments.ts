'use client'

import axios from 'axios'
import { addFiles, getPresigned } from '@/actions/files'
import { convertToWebP } from '@/lib/funcs'
import type { ExtractedAttachment } from './clientExtract'
import {
  COPILOT_MAX_ATTACHMENTS,
  COPILOT_MAX_FILE_BYTES,
  inferCopilotMediaType,
  type CopilotAttachmentPayload,
} from './attachments'

export type LocalCopilotAttachment = {
  file: File
  extracted: ExtractedAttachment
}

type PersistedFile = {
  id: number
  name?: string
  type?: string
  size?: number
}

// Truncate untrusted error strings before logging. Avoids dumping multi-KB
// SDK payloads into the browser console / Vercel logs.
function trunc(s: unknown, n = 200): string {
  const v = typeof s === 'string' ? s : String(s ?? '')
  return v.length > n ? v.slice(0, n) + '…' : v
}

export async function uploadCopilotAttachments({
  items,
  leadId,
  userId,
}: {
  items: LocalCopilotAttachment[]
  leadId: number
  userId: number
}): Promise<CopilotAttachmentPayload[]> {
  const limited = items.slice(0, COPILOT_MAX_ATTACHMENTS)
  if (limited.length === 0) return []

  console.info(
    '[upload] copilot.start',
    JSON.stringify({
      surface: 'copilot',
      requested: items.length,
      accepted: limited.length,
      leadId,
      totalBytes: limited.reduce((sum, i) => sum + (i.file?.size ?? 0), 0),
    }),
  )

  let uploadFiles: File[]
  try {
    uploadFiles = await Promise.all(
      limited.map(async ({ file }) => {
        if (file.size > COPILOT_MAX_FILE_BYTES) {
          console.warn(
            '[upload] copilot.prepare.fail',
            JSON.stringify({ reason: 'file-too-large', size: file.size, max: COPILOT_MAX_FILE_BYTES }),
          )
          throw new Error('file-too-large')
        }
        const mediaType = inferCopilotMediaType(file.name, file.type)
        const normalized = mediaType && mediaType !== file.type ? new File([file], file.name, { type: mediaType }) : file
        return mediaType.startsWith('image') ? convertToWebP(normalized) : normalized
      }),
    )
  } catch (err) {
    console.error(
      '[upload] copilot.prepare.fail',
      JSON.stringify({ reason: 'throw', message: trunc((err as Error)?.message) }),
    )
    throw err
  }

  const metadat = uploadFiles.map((file) => ({
    name: sanitizeName(file.name),
    type: file.type,
    size: file.size,
  }))
  const mimeCounts = metadat.reduce<Record<string, number>>((acc, m) => {
    acc[m.type] = (acc[m.type] ?? 0) + 1
    return acc
  }, {})
  console.info(
    '[upload] copilot.prepared',
    JSON.stringify({
      count: metadat.length,
      mimeCounts,
      totalBytes: metadat.reduce((s, m) => s + m.size, 0),
    }),
  )

  let presigned: Awaited<ReturnType<typeof getPresigned>>
  try {
    presigned = await getPresigned({ metadat, folderPath: `${userId}/docs` })
    console.info('[upload] copilot.presign.ok', JSON.stringify({ count: presigned.length }))
  } catch (err) {
    console.error(
      '[upload] copilot.presign.fail',
      JSON.stringify({ count: metadat.length, message: trunc((err as Error)?.message) }),
    )
    throw err
  }

  // Track each PUT individually so we know which file/index failed, the HTTP
  // status from S3, and whether the URL even reached the network layer.
  await Promise.all(
    presigned.map(async (p, index) => {
      const startedAt = Date.now()
      try {
        await axios.put(p.url, uploadFiles[index], {
          headers: { 'Content-Type': p.type },
        })
      } catch (err) {
        const e = err as {
          response?: { status?: number; statusText?: string; data?: unknown }
          code?: string
          message?: string
        }
        console.error(
          '[upload] copilot.s3.put.fail',
          JSON.stringify({
            index,
            size: uploadFiles[index]?.size ?? null,
            mime: p.type,
            httpStatus: e?.response?.status ?? null,
            httpStatusText: trunc(e?.response?.statusText, 80),
            code: e?.code ?? null,
            message: trunc(e?.message),
            latencyMs: Date.now() - startedAt,
          }),
        )
        throw err
      }
    }),
  )
  console.info('[upload] copilot.s3.put.ok', JSON.stringify({ count: presigned.length }))

  let saved: PersistedFile[]
  try {
    saved = (await addFiles({ presigned, clientId: leadId })) as PersistedFile[]
    console.info('[upload] copilot.addFiles.ok', JSON.stringify({ count: saved.length, leadId }))
  } catch (err) {
    console.error(
      '[upload] copilot.addFiles.fail',
      JSON.stringify({ count: presigned.length, leadId, message: trunc((err as Error)?.message) }),
    )
    throw err
  }

  const payloads = limited
    .map((item, index) => toPayload(item.extracted, saved[index]))
    .filter((item): item is CopilotAttachmentPayload => Boolean(item))

  console.info(
    '[upload] copilot.done',
    JSON.stringify({ requested: items.length, persisted: saved.length, payloads: payloads.length }),
  )
  return payloads
}

function toPayload(extracted: ExtractedAttachment, persisted?: PersistedFile): CopilotAttachmentPayload | null {
  if (!persisted?.id) return null

  const base = {
    fileId: Number(persisted.id),
    name: persisted.name || extracted.name,
    mediaType: persisted.type || extracted.mediaType,
    size: typeof persisted.size === 'number' ? persisted.size : extracted.size,
  }

  if (extracted.kind === 'text') {
    if (extracted.content.trim().length === 0) {
      return { kind: 'unreadable', ...base, reason: 'empty-text' }
    }
    return {
      kind: 'text',
      ...base,
      content: extracted.content,
      truncated: extracted.truncated,
      originalChars: extracted.originalChars,
    }
  }

  if (extracted.kind === 'image') {
    return { kind: 'image', ...base }
  }

  return { kind: 'unreadable', ...base, reason: extracted.reason }
}

function sanitizeName(name: string) {
  return name.replaceAll(/[^a-zA-Z0-9\u0590-\u05FF_-\s.]/g, '').replaceAll(' ', '_')
}
