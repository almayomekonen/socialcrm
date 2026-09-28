/**
 * "A customer is waiting for a person" notification tick — runs every minute
 * from app/api/cron/notifications-dispatch.
 *
 * Two emissions, both read from CURRENT persisted state (never at a write site,
 * so webhook retries and concurrent jobs cannot duplicate them):
 *
 *   lead.handoff  — the AI handed the chat to a person and nobody has
 *                           answered since. Within a minute of the handoff.
 *                           eventKey: conversation + escalatedAt.
 *   message.unanswered    — the ONE reminder: the customer's latest message is
 *                           30+ minutes old with no human answer (see
 *                           db/notifications/unanswered.ts for who counts).
 *                           eventKey: the inbound message id.
 *
 * A human reply cancels both: it removes the conversation from the candidate
 * queries, and `clearConversationAttention` marks any delivered one read.
 * Reading a conversation writes no outbound row and changes nothing.
 *
 * OFF-HOURS: an agency that set quiet hours for its WhatsApp auto-responder gets
 * nothing inside them. The candidate is simply skipped this minute; it is still
 * a candidate when the quiet window ends, and the eventKey keeps it to one. An
 * agency without quiet hours has no off-hours — the product has no other
 * business-hours concept to borrow.
 */

import {
  findPendingHandoffs,
  findUnansweredConversations,
  quietHoursByAgency,
  UNANSWERED_THRESHOLD_MS,
  UNANSWERED_TICK_LIMIT,
  type HandoffCandidateRow,
  type UnansweredCandidateRow,
} from '@/db/notifications/unanswered'
import { withinQuietHours } from '@/lib/inbox/autoresponse/noResponseClose'
import { notifyEvent } from './emit'
import { isNotificationsEnabled } from './flags'
import { leadDisplayName } from './leadName'

export type UnansweredTickSummary = {
  scanned: number
  enqueued: number
  skipped: number
  /** Candidates held back by the agency's quiet hours this minute. */
  deferred: number
}

async function emitUnanswered(row: UnansweredCandidateRow, occurredAt: Date): Promise<'enqueued' | 'skipped'> {
  if (!Number.isFinite(row.messageId) || row.messageId <= 0) return 'skipped'
  if (!Number.isFinite(row.conversationId) || row.conversationId <= 0) return 'skipped'
  if (!Number.isFinite(row.leadId) || row.leadId <= 0) return 'skipped'

  const result = await notifyEvent({
    type: 'message.unanswered',
    agencyId: row.agencyId,
    entityType: 'conversation',
    entityId: row.conversationId,
    actorUserId: null,
    occurredAt,
    payload: {
      leadId: row.leadId,
      messageId: row.messageId,
      leadName: leadDisplayName(row),
    },
  })
  return result.enqueued ? 'enqueued' : 'skipped'
}

async function emitHandoff(row: HandoffCandidateRow, occurredAt: Date): Promise<'enqueued' | 'skipped'> {
  if (!Number.isFinite(row.conversationId) || row.conversationId <= 0) return 'skipped'
  if (Number.isNaN(row.escalatedAt.getTime())) return 'skipped'

  const result = await notifyEvent({
    type: 'lead.handoff',
    agencyId: row.agencyId,
    entityType: 'conversation',
    entityId: row.conversationId,
    actorUserId: null,
    occurredAt,
    payload: {
      leadId: row.leadId,
      escalatedAt: row.escalatedAt.toISOString(),
      leadName: row.leadId == null ? null : leadDisplayName(row),
    },
  })
  return result.enqueued ? 'enqueued' : 'skipped'
}

export async function tickUnansweredNotifications(opts?: {
  nowMs?: number
  limit?: number
  thresholdMs?: number
}): Promise<UnansweredTickSummary> {
  const summary: UnansweredTickSummary = { scanned: 0, enqueued: 0, skipped: 0, deferred: 0 }

  if (!isNotificationsEnabled()) return summary

  try {
    const nowMs = opts?.nowMs ?? Date.now()
    const limit = opts?.limit ?? UNANSWERED_TICK_LIMIT
    const thresholdMs = opts?.thresholdMs ?? UNANSWERED_THRESHOLD_MS
    const now = new Date(nowMs)

    // Each finder fails alone: a broken handoff query must never cost the
    // reminders (or the other way round). Both are retried next minute.
    const handoffs = await findPendingHandoffs(now, limit).catch((err) => {
      console.error('[notifications][unansweredTick] handoff finder failed (swallowed)', { err: String(err) })
      return [] as Awaited<ReturnType<typeof findPendingHandoffs>>
    })
    const reminders = await findUnansweredConversations(new Date(nowMs - thresholdMs), limit)
    summary.scanned = handoffs.length + reminders.length

    const agencies = Array.from(new Set([...handoffs, ...reminders].map((r) => r.agencyId)))
    const quiet = await quietHoursByAgency(agencies)
    const isQuiet = (agencyId: number) => withinQuietHours(quiet.get(agencyId), now)

    const record = (outcome: 'enqueued' | 'skipped') => {
      if (outcome === 'enqueued') summary.enqueued++
      else summary.skipped++
    }
    for (const row of handoffs) {
      if (isQuiet(row.agencyId)) summary.deferred++
      else record(await emitHandoff(row, now))
    }
    for (const row of reminders) {
      if (isQuiet(row.agencyId)) summary.deferred++
      else record(await emitUnanswered(row, now))
    }

    if (summary.enqueued > 0 || summary.deferred > 0) {
      console.log('[notifications][unansweredTick]', summary)
    }
  } catch (err) {
    console.error('[notifications][unansweredTick] sweep failed (swallowed)', { err: String(err) })
  }

  return summary
}
