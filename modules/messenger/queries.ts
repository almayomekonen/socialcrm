import type { Knex } from 'knex'
import { db } from '@/config/db'
import type { MessengerAttachment } from '@/lib/facebook/messenger/parseMessagingEvent'
import type { MessengerConversationEvent, MessengerConversationListItem, MessengerMessage } from './types'

/**
 * Messenger inbox read layer.
 *
 * TENANCY: every builder takes `agencyId` and applies it to the conversation
 * AND to every joined table, so a join can never widen the tenant scope. The
 * route resolves `agencyId` and `userId` from the session only.
 *
 * Builders are exported apart from executors so the SQL can be pinned with
 * `.toSQL()` (same pattern as modules/facebookComments/queries.ts). Visibility
 * matches the WhatsApp inbox: every conversation of the agency.
 */

export const MESSENGER_LIST_LIMIT = 50

/**
 * Messages loaded with the thread. Older ones are fetched on demand by
 * `listOlderMessengerMessages`, which is why this is a page size and not a
 * ceiling on history.
 */
export const MESSENGER_MESSAGE_PAGE = 50

/**
 * Free-text filter over a conversation list.
 *
 * Matches the contact's name, the linked ליד's name, and the last message —
 * the three things a rep actually remembers about a conversation. Applied in
 * SQL so the result is the agency's WHOLE history, not the 50 rows that happen
 * to be on screen; a search that silently only looked at the current page would
 * report "nothing found" for a conversation that exists.
 *
 * `%` and `_` are escaped so a customer whose name contains one cannot turn the
 * pattern into a wildcard.
 */
function applySearch(q: Knex.QueryBuilder, knex: Knex, search: string) {
  const term = search.trim().slice(0, 100)
  if (!term) return q
  const pattern = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  return q.andWhere((w) => {
    w.whereRaw(`"mc"."customerName" ILIKE ? ESCAPE '\\'`, [pattern])
      .orWhereRaw(`"mc"."lastMessageText" ILIKE ? ESCAPE '\\'`, [pattern])
      .orWhereRaw(`TRIM(CONCAT_WS(' ', "c"."firstName", "c"."lastName")) ILIKE ? ESCAPE '\\'`, [pattern])
  })
}

function conversationSelect(knex: Knex, agencyId: number, userId: number) {
  return knex('messenger_conversations as mc')
    .leftJoin('messenger_conversation_reads as r', function () {
      this.on('r.conversationId', '=', 'mc.id').andOn('r.userId', '=', knex.raw('?', [userId]))
    })
    .leftJoin('clients as c', function () {
      this.on('c.id', '=', 'mc.leadId').andOn('c.agencyId', '=', 'mc.agencyId')
    })
    .where('mc.agencyId', agencyId)
    .select(
      'mc.id',
      'mc.pageId',
      'mc.customerName',
      'mc.leadId',
      'mc.lastMessageAt',
      'mc.lastInboundAt',
      'mc.lastMessageText',
      'mc.lastDirection',
      'mc.profilePicUrl',
      'mc.profileStatus',
      knex.raw(`NULLIF(TRIM(CONCAT_WS(' ', c."firstName", c."lastName")), '') as "leadName"`),
      knex.raw(
        `("mc"."lastInboundAt" IS NOT NULL AND ("r"."lastReadAt" IS NULL OR "mc"."lastInboundAt" > "r"."lastReadAt")) as unread`,
      ),
    )
}

export function listMessengerConversationsQuery(knex: Knex, agencyId: number, userId: number, search = '') {
  const q = conversationSelect(knex, agencyId, userId)
    .orderByRaw('"mc"."lastMessageAt" DESC NULLS LAST, "mc"."id" DESC')
    .limit(MESSENGER_LIST_LIMIT)
  return applySearch(q, knex, search)
}

export function getMessengerConversationQuery(knex: Knex, agencyId: number, userId: number, conversationId: number) {
  return conversationSelect(knex, agencyId, userId).andWhere('mc.id', conversationId).first()
}

