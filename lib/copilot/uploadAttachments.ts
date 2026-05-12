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
      if (file.size > COPILOT_MAX_FILE_BYTES) throw new Error('file-too-large')
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

  const presigned = await getPresigned({ metadat, folderPath: `${userId}/docs` })
  await Promise.all(
    presigned.map((p, index) =>
      axios.put(p.url, uploadFiles[index], {
        headers: { 'Content-Type': p.type },
      }),
    ),
  )

  const saved = (await addFiles({ presigned, clientId: leadId })) as PersistedFile[]

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
