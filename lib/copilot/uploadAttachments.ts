'use client'

import axios from 'axios'
import { addFiles, getPresigned, reportUploadFailure } from '@/actions/files'
import { storageErrorCode } from '@/lib/storage/browserError'
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

  const uploadFiles = await Promise.all(
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

  const metadat = uploadFiles.map((file) => ({
    name: sanitizeName(file.name),
    type: file.type,
    size: file.size,
  }))

  let presigned: Awaited<ReturnType<typeof getPresigned>>
  try {
    presigned = await getPresigned({ metadat })
  } catch (err) {
    console.error(
      '[upload] copilot.presign.fail',
      JSON.stringify({ count: metadat.length, message: trunc((err as Error)?.message) }),
    )
    throw err
  }

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
          '[upload] copilot.put.fail',
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
        void reportUploadFailure({ stage: 'put', httpStatus: e?.response?.status ?? null, code: storageErrorCode(e?.response?.data) ?? e?.code ?? null }).catch(() => undefined)
        throw err
      }
    }),
  )

  let saved: PersistedFile[]
  try {
    saved = (await addFiles({ presigned, clientId: leadId })) as PersistedFile[]
  } catch (err) {
    console.error(
      '[upload] copilot.addFiles.fail',
      JSON.stringify({ count: presigned.length, leadId, message: trunc((err as Error)?.message) }),
    )
    throw err
  }

  return limited
    .map((item, index) => toPayload(item.extracted, saved[index]))
    .filter((item): item is CopilotAttachmentPayload => Boolean(item))
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
