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
    /** What we sent, when it was media. Meta returns no CDN url on send, so the
     *  url is null here and the echo webhook fills it in. */
    attachments?: MessengerAttachment[]
  },
): Promise<{ created: boolean }> {
  const attachments = input.attachments ?? []
  const [row] = await trx('messenger_messages')
    .insert({
      conversationId: input.conversationId,
      agencyId: input.agencyId,
      pageId: input.pageId,
      mid: input.mid,
      direction: 'outbound',
      source: 'socialcrm',
      text: input.text,
      attachments: JSON.stringify(attachments),
      sentByUserId: input.sentByUserId,
      channelTimestamp: input.at,
    })
    .onConflict(['pageId', 'mid'])
    // The echo may already hold a CDN url we cannot produce; merging our empty
    // list over it would blank the attachment the rep just sent.
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

/** What the User Profile API told us about a contact. 'transient' is never stored. */
export type MessengerProfileStatus = 'ok' | 'denied' | 'unavailable'

/**
 * Record the outcome of a profile lookup.
 *
 * The NAME is only ever filled in, never blanked: a rep may have come to
 * recognise a conversation by it, and a later refusal (Meta outage, the person
 * tightening their privacy settings) must not erase it. The PICTURE is the
 * opposite — its URL expires, so it is replaced on every successful refresh and
 * cleared when Meta stops returning one, because showing a dead image is worse
 * than showing initials.
 *
 * `profileFetchedAt` is stamped for every recorded outcome including `denied`,
 * which is what stops the refresh loop from asking again.
 */
export async function saveMessengerProfile(input: {
  conversationId: number
  agencyId: number
  name: string | null
  picUrl: string | null
  status: MessengerProfileStatus
  at: Date
}): Promise<void> {
  await db('messenger_conversations')
    .where({ id: input.conversationId, agencyId: input.agencyId })
    .update({
      customerName: db.raw(`COALESCE("customerName", ?)`, [input.name ? input.name.slice(0, 200) : null]),
      profilePicUrl: input.picUrl,
      profileStatus: input.status,
      profileFetchedAt: input.at,
      updatedAt: db.fn.now(),
    })
}

/**
 * Apply a `message_deliveries` / `message_reads` watermark.
 *
 * Meta reports these as "everything up to this timestamp", not per message, so
 * this stamps every OUTBOUND message at or before the watermark that does not
 * already carry one. COALESCE keeps the first event's time: a later, broader
 * watermark must not restate when an older message was delivered.
 *
 * Inbound messages are untouched — a read receipt is about what the CUSTOMER
 * has seen, which only applies to what the Page sent.
 */
export async function applyMessengerWatermark(
  trx: Knex.Transaction | Knex,
  input: { conversationId: number; agencyId: number; field: 'deliveredAt' | 'readAt'; watermark: Date },
): Promise<number> {
  const column = input.field
  return trx('messenger_messages')
    .where({ conversationId: input.conversationId, agencyId: input.agencyId, direction: 'outbound' })
    .whereRaw(`COALESCE("channelTimestamp", "createdAt") <= ?`, [input.watermark])
    .whereNull(column)
    .update({ [column]: input.watermark })
}

/**
 * Store a postback, referral or reaction. Keyed by ("pageId", "eventKey") so a
 * Meta redelivery is a no-op, exactly like a message's (pageId, mid).
 */
export async function insertMessengerEvent(
  trx: Knex.Transaction | Knex,
  input: {
    conversationId: number
    agencyId: number
    pageId: string
    kind: 'postback' | 'referral' | 'reaction' | 'optin'
    eventKey: string
    title: string | null
    payload: string | null
    targetMid: string | null
    occurredAt: Date
  },
): Promise<number | null> {
  const rows = await trx('messenger_events')
    .insert({
      conversationId: input.conversationId,
      agencyId: input.agencyId,
      pageId: input.pageId,
      kind: input.kind,
      eventKey: input.eventKey,
      title: input.title,
      payload: input.payload,
      targetMid: input.targetMid,
      occurredAt: input.occurredAt,
    })
    .onConflict(['pageId', 'eventKey'])
    .ignore()
    .returning('id')
  return rows.length > 0 ? Number((rows[0] as { id: number | string }).id) : null
}
