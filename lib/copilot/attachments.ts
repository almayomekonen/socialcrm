import { MAX_UPLOAD_BYTES } from '@/lib/storage/policy'

export const COPILOT_MAX_QUESTION_CHARS = 500
export const COPILOT_MIN_QUESTION_CHARS = 3
export const COPILOT_MAX_LENSES = 4

export const COPILOT_ATTACHMENT_PER_FILE_CHAR_CAP = 30_000
export const COPILOT_ATTACHMENT_TOTAL_CHAR_CAP = 60_000
export const COPILOT_MAX_ATTACHMENTS = 5
export const COPILOT_MAX_FILE_BYTES = MAX_UPLOAD_BYTES

export type CopilotAttachmentPayload =
  | {
      kind: 'text'
      fileId: number
      name: string
      mediaType: string
      size: number
      content: string
      truncated: boolean
      originalChars: number
    }
  | {
      kind: 'image'
      fileId: number
      name: string
      mediaType: string
      size: number
    }
  | {
      kind: 'unreadable'
      fileId: number
      name: string
      mediaType: string
      size: number
      reason: 'unsupported-type' | 'extraction-failed' | 'empty-text'
    }

export function isCopilotImageMime(type: string | null | undefined): boolean {
  return ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes((type ?? '').toLowerCase())
}

export function isCopilotTextMime(type: string | null | undefined): boolean {
  const t = (type ?? '').toLowerCase()
  return (
    t === 'application/pdf' ||
    t === 'application/vnd.ms-excel' ||
    t === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )
}

export function inferCopilotMediaType(name: string, type: string | null | undefined): string {
  if (type && type.trim()) return type
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'xls') return 'application/vnd.ms-excel'
  if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  return ''
}
