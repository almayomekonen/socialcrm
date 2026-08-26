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

/**
 * Establish the conversation identity row for an imported history thread —
 * and nothing else.
 *
 * WHY NOT `findOrCreateConversation`. That helper's upsert merges
 * `updatedAt` and `customerName` onto an EXISTING row. Neither is a
 * current-state field, but a history import must be provably incapable of
 * touching a live conversation at all, and "it only writes two harmless
 * columns" is a claim that decays the next time someone adds a third. This
 * helper uses `ON CONFLICT DO NOTHING`, so an existing conversation is read,
 * never written.
 *
 * A NEW ROW IS BORN NEUTRAL. Every current-state column has a column default
 * that means "nothing has happened yet": `lastMessageAt`, `lastInboundAt`,
 * `lastDirection` and `lastMessageText` are NULL, `unreadCount` and
 * `messageCount` are 0. So the conversation exists to hold imported messages
 * without asserting anything about the present — which is the whole point.
 * Nothing here projects the archive's chronology into live CRM state, and no
 * bump helper is called.
 *
 * `leadId` is ALWAYS null on creation. An archive proves the business talked to
 * someone; it proves nothing about whether that someone is a Lead. Promotion
 * stays the human decision it already is.
 *
 * Identity is the live one — `(agencyId, businessPhoneNumberId, customerWaId)`
 * — so an imported thread and a later live message resolve to the SAME
 * conversation rather than forking it. The customer's number is never a tenant
 * key: `agencyId` is resolved from `phone_number_id` before this is called.
 */
export async function ensureHistoryConversation(
  trx: Knex.Transaction,
  input: { agencyId: number; businessPhoneNumberId: string; customerWaId: string },
): Promise<{ id: number; leadId: number | null; created: boolean }> {
  const rows = await trx('inbox_conversations')
    .insert({
      agencyId: input.agencyId,
      leadId: null,
      channel: 'whatsapp',
      businessPhoneNumberId: input.businessPhoneNumberId,
      customerWaId: input.customerWaId,
      customerName: null,
    })
    .onConflict(['channel', 'businessPhoneNumberId', 'customerWaId'])
    .ignore()
    .returning(['id', 'leadId'])

  if (rows.length) {
    return { id: Number(rows[0].id), leadId: rows[0].leadId == null ? null : Number(rows[0].leadId), created: true }
  }

  // The conflict target is channel-scoped, so read back WITH the agency filter:
  // a row that exists under another tenant must resolve to nothing here rather
  // than silently becoming this import's destination.
  const existing = await trx('inbox_conversations')
    .where({
      agencyId: input.agencyId,
      channel: 'whatsapp',
      businessPhoneNumberId: input.businessPhoneNumberId,
      customerWaId: input.customerWaId,
    })
    .first('id', 'leadId')
  if (!existing) throw new Error('inbox_conversations.ensure_history.resolve_failed')
  return { id: Number(existing.id), leadId: existing.leadId == null ? null : Number(existing.leadId), created: false }
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
