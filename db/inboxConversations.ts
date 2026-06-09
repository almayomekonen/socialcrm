import type { Knex } from 'knex'

export type InboxChannel = 'whatsapp'
export type InboxConversationState = 'open' | 'archived' | 'closed'

export type InboxConversationRow = {
  id: number
  agencyId: number
  leadId: number
  channel: InboxChannel
  businessPhoneNumberId: string
  customerWaId: string
  customerName: string | null
  state: InboxConversationState
  lastMessageAt: string | null
  lastInboundAt: string | null
  lastDirection: string | null
  lastMessageText: string | null
  unreadCount: number
  messageCount: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type FindOrCreateConversationInput = {
  agencyId: number
  leadId: number
  channel: InboxChannel
  businessPhoneNumberId: string
  customerWaId: string
  customerName: string | null
}

export async function findOrCreateConversation(trx: Knex.Transaction, input: FindOrCreateConversationInput): Promise<number> {
  const [row] = await trx('inbox_conversations')
    .insert({
      agencyId: input.agencyId,
      leadId: input.leadId,
      channel: input.channel,
      businessPhoneNumberId: input.businessPhoneNumberId,
      customerWaId: input.customerWaId,
      customerName: input.customerName,
    })
    .onConflict(['channel', 'businessPhoneNumberId', 'customerWaId'])
    .merge({
      updatedAt: trx.fn.now(),
      customerName: trx.raw('COALESCE(EXCLUDED."customerName", inbox_conversations."customerName")'),
    })
    .returning('id')

  return Number(row.id)
}

export async function bumpConversationOnInbound(
  trx: Knex.Transaction,
  conversationId: number,
  at: Date,
  lastMessageText?: string | null,
): Promise<void> {
  await trx('inbox_conversations')
    .where({ id: conversationId })
    .update({
      lastMessageAt: at,
      lastInboundAt: at,
      lastDirection: 'inbound',
      lastMessageText: lastMessageText ?? null,
      updatedAt: trx.fn.now(),
      messageCount: trx.raw('"messageCount" + 1'),
      unreadCount: trx.raw('"unreadCount" + 1'),
    })
}

export async function bumpConversationOnOutbound(
  trx: Knex.Transaction,
  conversationId: number,
  at: Date,
  lastMessageText?: string | null,
): Promise<void> {
  await trx('inbox_conversations')
    .where({ id: conversationId })
    .update({
      lastMessageAt: at,
      lastDirection: 'outbound',
      lastMessageText: lastMessageText ?? null,
      updatedAt: trx.fn.now(),
      messageCount: trx.raw('"messageCount" + 1'),
      unreadCount: 0,
    })
}
