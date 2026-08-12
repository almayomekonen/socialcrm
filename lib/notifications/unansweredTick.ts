/**
 * message.unanswered notification tick — Task 7.
 *
 * Ingest only persists inbound/outbound and bumps conversation denorm fields.
 * This tick reads CURRENT persisted state and enqueues via `notifyEvent`:
 *
 *   open conversation, lead not closed/lost, lastDirection = inbound,
 *   lastInboundAt <= now - 30m, no outbound after the inbound head.
 *
 * Idempotency is eventKey
 * `message.unanswered:{agency}:conversation:{id}:msg:{lastInboundMessageId}`.
 * Read/seen and assignment do NOT clear unanswered — only outbound does.
 */

import {
  findUnansweredConversations,
  UNANSWERED_THRESHOLD_MS,
  UNANSWERED_TICK_LIMIT,
  type UnansweredCandidateRow,
} from '@/db/notifications/unanswered'
import { notifyEvent } from './emit'
import { isNotificationsEnabled } from './flags'
import { leadDisplayName } from './leadName'

export type UnansweredTickSummary = {
  scanned: number
  enqueued: number
  skipped: number
}

async function emitUnanswered(
  row: UnansweredCandidateRow,
  occurredAt: Date,
): Promise<'enqueued' | 'skipped'> {
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

export async function tickUnansweredNotifications(opts?: {
  nowMs?: number
  limit?: number
  thresholdMs?: number
}): Promise<UnansweredTickSummary> {
  const summary: UnansweredTickSummary = { scanned: 0, enqueued: 0, skipped: 0 }

  if (!isNotificationsEnabled()) return summary

  try {
    const nowMs = opts?.nowMs ?? Date.now()
    const limit = opts?.limit ?? UNANSWERED_TICK_LIMIT
    const thresholdMs = opts?.thresholdMs ?? UNANSWERED_THRESHOLD_MS
    const thresholdCutoff = new Date(nowMs - thresholdMs)
    const now = new Date(nowMs)

    const rows = await findUnansweredConversations(thresholdCutoff, limit)
    summary.scanned = rows.length
    for (const row of rows) {
      const outcome = await emitUnanswered(row, now)
      if (outcome === 'enqueued') summary.enqueued++
      else summary.skipped++
    }

    if (summary.enqueued > 0) {
      console.log('[notifications][unansweredTick]', summary)
    }
  } catch (err) {
    console.error('[notifications][unansweredTick] sweep failed (swallowed)', { err: String(err) })
  }

  return summary
}
