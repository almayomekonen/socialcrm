/**
 * The thread projection: inbox_messages row → the safe client shape.
 *
 * Extracted from db/inboxMessages.ts (which exceeded the architecture-rules
 * hard limit) without behaviour change. Pure: no data access. Everything the
 * browser may see about a message is decided here, once, on the server.
 */
import { isHumanOutbound } from '@/lib/inbox/humanReply'
import { failureTextForCategory, normalizeFailureCategory, type WhatsappErrorCategory } from '@/lib/inbox/whatsappErrorCopy'
import type { InboxMessageDirection, InboxMessageStatus, InboxMessageType } from '@/db/inboxMessages'
import { messageRefsForRow, type MessageReaction, type MessageReplyTo } from '@/db/inboxMessageRefs'

/**
 * The ONLY attachment shape a client ever sees.
 *
 * Deliberately excludes the WhatsApp media id, Meta's media `url`, `sha256` and
 * the raw payload. The media id is the capability to fetch the file; it stays
 * server-side and is re-derived by the download route from the message row, so
 * a leaked client payload can never be replayed against Graph.
 */
export type InboxMessageAttachment = {
  filename: string | null
  mimeType: string | null
}

/** Message types that can carry a fetchable media file. */
export const ATTACHMENT_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'document',
  'image',
  'audio',
  'video',
  'sticker',
])

const MAX_FILENAME_CHARS = 120

/**
 * A customer controls this string. Stripping CR/LF and control characters here
 * — not only at the response — is what stops a filename like
 * `x.pdf\r\nSet-Cookie: …` from becoming a header injection downstream.
 */
export function sanitizeAttachmentFilename(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const cleaned = raw.replace(/[\r\n\t\u0000-\u001F\u007F]/g, '').trim()
  return cleaned ? cleaned.slice(0, MAX_FILENAME_CHARS) : null
}

/** Accept only a well-formed `type/subtype`; parameters (`; charset=…`) dropped. */
export function sanitizeAttachmentMime(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const bare = raw.split(';')[0].trim().toLowerCase()
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(bare) ? bare : null
}

/**
 * Row payload → the safe client shape. Returns null unless the message is a
 * supported media type AND carries a media id, because without an id the file
 * can never be fetched and an "open" action would be a lie.
 */
export function toSafeAttachment(type: unknown, payload: unknown): InboxMessageAttachment | null {
  if (typeof type !== 'string' || !ATTACHMENT_MEDIA_TYPES.has(type)) return null
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const p = payload as Record<string, unknown>
  const mediaId = typeof p.id === 'string' ? p.id.trim() : ''
  if (!mediaId) return null
  return {
    filename: sanitizeAttachmentFilename(p.filename),
    mimeType: sanitizeAttachmentMime(p.mime_type),
  }
}

export type LeadWhatsappMessage = {
  id: number
  direction: InboxMessageDirection
  type: InboxMessageType
  text: string
  timestamp: string
  /** Real delivery state. Outbound `sent` means Meta ACCEPTED it, not that it arrived. */
  status: InboxMessageStatus
  /** Rep-facing Hebrew, resolved server-side. Non-null only when status is 'failed'. */
  failureText: string | null
  /** Allowlisted failure category (the persisted errorReason key). Null unless failed. */
  failureCategory: WhatsappErrorCategory | null
  /** Safe media metadata for an inbound file. Null for text and unsupported types. */
  attachment: InboxMessageAttachment | null
  /**
   * Outbound only: was this sent by a PERSON (SocialCRM or the WhatsApp Business
   * app) rather than the AI, the questionnaire or an automation? See
   * lib/inbox/humanReply.ts. Absent on inbound rows and on older projections.
   */
  byPerson?: boolean
  /** A media caption (image, video, document), sanitized. Absent when there is none. `text` is unchanged. */
  caption?: string
  /** Reaction rows only: the emoji (null = removed) and the message it reacts to, if in this thread. */
  reaction?: MessageReaction
  /** A reply quoting another message; `targetId` null when the quoted message is not in this thread. */
  replyTo?: MessageReplyTo
}

/** Compact status projection for the sync delta (status changes mutate old rows). */
export type LeadWhatsappMessageStatus = {
  id: number
  status: InboxMessageStatus
  failureText: string | null
  failureCategory: WhatsappErrorCategory | null
}

/** Columns every thread read selects. One list so the three readers cannot drift. */
export const LEAD_MESSAGE_COLUMNS = [
  'm.id',
  'm.direction',
  'm.type',
  'm.text',
  'm.payload',
  'm.status',
  'm.errorReason',
  'm.channelTimestamp',
  'm.createdAt',
  'm.metadata',
  'm.sentByUserId',
] as const

function toIso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : v ? String(v) : ''
}

/** Rep-facing failure copy for a row, resolved once, server-side. Null unless failed. */
export function failureTextForRow(status: InboxMessageStatus, errorReason: unknown): string | null {
  return status === 'failed' ? failureTextForCategory((errorReason as string | null) ?? 'generic') : null
}

/** Allowlisted failure category for a row (errorReason IS the key). Null unless failed. */
export function failureCategoryForRow(status: InboxMessageStatus, errorReason: unknown): WhatsappErrorCategory | null {
  return status === 'failed' ? normalizeFailureCategory(errorReason as string | null) : null
}

/**
 * The single row → LeadWhatsappMessage mapper.
 *
 * Every read path goes through this. Failure copy is resolved HERE, on the
 * server, because a Client Component must render a decision, not make one
 * (architecture-rules §11) — and because three copies of this mapping is how
 * first paint and the poller drift apart.
 */
export function mapLeadWhatsappMessageRow(r: Record<string, unknown>): LeadWhatsappMessage {
  const status = r.status as InboxMessageStatus
  return {
    id: Number(r.id),
    direction: r.direction as InboxMessageDirection,
    type: r.type as InboxMessageType,
    text: (r.text as string) ?? '',
    timestamp: toIso(r.channelTimestamp ?? r.createdAt),
    status,
    failureText: failureTextForRow(status, r.errorReason),
    failureCategory: failureCategoryForRow(status, r.errorReason),
    attachment: toSafeAttachment(r.type, r.payload),
    ...(r.direction === 'outbound'
      ? {
          byPerson: isHumanOutbound({
            source: (r.metadata as { source?: string } | null)?.source ?? null,
            sentByUserId: r.sentByUserId == null ? null : Number(r.sentByUserId),
            status,
          }),
        }
      : {}),
    ...messageRefsForRow(r),
  }
}
