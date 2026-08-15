import type { Knex } from 'knex'
import { db } from '@/config/db'

export type InboxChannel = 'whatsapp'
export type InboxConversationState = 'open' | 'archived' | 'closed'

export type InboxConversationRow = {
  id: number
  agencyId: number
  leadId: number | null
  isPersonal: boolean
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
  leadId: number | null
  channel: InboxChannel
  businessPhoneNumberId: string
  customerWaId: string
  customerName: string | null
}

export type ConversationMemory = {
  id: number
  agencyId: number
  leadId: number | null
  isPersonal: boolean
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

export async function getConversationMemory(
  agencyId: number,
  businessPhoneNumberId: string,
  customerWaId: string,
): Promise<ConversationMemory | null> {
  const row = await db('inbox_conversations')
    .where({
      agencyId,
      channel: 'whatsapp',
      businessPhoneNumberId,
      customerWaId,
    })
    .first('id', 'agencyId', 'leadId', 'isPersonal', 'customerWaId', 'customerName')
  if (!row) return null
  return {
    id: Number(row.id),
    agencyId: Number(row.agencyId),
    leadId: row.leadId != null ? Number(row.leadId) : null,
    isPersonal: row.isPersonal === true,
    customerWaId: String(row.customerWaId),
    customerName: row.customerName ?? null,
  }
}

export async function attachConversationToLead(
  trx: Knex.Transaction | typeof db,
  args: { conversationId: number; agencyId: number; leadId: number },
): Promise<void> {
  await trx('inbox_conversations').where({ id: args.conversationId, agencyId: args.agencyId }).update({
    leadId: args.leadId,
    isPersonal: false,
    personalMarkedByUserId: null,
    personalMarkedAt: null,
    updatedAt: new Date(),
  })
  await trx('inbox_messages').where({ conversationId: args.conversationId, agencyId: args.agencyId }).update({
    leadId: args.leadId,
  })
  await trx('inbox_participants').where({ conversationId: args.conversationId, role: 'customer' }).update({
    leadId: args.leadId,
  })
}

/**
 * Hard-delete a WhatsApp conversation and everything it owns, LOCAL to SocialCRM.
 *
 * A single agency-scoped DELETE is sufficient: `inbox_messages`,
 * `inbox_participants`, and `inbox_conversation_reads` all reference
 * `inbox_conversations(id)` with `ON DELETE CASCADE`, so the whole thread is
 * removed atomically without an explicit multi-table transaction.
 *
 * What this deliberately does NOT touch:
 *   - `clients` (the Lead): the `leadId` FK runs clients → conversations
 *     (`ON DELETE CASCADE` in that direction only). Deleting a conversation can
 *     never delete a client. The Lead is preserved for every conversation kind
 *     (lead-linked, leadless, personal, FB/IG-linked, coexistence).
 *   - `ai_conversations` / AI derived rows: keyed by `leadId`, not by this
 *     conversation, so they are out of the cascade and survive.
 *
 * The `agencyId` predicate is the tenant/IDOR guard — a conversation owned by
 * another agency does not match, so 0 rows are affected (no effect, no leak).
 * Idempotent: deleting an already-gone conversation returns `{ deleted: false }`.
 */
export async function deleteConversation(args: { conversationId: number; agencyId: number }): Promise<{ deleted: boolean }> {
  const count = await db('inbox_conversations').where({ id: args.conversationId, agencyId: args.agencyId }).del()
  return { deleted: count > 0 }
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
