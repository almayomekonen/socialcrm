import type { Knex } from 'knex'
import { db } from '@/config/db'
import type { MessengerAttachment } from '@/lib/facebook/messenger/parseMessagingEvent'
import type { MessengerConversationListItem, MessengerMessage } from './types'

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
const MESSAGE_LIMIT = 300

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
      knex.raw(`NULLIF(TRIM(CONCAT_WS(' ', c."firstName", c."lastName")), '') as "leadName"`),
      knex.raw(
        `("mc"."lastInboundAt" IS NOT NULL AND ("r"."lastReadAt" IS NULL OR "mc"."lastInboundAt" > "r"."lastReadAt")) as unread`,
      ),
    )
}

export function listMessengerConversationsQuery(knex: Knex, agencyId: number, userId: number) {
  return conversationSelect(knex, agencyId, userId)
    .orderByRaw('"mc"."lastMessageAt" DESC NULLS LAST, "mc"."id" DESC')
    .limit(MESSENGER_LIST_LIMIT)
}

export function getMessengerConversationQuery(knex: Knex, agencyId: number, userId: number, conversationId: number) {
  return conversationSelect(knex, agencyId, userId).andWhere('mc.id', conversationId).first()
}

/** Newest MESSAGE_LIMIT messages, returned oldest-first for reading. */
export function listMessengerMessagesQuery(knex: Knex, agencyId: number, conversationId: number) {
  return knex('messenger_messages')
    .where({ agencyId, conversationId })
    .orderByRaw('COALESCE("channelTimestamp", "createdAt") DESC, id DESC')
    .limit(MESSAGE_LIMIT)
    .select('id', 'direction', 'source', 'text', 'attachments', 'channelTimestamp', 'createdAt')
}

type ConversationRow = Omit<MessengerConversationListItem, 'unread'> & { unread: boolean | string }

function mapConversation(row: ConversationRow): MessengerConversationListItem {
  return { ...row, unread: row.unread === true || row.unread === 't' }
}

export async function listMessengerConversations(agencyId: number, userId: number) {
  const rows = (await listMessengerConversationsQuery(db, agencyId, userId)) as ConversationRow[]
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

export async function listMessengerMessages(agencyId: number, conversationId: number): Promise<MessengerMessage[]> {
  const rows = (await listMessengerMessagesQuery(db, agencyId, conversationId)) as {
    id: number | string
    direction: MessengerMessage['direction']
    source: MessengerMessage['source']
    text: string
    attachments: unknown
    channelTimestamp: Date | null
    createdAt: Date
  }[]
  return rows
    .map((r) => ({
      id: Number(r.id),
      direction: r.direction,
      source: r.source,
      text: r.text,
      attachments: parseAttachments(r.attachments),
      timestamp: r.channelTimestamp ?? r.createdAt,
    }))
    .reverse()
}
