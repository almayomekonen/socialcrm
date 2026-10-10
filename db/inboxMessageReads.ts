/**
 * Thread reads for the inbox: the full thread, the sync delta, the outbound
 * status projection, and the prior-outbound check.
 *
 * Extracted from db/inboxMessages.ts without behaviour change. Every thread
 * reader selects LEAD_MESSAGE_COLUMNS and maps through mapLeadWhatsappMessageRow
 * (db/inboxMessageProjection.ts), so first paint and the poller cannot drift.
 */
import { db } from '@/config/db'
import { getUser } from '@/db/auth'
import { messageTimelineOrderSql, notHistorySql } from '@/lib/inbox/messageTimeline'
import type { InboxMessageStatus } from '@/db/inboxMessages'
import {
  LEAD_MESSAGE_COLUMNS,
  failureCategoryForRow,
  failureTextForRow,
  mapLeadWhatsappMessageRow,
  type LeadWhatsappMessage,
  type LeadWhatsappMessageStatus,
} from '@/db/inboxMessageProjection'

export async function listLeadWhatsappMessages(leadId: number): Promise<LeadWhatsappMessage[]> {
  const user = await getUser()
  if (!user?.agencyId) return []

  const rows = await db('inbox_messages as m')
    .join('inbox_conversations as cv', 'cv.id', 'm.conversationId')
    .where('cv.leadId', leadId)
    .andWhere('m.agencyId', user.agencyId)
    .andWhere('m.channel', 'whatsapp')
    // Conversations stay grouped (cv.id), and WITHIN a conversation the order is
    // chronological rather than arrival-ordered. The grouping is a deliberate
    // layout choice and is unchanged; only the inner order moved off `sequence`.
    .orderByRaw(`cv.id ASC, ${messageTimelineOrderSql('m')}`)
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
    // Imported history never enters the delta. The cursor is `id`, and an
    // imported archive receives the HIGHEST ids in its conversation, so without
    // this an import would stream a customer's months-old messages at every
    // already-open browser as though they had just arrived. History becomes
    // visible on the next full thread load, in its correct chronological place.
    .andWhereRaw(notHistorySql('m'))
    // The cursor stays id-based on purpose: it pairs with
    // `getConversationOutboundStatuses`, which is also id-ordered, and
    // redesigning it is not part of this phase.
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
    // Full render INCLUDES history (product Decision 2) and places it
    // chronologically, which is the whole point of importing an archive.
    .orderByRaw(messageTimelineOrderSql('m'))
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
 *
 * DELIBERATELY STILL id-ORDERED, unlike the thread readers. This is not a
 * chronological render; it is the companion of the id-based delta cursor above,
 * and the two must agree on what "recent" means or the client can be handed a
 * status for a message it has not received. When the cursor is redesigned this
 * moves with it. Imported history is outbound-and-`sent` with no failure, so it
 * can only dilute this window, never misreport a delivery state.
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

/**
 * Has the business already sent anything on this conversation — an agent reply
 * or a human one?
 *
 * Used by the first-greeting decision. It asks the table rather than scanning
 * the worker's in-memory transcript because that transcript is capped
 * (MAX_TRANSCRIPT): past the cap an early greeting would fall out of the window
 * and the same customer would be welcomed a second time.
 *
 * An existence check, not a COUNT: the greeting only cares whether the number is
 * zero, and `.first('id')` is the same query shape the worker already uses for
 * `outboundExists`.
 */
export async function hasPriorOutbound(conversationId: number): Promise<boolean> {
  const row = await db('inbox_messages').where({ conversationId, direction: 'outbound' }).first('id')
  return Boolean(row)
}
