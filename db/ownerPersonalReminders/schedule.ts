import { db } from '@/config/db'
import { checkReminderWindow } from '@/lib/reminders/when'
import { insertReminderEvents } from './events'
import { limitBreached, lockOwnedReminder, recipientAllowsPersonalReminders, type LockedReminder } from './lock'
import type { Knex } from 'knex'

/**
 * T5: an approved card schedules its draft (architecture v1.2 §3, v1.6 §2).
 *
 * At most once, by the database: the UPDATE is guarded on `status='proposed'`,
 * the card's `version` and `createdByActionId IS NULL`, and the trigger forbids
 * any return to `proposed` and makes `createdByActionId` permanent. A replay of
 * the SAME action (a retry or a recovery) finds its own id on the row and
 * reports success without writing.
 *
 * Re-checked at execution, with the approved rules:
 *   - the window: more than 60 s after `nowMs` (the caller passes the effective
 *     now: the later of server time and the verified tap time), and at most 23 h
 *     after the request's anchor;
 *   - the limits: 50 live reminders per owner, 30 per recipient per business day;
 *   - consent: the recipient is active and holds v5 (Phase 4); anything else is
 *     discarded as 'consent'.
 * If any of these fails, the draft is DISCARDED with the reason, never kept
 * waiting.
 */

const T = 'owner_personal_reminders'

export type ScheduleOutcome =
  | { kind: 'scheduled' | 'replayed'; reminderId: number }
  | { kind: 'rejected'; reason: 'due_passed' | 'lead_time' | 'horizon' | 'forecast' | 'consent' }
  | { kind: 'not_found' }
  | { kind: 'refused'; reason: 'draft_unavailable' | 'scheduled_by_other' | 'args_mismatch' }

const WINDOW_REASON = { past: 'due_passed', too_soon: 'lead_time', beyond_horizon: 'horizon' } as const

async function discard(trx: Knex.Transaction, r: LockedReminder, reason: 'due_passed' | 'lead_time' | 'horizon' | 'forecast' | 'consent', actionId: string, now: Date) {
  await trx(T)
    .where({ id: r.id, status: 'proposed' })
    .update({ status: 'discarded', discardReason: reason, text: null, finalizedAt: now, updatedAt: trx.fn.now() })
  await insertReminderEvents(trx, [
    { agencyId: r.agencyId, userId: r.userId, recipientId: r.recipientId, reminderId: r.id, type: 'discarded', actorKind: 'system', actionId, fromStatus: 'proposed', toStatus: 'discarded', reason },
  ])
}

export async function scheduleApprovedDraft(input: {
  reminderId: number
  version: number
  remindAtMs: number
  actionId: string
  owner: { agencyId: number; userId: number }
  nowMs: number
}): Promise<ScheduleOutcome> {
  return db.transaction(async (trx) => {
    const r = await lockOwnedReminder(trx, input.reminderId, input.owner)
    if (!r) return { kind: 'not_found' as const }
    if (r.createdByActionId === input.actionId) return { kind: 'replayed' as const, reminderId: r.id }
    if (r.createdByActionId) return { kind: 'refused' as const, reason: 'scheduled_by_other' as const }
    if (r.status !== 'proposed') return { kind: 'refused' as const, reason: 'draft_unavailable' as const }
    if (r.version !== input.version || r.remindAt.getTime() !== input.remindAtMs) return { kind: 'refused' as const, reason: 'args_mismatch' as const }

    const now = new Date(input.nowMs)
    // Fail closed on consent: the recipient must be active and hold v5, read under its lock.
    if (!recipientAllowsPersonalReminders(r)) {
      await discard(trx, r, 'consent', input.actionId, now)
      return { kind: 'rejected' as const, reason: 'consent' as const }
    }
    const outside = checkReminderWindow(r.remindAt.getTime(), r.anchorMessageTs * 1000, input.nowMs)
    if (outside) {
      const reason = WINDOW_REASON[outside as keyof typeof WINDOW_REASON] ?? 'due_passed'
      await discard(trx, r, reason, input.actionId, now)
      return { kind: 'rejected' as const, reason }
    }
    if (await limitBreached(trx, r, r.remindAt.getTime())) {
      await discard(trx, r, 'forecast', input.actionId, now)
      return { kind: 'rejected' as const, reason: 'forecast' as const }
    }

    const updated = await trx(T)
      .where({ id: r.id, status: 'proposed', version: input.version })
      .whereNull('createdByActionId')
      .update({ status: 'scheduled', nextAttemptAt: r.remindAt, createdByActionId: input.actionId, updatedAt: trx.fn.now() })
    if (Number(updated) !== 1) return { kind: 'refused' as const, reason: 'draft_unavailable' as const }
    await insertReminderEvents(trx, [
      { agencyId: r.agencyId, userId: r.userId, recipientId: r.recipientId, reminderId: r.id, type: 'scheduled', actorKind: 'owner', actionId: input.actionId, fromStatus: 'proposed', toStatus: 'scheduled', versionAfter: r.version },
    ])
    return { kind: 'scheduled' as const, reminderId: r.id }
  })
}
