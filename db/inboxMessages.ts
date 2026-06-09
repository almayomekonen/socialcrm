import type { Knex } from 'knex'
import { db } from '@/config/db'
import { getUser } from '@/db/auth'

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
  leadId: number
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
  leadId: number
  channel: 'whatsapp'
  externalId: string | null
  fromId: string | null
  toId: string | null
  text: string
  sentByUserId: number
  channelTimestamp: Date | null
}

type InsertChannelMessageInput = {
  conversationId: number
  agencyId: number
  leadId: number
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
    .select('m.id', 'm.direction', 'm.type', 'm.text', 'm.channelTimestamp', 'm.createdAt')

  const toIso = (v: unknown): string => (v instanceof Date ? v.toISOString() : v ? String(v) : '')

  return rows.map((r) => ({
    id: Number(r.id),
    direction: r.direction as InboxMessageDirection,
    type: r.type as InboxMessageType,
    text: (r.text as string) ?? '',
    timestamp: toIso(r.channelTimestamp ?? r.createdAt),
  }))
}

export async function listConversationMessages(conversationId: number): Promise<LeadWhatsappMessage[]> {
  const user = await getUser()
  if (!user?.agencyId) return []

  const rows = await db('inbox_messages as m')
    .join('inbox_conversations as cv', 'cv.id', 'm.conversationId')
    .where('cv.id', conversationId)
    .andWhere('m.agencyId', user.agencyId)
    .orderBy('m.sequence', 'asc')
    .select('m.id', 'm.direction', 'm.type', 'm.text', 'm.channelTimestamp', 'm.createdAt')

  const toIso = (v: unknown): string => (v instanceof Date ? v.toISOString() : v ? String(v) : '')

  return rows.map((r) => ({
    id: Number(r.id),
    direction: r.direction as InboxMessageDirection,
    type: r.type as InboxMessageType,
    text: (r.text as string) ?? '',
    timestamp: toIso(r.channelTimestamp ?? r.createdAt),
  }))
}