/**
 * One page of messages, newest first, optionally older than a cursor.
 *
 * The cursor is a row id, not a timestamp: two messages can share a
 * `channelTimestamp` (Meta's resolution is seconds), and a timestamp cursor
 * would then either skip one or return it twice. Ordering is by
 * COALESCE(channelTimestamp, createdAt) then id — the same expression the
 * index is built on — so the sort is total and the page boundary is stable.
 */
export function listMessengerMessagesQuery(
  knex: Knex,
  agencyId: number,
  conversationId: number,
  opts: { beforeId?: number; limit?: number } = {},
) {
  const q = knex('messenger_messages')
    .where({ agencyId, conversationId })
    .orderByRaw('COALESCE("channelTimestamp", "createdAt") DESC, id DESC')
    .limit(opts.limit ?? MESSENGER_MESSAGE_PAGE)
    .select('id', 'direction', 'source', 'text', 'attachments', 'channelTimestamp', 'createdAt', 'deliveredAt', 'readAt')
  if (opts.beforeId) {
    // The cursor row is looked up INSIDE the same agency and conversation. A
    // cursor from elsewhere then resolves to nothing and the page comes back
    // empty, rather than positioning this conversation's page by another
    // tenant's timestamp — which would leak that timestamp's ordering by
    // observation, even though the rows returned are always tenant-scoped.
    q.andWhereRaw(
      `(COALESCE("channelTimestamp", "createdAt"), id) <
       (SELECT COALESCE("channelTimestamp", "createdAt"), id FROM messenger_messages
        WHERE id = ? AND "agencyId" = ? AND "conversationId" = ?)`,
      [opts.beforeId, agencyId, conversationId],
    )
  }
  return q
}

type ConversationRow = Omit<MessengerConversationListItem, 'unread' | 'id'> & {
  id: number | string
  unread: boolean | string
}

/**
 * `id` is a bigserial, which node-postgres returns as a STRING to avoid losing
 * precision past 2^53. The type has always said `number`, so every consumer has
 * been quietly holding a string — harmless where it is interpolated into a URL,
 * not harmless the first time someone compares it with `===` to a number or
 * sorts by it. Coerced here, the same way message ids already are.
 *
 * `unread` is a raw SQL boolean, which some drivers hand back as 't'.
 */
function mapConversation(row: ConversationRow): MessengerConversationListItem {
  return { ...row, id: Number(row.id), unread: row.unread === true || row.unread === 't' }
}

export async function listMessengerConversations(agencyId: number, userId: number, search = '') {
  const rows = (await listMessengerConversationsQuery(db, agencyId, userId, search)) as ConversationRow[]
  return rows.map(mapConversation)
}

export async function getMessengerConversation(agencyId: number, userId: number, conversationId: number) {
  if (!Number.isInteger(conversationId) || conversationId <= 0) return null
  const row = (await getMessengerConversationQuery(db, agencyId, userId, conversationId)) as ConversationRow | undefined
  return row ? mapConversation(row) : null
}

function parseAttachments(raw: unknown): MessengerAttachment[] {
  const value = typeof raw === 'string' ? (() => { try { return JSON.parse(raw) } catch { return [] } })() : raw
  return Array.isArray(value) ? (value as MessengerAttachment[]) : []
}

/**
 * A page of messages, oldest-first for reading, plus whether older ones exist.
 *
 * `hasMore` is derived by asking for ONE row beyond the page and discarding it.
 * The alternative — a COUNT over the conversation — costs a second scan on
 * every thread open to answer a question only the boundary needs.
 */
export async function listMessengerMessagePage(
  agencyId: number,
  conversationId: number,
  opts: { beforeId?: number; limit?: number } = {},
): Promise<{ messages: MessengerMessage[]; hasMore: boolean }> {
  const limit = opts.limit ?? MESSENGER_MESSAGE_PAGE
  const rows = await listMessengerMessagesRaw(agencyId, conversationId, { ...opts, limit: limit + 1 })
  const hasMore = rows.length > limit
  return { messages: rows.slice(0, limit).reverse(), hasMore }
}

