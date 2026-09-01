import type { Knex } from 'knex'
import { db } from '@/config/db'
import { getUser } from '@/db/auth'
import { failureTextForCategory, normalizeFailureCategory, type WhatsappErrorCategory } from '@/lib/inbox/whatsappErrorCopy'
import { messageTimelineOrderSql, notHistorySql } from '@/lib/inbox/messageTimeline'

export type InboxMessageDirection = 'inbound' | 'outbound'
export type InboxMessageStatus = 'received' | 'sent' | 'delivered' | 'read' | 'failed'
export type InboxMessageType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'sticker'
  | 'location'
  | 'contacts'
  | 'interactive'
  | 'button'
  | 'reaction'
  | 'system'
  | 'unknown'

export type InsertInboundMessageInput = {
  conversationId: number
  agencyId: number
  leadId: number | null
  channel: 'whatsapp'
  externalId: string | null
  fromId: string | null
  toId: string | null
  type: InboxMessageType
  text: string
  payload: Record<string, unknown>
  rawPayload: unknown
  channelTimestamp: Date | null
}

export type InsertMessageResult = {
  id: number
  inserted: boolean
  sequence: number
}

export type InsertOutboundMessageInput = {
  conversationId: number
  agencyId: number
  leadId: number | null
  channel: 'whatsapp'
  externalId: string | null
  fromId: string | null
  toId: string | null
  text: string
  /**
   * The user who sent it, or NULL for a message the SYSTEM sent — an automation.
   * The column has always been nullable (`REFERENCES users(id) ON DELETE SET
   * NULL`); only this type forbade it, and an automation has no user to name.
   *
   * The null is load-bearing, not a shrug: the instant-response engine
   * distinguishes "any outbound" from "a human replied" by exactly this column
   * being non-null. Attributing an automation to the lead's owner would tell it
   * a person answered when nobody did, and silence a reply that should happen.
   */
  sentByUserId: number | null
  channelTimestamp: Date | null
  /**
   * Media type and metadata for an outbound message the BUSINESS sent as a file.
   *
   * Optional, defaulting to a plain text message, so every existing caller is
   * behaviourally unchanged. It exists because a Coexistence echo of a file used
   * to arrive fully parsed and then be flattened to `type: 'text'` with an empty
   * payload here — the media id was destroyed at insert, and the thread rendered
   * the file as "—" with nothing left to recover.
   */
  type?: InboxMessageType
  payload?: Record<string, unknown>
}

type InsertChannelMessageInput = {
  conversationId: number
  agencyId: number
  leadId: number | null
  channel: 'whatsapp'
  direction: InboxMessageDirection
  status: InboxMessageStatus
  externalId: string | null
  fromId: string | null
  toId: string | null
  type: InboxMessageType
  text: string
  payload: Record<string, unknown>
  rawPayload: unknown
  channelTimestamp: Date | null
  sentByUserId: number | null
  errorReason?: string | null
}

async function insertChannelMessage(trx: Knex.Transaction, input: InsertChannelMessageInput): Promise<InsertMessageResult> {
  const conv = await trx('inbox_conversations').where({ id: input.conversationId }).forUpdate().first('id')
  if (!conv) throw new Error('inbox_messages.insert.conversation_not_found')

  const maxRow = await trx('inbox_messages')
    .where({ conversationId: input.conversationId })
    .max<{ max: string | number | null }>('sequence as max')
    .first()
  const sequence = (Number(maxRow?.max) || 0) + 1

  const rows = await trx('inbox_messages')
    .insert({
      conversationId: input.conversationId,
      agencyId: input.agencyId,
      leadId: input.leadId,
      channel: input.channel,
      direction: input.direction,
      externalId: input.externalId,
      fromId: input.fromId,
      toId: input.toId,
      type: input.type,
      text: input.text,
      payload: JSON.stringify(input.payload ?? {}),
      rawPayload: JSON.stringify(input.rawPayload ?? null),
      status: input.status,
      errorReason: input.errorReason ?? null,
      sentByUserId: input.sentByUserId,
      channelTimestamp: input.channelTimestamp,
      sequence,
      metadata: JSON.stringify({}),
    })
    .onConflict(['channel', 'externalId'])
    .ignore()
    .returning('id')

  if (rows.length) return { id: Number(rows[0].id), inserted: true, sequence }

  const existing = await trx('inbox_messages')
    .where({ channel: input.channel, externalId: input.externalId })
    .first('id', 'sequence')
  if (!existing) throw new Error('inbox_messages.insert.dedup_resolve_failed')
  return { id: Number(existing.id), inserted: false, sequence: Number(existing.sequence) }
}

