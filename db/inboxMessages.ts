import type { Knex } from 'knex'
import type { WhatsappErrorCategory } from '@/lib/inbox/whatsappErrorCopy'

/**
 * inbox_messages: the message types and every WRITE path.
 *
 * The client projection lives in db/inboxMessageProjection.ts and the thread
 * reads in db/inboxMessageReads.ts; both are re-exported here so callers keep
 * importing from '@/db/inboxMessages'.
 */
export {
  ATTACHMENT_MEDIA_TYPES,
  mapLeadWhatsappMessageRow,
  sanitizeAttachmentFilename,
  sanitizeAttachmentMime,
  toSafeAttachment,
  type InboxMessageAttachment,
  type LeadWhatsappMessage,
  type LeadWhatsappMessageStatus,
} from '@/db/inboxMessageProjection'
export {
  getConversationMessagesAfter,
  getConversationOutboundStatuses,
  hasPriorOutbound,
  listConversationMessages,
  listLeadWhatsappMessages,
} from '@/db/inboxMessageReads'

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
  /**
   * Row metadata written in the INSERT itself, e.g. `{ source: 'auto_response' }`.
   *
   * Callers have historically merged this with a second UPDATE after the row
   * exists, which leaves a window where an automated message is untagged — and
   * an untagged outbound reads as a human takeover everywhere in the agent.
   * Optional; omitting it keeps the previous behaviour exactly.
   */
  metadata?: Record<string, unknown>
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
  metadata?: Record<string, unknown>
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
      metadata: JSON.stringify(input.metadata ?? {}),
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
    metadata: input.metadata,
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
