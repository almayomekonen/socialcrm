import { db } from '@/config/db'
import { checkReminderWindow } from '@/lib/reminders/when'
import { insertReminderEvents } from './events'
import { limitBreached, lockOwnedReminder } from './lock'

/**
 * T4 cancel and T6 reschedule, by an approved owner card (architecture v1.2 A2,
 * §3). Both lock recipient → reminder and are guarded on the card's `version`,
 * so an outdated card writes nothing.
 *
 * CANCELLATION AND THE SEND GATE. Cancel succeeds only from `scheduled` or
 * `claimed`. Once the send gate has committed `dispatching`, the message can no
 * longer be stopped, and the answer says so (`in_flight` / `already_sent`)
 * instead of pretending.
 */

const T = 'owner_personal_reminders'

export type CancelOutcome =
  | { kind: 'cancelled' | 'already_cancelled'; reminderId: number }
  | { kind: 'not_found' }
  | { kind: 'refused'; reason: 'stale_version' | 'in_flight' | 'already_sent' | 'already_final' | 'not_scheduled' }

export async function cancelOwnReminder(input: {
  reminderId: number
  version: number
  actionId: string
  owner: { agencyId: number; userId: number }
  nowMs: number
}): Promise<CancelOutcome> {
  return db.transaction(async (trx) => {
    const r = await lockOwnedReminder(trx, input.reminderId, input.owner)
    if (!r) return { kind: 'not_found' as const }
    if (r.status === 'cancelled') return { kind: 'already_cancelled' as const, reminderId: r.id }
    if (r.status === 'dispatching' || r.status === 'unknown') return { kind: 'refused' as const, reason: 'in_flight' as const }
    if (r.status === 'sent') return { kind: 'refused' as const, reason: 'already_sent' as const }
    if (r.status === 'failed') return { kind: 'refused' as const, reason: 'already_final' as const }
    if (r.status !== 'scheduled' && r.status !== 'claimed') return { kind: 'refused' as const, reason: 'not_scheduled' as const }
    if (r.version !== input.version) return { kind: 'refused' as const, reason: 'stale_version' as const }

    const now = new Date(input.nowMs)
    const updated = await trx(T)
      .where({ id: r.id, version: input.version })
      .whereIn('status', ['scheduled', 'claimed'])
      .update({ status: 'cancelled', cancelReason: 'owner', cancelledAt: now, finalizedAt: now, updatedAt: trx.fn.now() })
    if (Number(updated) !== 1) return { kind: 'refused' as const, reason: 'not_scheduled' as const }
    await insertReminderEvents(trx, [
      { agencyId: r.agencyId, userId: r.userId, recipientId: r.recipientId, reminderId: r.id, type: 'cancelled', actorKind: 'owner', actionId: input.actionId, fromStatus: r.status, toStatus: 'cancelled', reason: 'owner' },
    ])
    return { kind: 'cancelled' as const, reminderId: r.id }
  })
}

export type RescheduleOutcome =
  | { kind: 'rescheduled' | 'replayed'; reminderId: number; version: number }
  | { kind: 'rejected'; reason: 'due_passed' | 'lead_time' | 'horizon' | 'forecast' }
  | { kind: 'not_found' }
  | { kind: 'refused'; reason: 'stale_version' | 'not_reschedulable' }

const WINDOW_REASON = { past: 'due_passed', too_soon: 'lead_time', beyond_horizon: 'horizon' } as const

export async function rescheduleOwnReminder(input: {
  reminderId: number
  version: number
  remindAtMs: number
  /** Meta timestamp (ms) of the owner's verified reschedule request: the new horizon anchor. */
  requestAnchorMs: number
  actionId: string
  owner: { agencyId: number; userId: number }
  nowMs: number
}): Promise<RescheduleOutcome> {
  return db.transaction(async (trx) => {
    const r = await lockOwnedReminder(trx, input.reminderId, input.owner)
    if (!r) return { kind: 'not_found' as const }
    // A replay of this same action: the version already moved and the time is the new one.
    if (r.version === input.version + 1 && r.remindAt.getTime() === input.remindAtMs) {
      return { kind: 'replayed' as const, reminderId: r.id, version: r.version }
    }
    if (r.status !== 'scheduled') return { kind: 'refused' as const, reason: 'not_reschedulable' as const }
    if (r.version !== input.version) return { kind: 'refused' as const, reason: 'stale_version' as const }

    const outside = checkReminderWindow(input.remindAtMs, input.requestAnchorMs, input.nowMs)
    if (outside) return { kind: 'rejected' as const, reason: WINDOW_REASON[outside as keyof typeof WINDOW_REASON] ?? 'due_passed' }
    if (await limitBreached(trx, r, input.remindAtMs)) return { kind: 'rejected' as const, reason: 'forecast' as const }

    const at = new Date(input.remindAtMs)
    const updated = await trx(T)
      .where({ id: r.id, status: 'scheduled', version: input.version })
      .update({ remindAt: at, nextAttemptAt: at, version: input.version + 1, updatedAt: trx.fn.now() })
    if (Number(updated) !== 1) return { kind: 'refused' as const, reason: 'stale_version' as const }
    await insertReminderEvents(trx, [
      {
        agencyId: r.agencyId, userId: r.userId, recipientId: r.recipientId, reminderId: r.id, type: 'rescheduled', actorKind: 'owner',
        actionId: input.actionId, fromStatus: 'scheduled', toStatus: 'scheduled', versionAfter: input.version + 1,
        remindAtBefore: r.remindAt, remindAtAfter: at,
      },
    ])
    return { kind: 'rescheduled' as const, reminderId: r.id, version: input.version + 1 }
  })
}
