import {
  COPILOT_ATTACHMENT_PER_FILE_CHAR_CAP,
  COPILOT_MAX_ATTACHMENTS,
  COPILOT_MAX_LENSES,
  COPILOT_MAX_QUESTION_CHARS,
  COPILOT_MIN_QUESTION_CHARS,
  type CopilotAttachmentPayload,
} from '@/lib/copilot/attachments'
import { isLensId, type LensId } from '@/lib/ai/prompts/leadAskQuestion'

/* ─────────────────────────── Question + lenses ─────────────────────────── */

export function normalizeQuestion(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  if (trimmed.length < COPILOT_MIN_QUESTION_CHARS || trimmed.length > COPILOT_MAX_QUESTION_CHARS) return null
  return trimmed
}

export function normalizeLenses(raw: unknown): LensId[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<LensId>()
  for (const v of raw) {
    if (typeof v === 'string' && isLensId(v)) seen.add(v)
    if (seen.size >= COPILOT_MAX_LENSES) break
  }
  return Array.from(seen)
}

/* ─────────────────────────── Attachment payloads ────────────────────────── */

export function normalizeAttachmentPayloads(raw: unknown): CopilotAttachmentPayload[] {
  if (!Array.isArray(raw)) return []

  const out: CopilotAttachmentPayload[] = []
  const seen = new Set<number>()

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const value = item as Record<string, unknown>
    const fileId = Number(value.fileId)
    if (!Number.isFinite(fileId) || fileId <= 0 || seen.has(fileId)) continue

    const name = normalizeString(value.name, 180)
    const mediaType = normalizeString(value.mediaType, 120)
    const size = Number(value.size)
    if (!name || !mediaType || !Number.isFinite(size) || size < 0) continue

    if (value.kind === 'text') {
      const content = normalizeString(value.content, COPILOT_ATTACHMENT_PER_FILE_CHAR_CAP)
      const originalChars = Number(value.originalChars)
      if (!content) continue
      out.push({
        kind: 'text',
        fileId,
        name,
        mediaType,
        size,
        content,
        truncated: value.truncated === true,
        originalChars: Number.isFinite(originalChars) && originalChars >= content.length ? originalChars : content.length,
      })
      seen.add(fileId)
    } else if (value.kind === 'image') {
      out.push({ kind: 'image', fileId, name, mediaType, size })
      seen.add(fileId)
    } else if (value.kind === 'unreadable') {
      const reason = normalizeUnreadableReason(value.reason)
      out.push({ kind: 'unreadable', fileId, name, mediaType, size, reason })
      seen.add(fileId)
    }

    if (out.length >= COPILOT_MAX_ATTACHMENTS) break
  }

  return out
}

function normalizeString(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

function normalizeUnreadableReason(raw: unknown): Extract<CopilotAttachmentPayload, { kind: 'unreadable' }>['reason'] {
  if (raw === 'unsupported-type' || raw === 'extraction-failed' || raw === 'empty-text') return raw
  return 'extraction-failed'
}