export async function insertInboundMessage(
  trx: Knex.Transaction,
  input: InsertInboundMessageInput,
): Promise<InsertMessageResult> {
  return insertChannelMessage(trx, { ...input, direction: 'inbound', status: 'received', sentByUserId: null })
}

export async function insertFailedOutboundMessage(
  trx: Knex.Transaction,
  input: InsertOutboundMessageInput & { errorReason: WhatsappErrorCategory },
): Promise<InsertMessageResult> {
  return insertChannelMessage(trx, {
    conversationId: input.conversationId,
    agencyId: input.agencyId,
    leadId: input.leadId,
    channel: input.channel,
    direction: 'outbound',
    status: 'failed',
    errorReason: input.errorReason,
    externalId: input.externalId,
    fromId: input.fromId,
    toId: input.toId,
    type: 'text',
    text: input.text,
    payload: {},
    rawPayload: null,
    channelTimestamp: input.channelTimestamp,
    sentByUserId: input.sentByUserId,
  })
}

export async function insertOutboundMessage(
  trx: Knex.Transaction,
  input: InsertOutboundMessageInput,
): Promise<InsertMessageResult> {
  return insertChannelMessage(trx, {
    conversationId: input.conversationId,
    agencyId: input.agencyId,
    leadId: input.leadId,
    channel: input.channel,
    direction: 'outbound',
    status: 'sent',
    externalId: input.externalId,
    fromId: input.fromId,
    toId: input.toId,
    type: input.type ?? 'text',
    text: input.text,
    payload: input.payload ?? {},
    rawPayload: null,
    channelTimestamp: input.channelTimestamp,
    sentByUserId: input.sentByUserId,
  })
}

/**
 * Insert one message from a WhatsApp Coexistence history archive.
 *
 * A FOURTH PRESET over the same `insertChannelMessage` the live paths use — not
 * a second insert path. It exists because neither existing wrapper fits:
 * `insertInboundMessage` hardcodes `direction: 'inbound'`, and
 * `insertOutboundMessage` hardcodes `type: 'text'` with an empty payload, which
 * would silently discard a historical `media_placeholder` or an image's
 * metadata the moment the business was the sender.
 *
 * Direction is a PARAMETER because a history archive contains both halves of
 * every conversation. Status is the live-path default for the direction —
 * Meta's `history_context.status` is preserved verbatim in metadata instead of
 * being mapped onto our delivery states, because 'failed' renders rep-facing
 * Hebrew error copy and an archived message is not a delivery problem to act on.
 *
 * `sequence` is assigned by the shared primitive exactly as for live traffic:
 * `MAX(sequence) + 1` under the conversation's row lock. That is CORRECT — it
 * means order of arrival at us, and a history row genuinely did arrive now.
 * Chronology comes from `channelTimestamp` via the Wave 2A.2a timeline; no
 * existing row is renumbered.
 */
export async function insertHistoryMessage(
  trx: Knex.Transaction,
  input: InsertInboundMessageInput & { direction: InboxMessageDirection },
): Promise<InsertMessageResult> {
  return insertChannelMessage(trx, {
    ...input,
    direction: input.direction,
    status: input.direction === 'inbound' ? 'received' : 'sent',
    // No SocialCRM user sent this, and no user sent the customer's half either.
    // The column distinguishes "a person replied through the product" from any
    // other outbound, and naming a user here would be a lie about who acted.
    sentByUserId: null,
  })
}

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
}

/** Compact status projection for the sync delta (status changes mutate old rows). */
export type LeadWhatsappMessageStatus = {
  id: number
  status: InboxMessageStatus
  failureText: string | null
  failureCategory: WhatsappErrorCategory | null
}

/** Columns every thread read selects. One list so the three readers cannot drift. */
const LEAD_MESSAGE_COLUMNS = [
  'm.id',
  'm.direction',
  'm.type',
  'm.text',
  'm.payload',
  'm.status',
  'm.errorReason',
  'm.channelTimestamp',
  'm.createdAt',
] as const

function toIso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : v ? String(v) : ''
}

/** Rep-facing failure copy for a row, resolved once, server-side. Null unless failed. */
function failureTextForRow(status: InboxMessageStatus, errorReason: unknown): string | null {
  return status === 'failed' ? failureTextForCategory((errorReason as string | null) ?? 'generic') : null
}