export async function listMessengerMessages(agencyId: number, conversationId: number): Promise<MessengerMessage[]> {
  return (await listMessengerMessagePage(agencyId, conversationId)).messages
}

async function listMessengerMessagesRaw(
  agencyId: number,
  conversationId: number,
  opts: { beforeId?: number; limit?: number },
): Promise<MessengerMessage[]> {
  const rows = (await listMessengerMessagesQuery(db, agencyId, conversationId, opts)) as {
    id: number | string
    direction: MessengerMessage['direction']
    source: MessengerMessage['source']
    text: string
    attachments: unknown
    channelTimestamp: Date | null
    createdAt: Date
    deliveredAt: Date | null
    readAt: Date | null
  }[]
  return rows
    .map((r) => ({
      id: Number(r.id),
      direction: r.direction,
      source: r.source,
      text: r.text,
      attachments: parseAttachments(r.attachments),
      timestamp: r.channelTimestamp ?? r.createdAt,
      deliveredAt: r.deliveredAt ?? null,
      readAt: r.readAt ?? null,
    }))
}

/** How many conversation events are shown alongside a thread. */
const EVENT_LIMIT = 100

/**
 * Postbacks, referrals and reactions for one conversation.
 *
 * Tenant-scoped like every other read. Bounded: a thread that somehow collected
 * thousands of reactions must not turn opening it into an unbounded scan.
 */
export async function listMessengerConversationEvents(
  agencyId: number,
  conversationId: number,
): Promise<MessengerConversationEvent[]> {
  const rows = (await db('messenger_events as e')
    // LEFT JOIN: a reaction can outrun the echo of the message it refers to, and
    // an unresolvable target must not drop the event.
    .leftJoin('messenger_messages as m', function () {
      this.on('m.mid', '=', 'e.targetMid').andOn('m.pageId', '=', 'e.pageId')
    })
    .where({ 'e.agencyId': agencyId, 'e.conversationId': conversationId })
    .orderBy([{ column: 'e.occurredAt', order: 'desc' }, { column: 'e.id', order: 'desc' }])
    .limit(EVENT_LIMIT)
    .select('e.id', 'e.kind', 'e.title', 'e.payload', 'e.occurredAt', 'm.id as targetMessageId')) as {
    id: number | string
    kind: MessengerConversationEvent['kind']
    title: string | null
    payload: string | null
    targetMessageId: number | string | null
    occurredAt: Date
  }[]
  return rows
    .map((r) => ({ ...r, id: Number(r.id), targetMessageId: r.targetMessageId ? Number(r.targetMessageId) : null }))
    .reverse()
}

/**
 * How many Messenger conversations this user has not opened since the customer
 * last wrote.
 *
 * WHY A SEPARATE COUNT, and not folded into the global inbox badge. That badge
 * counts unread WhatsApp CONVERSATIONS and is owned by `inbox_conversations`;
 * adding Messenger to it would merge two channels behind one number a rep
 * cannot act on without guessing which inbox to open, and would give one live
 * signal two owners (frontend-experience-guidelines §14). This number belongs to
 * the Messenger tab, which is where acting on it begins.
 *
 * Unread means exactly what the row list means by it: the customer wrote after
 * this user last opened the conversation. Per user, not per agency — a teammate
 * reading a thread does not mark it read for everyone.
 */
export async function countUnreadMessengerConversations(agencyId: number, userId: number): Promise<number> {
  const [row] = await db('messenger_conversations as mc')
    .leftJoin('messenger_conversation_reads as r', function () {
      this.on('r.conversationId', '=', 'mc.id').andOn('r.userId', '=', db.raw('?', [userId]))
    })
    .where('mc.agencyId', agencyId)
    .whereNotNull('mc.lastInboundAt')
    .whereRaw('("r"."lastReadAt" IS NULL OR "mc"."lastInboundAt" > "r"."lastReadAt")')
    .count<{ count: string }[]>('mc.id as count')
  return Number(row?.count ?? 0)
}
