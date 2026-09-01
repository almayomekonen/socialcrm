/**
 * Pure display helpers for inbound WhatsApp media. No React, no data access —
 * both the desktop thread and the mobile bubble import these so the two
 * surfaces cannot drift in what they call a file or how they label it.
 */

/** Shown instead of an empty bubble for a message we cannot render yet. */
export const UNSUPPORTED_MESSAGE_NOTICE = 'הודעה מסוג שאינו נתמך עדיין'

/** Shown when a file arrived without a filename. */
export const UNNAMED_ATTACHMENT_LABEL = 'קובץ מוואטסאפ'

const KIND_BY_MIME: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/msword': 'Word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.ms-excel': 'Excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
}

/**
 * Short, human label for the file type. Falls back to the mime top-level group
 * so an unknown subtype still says something true rather than nothing.
 */
export function fileKindLabel(mimeType: string | null | undefined): string | null {
  if (!mimeType) return null
  const exact = KIND_BY_MIME[mimeType]
  if (exact) return exact
  const [group, subtype] = mimeType.split('/')
  if (group === 'image') return 'תמונה'
  if (group === 'audio') return 'הקלטה'
  if (group === 'video') return 'וידאו'
  return subtype ? subtype.toUpperCase().slice(0, 12) : null
}

/** Authenticated download path for a message's media. */
export function attachmentHref(messageId: number): string {
  return `/api/whatsapp/media/${messageId}`
}
