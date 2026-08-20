import type { Knex } from 'knex'
import { db } from '@/config/db'
import { getUser } from '@/db/auth'
import { failureTextForCategory, normalizeFailureCategory, type WhatsappErrorCategory } from '@/lib/inbox/whatsappErrorCopy'

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
    type: 'text',
    text: input.text,
    payload: {},
    rawPayload: null,
    channelTimestamp: input.channelTimestamp,
    sentByUserId: input.sentByUserId,
  })
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
    .orderBy([
      { column: 'cv.id', order: 'asc' },
      { column: 'm.sequence', order: 'asc' },
    ])
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
    .orderBy('m.sequence', 'asc')
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
