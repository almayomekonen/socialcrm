import type { Knex } from 'knex'
import { db } from '@/config/db'
import type { MessengerAttachment } from '@/lib/facebook/messenger/parseMessagingEvent'

/**
 * Messenger writes. Every function takes the tenant and the Page explicitly;
 * nothing reads them from a message body.
 */

export type MessengerSource = 'customer' | 'socialcrm' | 'page_inbox' | 'other_app'

const PREVIEW_MAX = 200

function preview(text: string, attachments: MessengerAttachment[]): string {
  if (text) return text.slice(0, PREVIEW_MAX)
  return attachments.length > 0 ? '[קובץ מצורף]' : ''
}

/**
 * The conversation for ("agencyId", "pageId", psid), created on first contact.
 * `created` is Postgres's own insert signal (xmax = 0), used to fetch the
 * contact's name once rather than on every message.
 */
export async function findOrCreateMessengerConversation(
  trx: Knex.Transaction,
  input: { agencyId: number; pageId: string; psid: string },
): Promise<{ id: number; created: boolean }> {
  const [row] = await trx('messenger_conversations')
    .insert({ agencyId: input.agencyId, pageId: input.pageId, psid: input.psid })
    .onConflict(['agencyId', 'pageId', 'psid'])
    .merge({ updatedAt: trx.fn.now() })
    .returning(['id', trx.raw('(xmax = 0) as created')])
  const created = row.created === true || row.created === 't'
  return { id: Number(row.id), created }
}

/**
 * Insert one message; a message already stored for this Page (Meta redelivery,
 * or the echo of a message SocialCRM sent) is a no-op. Returns the new row id,
 * or null for a duplicate.
 */
export async function insertMessengerMessage(
  trx: Knex.Transaction | Knex,
  input: {
    conversationId: number
    agencyId: number
    pageId: string
    mid: string
    direction: 'inbound' | 'outbound'
    source: MessengerSource
    text: string
    attachments: MessengerAttachment[]
    sentByUserId?: number | null
    channelTimestamp: Date | null
  },
): Promise<number | null> {
  const rows = await trx('messenger_messages')
    .insert({
      conversationId: input.conversationId,
      agencyId: input.agencyId,
      pageId: input.pageId,
      mid: input.mid,
      direction: input.direction,
      source: input.source,
      text: input.text,
      attachments: JSON.stringify(input.attachments),
      sentByUserId: input.sentByUserId ?? null,
      channelTimestamp: input.channelTimestamp,
    })
    .onConflict(['pageId', 'mid'])
    .ignore()
    .returning('id')
  return rows.length > 0 ? Number((rows[0] as { id: number | string }).id) : null
}

/**
 * Record a message SocialCRM just sent, from the Send API response. If its
 * `message_echoes` webhook landed first (stored as an app echo without a
 * sender), attribute it here instead of losing who sent it. Returns whether
 * this call created the row, so the conversation is bumped exactly once.
 */
export async function recordSentMessengerMessage(
  trx: Knex.Transaction,
  input: {
    conversationId: number
    agencyId: number
    pageId: string
    mid: string
    text: string
    sentByUserId: number
    at: Date
  },
): Promise<{ created: boolean }> {
  const [row] = await trx('messenger_messages')
    .insert({
      conversationId: input.conversationId,
      agencyId: input.agencyId,
      pageId: input.pageId,
      mid: input.mid,
      direction: 'outbound',
      source: 'socialcrm',
      text: input.text,
      attachments: JSON.stringify([]),
      sentByUserId: input.sentByUserId,
      channelTimestamp: input.at,
    })
    .onConflict(['pageId', 'mid'])
    .merge({ sentByUserId: input.sentByUserId, source: 'socialcrm' })
    .returning(['id', trx.raw('(xmax = 0) as created')])
  return { created: row?.created === true || row?.created === 't' }
}

/**
 * Move the conversation's summary forward. Webhooks can arrive out of order
 * (Meta says to trust the event timestamp), so a message only becomes the
 * "last message" when it is newer than the one already recorded.
 */
export async function bumpMessengerConversation(
  trx: Knex.Transaction | Knex,
  input: {
    conversationId: number
    direction: 'inbound' | 'outbound'
    at: Date
    text: string
    attachments: MessengerAttachment[]
  },
): Promise<void> {
  const text = preview(input.text, input.attachments)
  await trx('messenger_conversations')
    .where({ id: input.conversationId })
    .update({
      lastMessageText: trx.raw(
        `CASE WHEN "lastMessageAt" IS NULL OR "lastMessageAt" <= ? THEN ? ELSE "lastMessageText" END`,
        [input.at, text],
      ),
      lastDirection: trx.raw(
        `CASE WHEN "lastMessageAt" IS NULL OR "lastMessageAt" <= ? THEN ? ELSE "lastDirection" END`,
        [input.at, input.direction],
      ),
      lastMessageAt: trx.raw(`GREATEST(COALESCE("lastMessageAt", ?), ?)`, [input.at, input.at]),
      ...(input.direction === 'inbound'
        ? { lastInboundAt: trx.raw(`GREATEST(COALESCE("lastInboundAt", ?), ?)`, [input.at, input.at]) }
        : {}),
      updatedAt: trx.fn.now(),
    })
}

/** Fill the display name once, never overwriting a name already known. */
export async function setMessengerCustomerNameIfMissing(conversationId: number, agencyId: number, name: string) {
  await db('messenger_conversations')
    .where({ id: conversationId, agencyId })
    .whereNull('customerName')
    .update({ customerName: name.slice(0, 200), updatedAt: db.fn.now() })
}
