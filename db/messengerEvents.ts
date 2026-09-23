import type { Knex } from 'knex'

/**
 * Writes for Messenger events that are NOT messages: delivery/read watermarks,
 * and postbacks/referrals/reactions.
 *
 * Separate from db/messenger.ts because they are a separate concern — the
 * conversation/message writers there are about what was SAID, these are about
 * what happened around it. Keeping them together pushed that file past the
 * 250-line soft limit with three unrelated reasons to change
 * (architecture-rules §1, §4).
 */

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
