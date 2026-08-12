/**
 * Follow-up due / overdue notification tick — Task 5.
 *
 * Writers (`setLeadFollowUp` / clear / outcome) only mutate `nextFollowUpAt`.
 * This tick reads CURRENT persisted state and enqueues via `notifyEvent`:
 *
 *   due     — nextFollowUpAt <= now AND nextFollowUpAt >= dayStart (BUSINESS_TZ)
 *   overdue — nextFollowUpAt < dayStart (BUSINESS_TZ)
 *
 * Day bounds come from `lib/today/time.businessDayBounds` (INV-8) — never a
 * third clock, never browser TZ. Idempotency is eventKey
 * `followup.{due|overdue}:{agency}:lead:{id}:at:{nextFollowUpAtMs}`.
 */

import {
  findFollowupsDue,
  findFollowupsOverdue,
  FOLLOWUP_TICK_LIMIT,
  type FollowupCandidateRow,
} from '@/db/notifications/followups'
import { BUSINESS_TZ } from '@/lib/today/constants'
import { businessDayBounds } from '@/lib/today/time'
import { notifyEvent } from './emit'
import { isNotificationsEnabled } from './flags'
import { leadDisplayName } from './leadName'

export type FollowupTickSummary = {
  scannedDue: number
  scannedOverdue: number
  enqueuedDue: number
  enqueuedOverdue: number
  skipped: number
}

function followUpAtMs(row: FollowupCandidateRow): number {
  return row.nextFollowUpAt.getTime()
}

async function emitFollowup(
  type: 'followup.due' | 'followup.overdue',
  row: FollowupCandidateRow,
  occurredAt: Date,
): Promise<'enqueued' | 'skipped'> {
  const at = followUpAtMs(row)
  if (!Number.isFinite(at) || at <= 0) return 'skipped'

  const result = await notifyEvent({
    type,
    agencyId: row.agencyId,
    entityType: 'lead',
    entityId: row.id,
    actorUserId: null,
    occurredAt,
    payload: {
      leadName: leadDisplayName(row),
      followUpAt: at,
    },
  })
  return result.enqueued ? 'enqueued' : 'skipped'
}

export async function tickFollowupNotifications(opts?: {
  nowMs?: number
  limit?: number
}): Promise<FollowupTickSummary> {
  const summary: FollowupTickSummary = {
    scannedDue: 0,
    scannedOverdue: 0,
    enqueuedDue: 0,
    enqueuedOverdue: 0,
    skipped: 0,
  }

  if (!isNotificationsEnabled()) return summary

  try {
    const nowMs = opts?.nowMs ?? Date.now()
    const limit = opts?.limit ?? FOLLOWUP_TICK_LIMIT
    const { dayStart } = businessDayBounds(nowMs, BUSINESS_TZ)
    const now = new Date(nowMs)
    const dayStartDate = new Date(dayStart)

    const dueRows = await findFollowupsDue(now, dayStartDate, limit)
    summary.scannedDue = dueRows.length
    for (const row of dueRows) {
      const outcome = await emitFollowup('followup.due', row, now)
      if (outcome === 'enqueued') summary.enqueuedDue++
      else summary.skipped++
    }

    const overdueRows = await findFollowupsOverdue(dayStartDate, limit)
    summary.scannedOverdue = overdueRows.length
    for (const row of overdueRows) {
      const outcome = await emitFollowup('followup.overdue', row, now)
      if (outcome === 'enqueued') summary.enqueuedOverdue++
      else summary.skipped++
    }

    if (summary.enqueuedDue > 0 || summary.enqueuedOverdue > 0) {
      console.log('[notifications][followupTick]', summary)
    }
  } catch (err) {
    console.error('[notifications][followupTick] sweep failed (swallowed)', { err: String(err) })
  }

  return summary
}