/** Allowlisted failure category for a row (errorReason IS the key). Null unless failed. */
function failureCategoryForRow(status: InboxMessageStatus, errorReason: unknown): WhatsappErrorCategory | null {
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
  }
}

export async function listLeadWhatsappMessages(leadId: number): Promise<LeadWhatsappMessage[]> {
  const user = await getUser()
  if (!user?.agencyId) return []

  const rows = await db('inbox_messages as m')
    .join('inbox_conversations as cv', 'cv.id', 'm.conversationId')
    .where('cv.leadId', leadId)
    .andWhere('m.agencyId', user.agencyId)
    .andWhere('m.channel', 'whatsapp')
    // Conversations stay grouped (cv.id), and WITHIN a conversation the order is
    // chronological rather than arrival-ordered. The grouping is a deliberate
    // layout choice and is unchanged; only the inner order moved off `sequence`.
    .orderByRaw(`cv.id ASC, ${messageTimelineOrderSql('m')}`)
    .select(...LEAD_MESSAGE_COLUMNS)

  return rows.map(mapLeadWhatsappMessageRow)
}

/** Thread delta: messages newer than `afterId` for a conversation, agency-scoped. */
export async function getConversationMessagesAfter(
  conversationId: number,
  afterId: number,
  agencyId: number,
): Promise<LeadWhatsappMessage[]> {
  const rows = await db('inbox_messages as m')
    .where('m.conversationId', conversationId)
    .andWhere('m.agencyId', agencyId)
    .andWhere('m.id', '>', afterId)
    // Imported history never enters the delta. The cursor is `id`, and an
    // imported archive receives the HIGHEST ids in its conversation, so without
    // this an import would stream a customer's months-old messages at every
    // already-open browser as though they had just arrived. History becomes
    // visible on the next full thread load, in its correct chronological place.
    .andWhereRaw(notHistorySql('m'))
    // The cursor stays id-based on purpose: it pairs with
    // `getConversationOutboundStatuses`, which is also id-ordered, and
    // redesigning it is not part of this phase.
    .orderBy('m.id', 'asc')
    .select(...LEAD_MESSAGE_COLUMNS)

  return rows.map(mapLeadWhatsappMessageRow)
}

export async function listConversationMessages(conversationId: number): Promise<LeadWhatsappMessage[]> {
  const user = await getUser()
  if (!user?.agencyId) return []

  const rows = await db('inbox_messages as m')
    .join('inbox_conversations as cv', 'cv.id', 'm.conversationId')
    .where('cv.id', conversationId)
    .andWhere('m.agencyId', user.agencyId)
    // Full render INCLUDES history (product Decision 2) and places it
    // chronologically, which is the whole point of importing an archive.
    .orderByRaw(messageTimelineOrderSql('m'))
    .select(...LEAD_MESSAGE_COLUMNS)

  return rows.map(mapLeadWhatsappMessageRow)
}

/**
 * Outbound delivery states for an open conversation.
 *
 * The thread delta is `id > afterId` and can only ever see NEW rows; a status
 * change mutates an OLD one. This projection is how those changes reach the
 * client. Capped at the 60 most recent outbound messages — beyond that a rep is
 * scrolled into history, not watching for delivery.
 *
 * DELIBERATELY STILL id-ORDERED, unlike the thread readers. This is not a
 * chronological render; it is the companion of the id-based delta cursor above,
 * and the two must agree on what "recent" means or the client can be handed a
 * status for a message it has not received. When the cursor is redesigned this
 * moves with it. Imported history is outbound-and-`sent` with no failure, so it
 * can only dilute this window, never misreport a delivery state.
 */
export async function getConversationOutboundStatuses(
  conversationId: number,
  agencyId: number,
): Promise<LeadWhatsappMessageStatus[]> {
  const rows = await db('inbox_messages as m')
    .where('m.conversationId', conversationId)
    .andWhere('m.agencyId', agencyId)
    .andWhere('m.channel', 'whatsapp')
    .andWhere('m.direction', 'outbound')
    .orderBy('m.id', 'desc')
    .limit(60)
    .select('m.id', 'm.status', 'm.errorReason')

  return rows.map((r) => {
    const status = r.status as InboxMessageStatus
    return {
      id: Number(r.id),
      status,
      failureText: failureTextForRow(status, r.errorReason),
      failureCategory: failureCategoryForRow(status, r.errorReason),
    }
  })
}
