import { db } from '@/config/db'
import { s3PublicUrl } from '@/config/s3'
import {
  COPILOT_ATTACHMENT_PER_FILE_CHAR_CAP,
  COPILOT_ATTACHMENT_TOTAL_CHAR_CAP,
  type CopilotAttachmentPayload,
  isCopilotImageMime,
  isCopilotTextMime,
} from '@/lib/copilot/attachments'
import type { LeadQuestionAttachmentContext } from '@/lib/ai/prompts/leadAskQuestion'
import type { RunStructuredImageAttachment } from '@/lib/ai/router'

/**
 * Loads file rows for the given attachment payloads, applies per-file +
 * total char caps, and produces the prompt-side attachment context plus the
 * separate image-attachment list the router needs. Mirrors the original
 * inline helper extracted from leadAskQuestion.ts unchanged.
 */
export async function hydrateAttachments({
  rawAttachments,
  leadId,
  agencyId,
}: {
  rawAttachments: CopilotAttachmentPayload[]
  leadId: number
  agencyId: number
}): Promise<{ promptAttachments: LeadQuestionAttachmentContext[]; imageAttachments: RunStructuredImageAttachment[] }> {
  if (rawAttachments.length === 0) return { promptAttachments: [], imageAttachments: [] }

  const ids = rawAttachments.map((item) => item.fileId)
  const rows = await db('files')
    .whereIn('id', ids)
    .where({ agencyId, clientId: leadId })
    .select('id', 'name', 'type', 'size', 'path')

  const byId = new Map<number, { id: number; name: string; type: string; size: number; url: string | null }>()
  for (const row of rows) {
    const path = row.path ? String(row.path) : null
    byId.set(Number(row.id), {
      id: Number(row.id),
      name: String(row.name ?? ''),
      type: String(row.type ?? ''),
      size: Number(row.size ?? 0),
      url: path ? `${s3PublicUrl}${path}` : null,
    })
  }

  const promptAttachments: LeadQuestionAttachmentContext[] = []
  const imageAttachments: RunStructuredImageAttachment[] = []
  let remainingChars = COPILOT_ATTACHMENT_TOTAL_CHAR_CAP

  for (const attachment of rawAttachments) {
    const file = byId.get(attachment.fileId)
    if (!file) continue

    const base = {
      name: file.name || attachment.name,
      mediaType: file.type || attachment.mediaType,
      size: Number.isFinite(file.size) && file.size > 0 ? file.size : attachment.size,
    }

    if (attachment.kind === 'text') {
      if (!isCopilotTextMime(base.mediaType)) continue
      if (remainingChars <= 0) {
        promptAttachments.push({ kind: 'unreadable', ...base, reason: 'total-limit' })
        continue
      }

      const perFileContent = attachment.content.slice(0, COPILOT_ATTACHMENT_PER_FILE_CHAR_CAP)
      const content = perFileContent.slice(0, remainingChars)
      const partial =
        attachment.truncated || attachment.content.length > content.length || attachment.originalChars > content.length

      remainingChars -= content.length
      promptAttachments.push({
        kind: 'text',
        ...base,
        content,
        partial,
        originalChars: attachment.originalChars,
      })
      continue
    }

    if (attachment.kind === 'image') {
      if (!isCopilotImageMime(base.mediaType) || !file.url || !isHttpUrl(file.url)) continue
      promptAttachments.push({ kind: 'image', ...base })
      imageAttachments.push({ url: file.url, mediaType: base.mediaType, name: base.name })
      continue
    }

    promptAttachments.push({ kind: 'unreadable', ...base, reason: attachment.reason })
  }

  return { promptAttachments, imageAttachments }
}

function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
