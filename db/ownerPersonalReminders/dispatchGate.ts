import { db } from '@/config/db'
import { consentCoversPersonalReminders } from '@/lib/whatsapp/platform/consentText'
import { insertReminderEvents } from './events'

/**
 * T2, the final send gate: the CONSENT part, which is Reminder Engine Phase 4
 * (architecture v1.2 A2, v1.6). One short transaction. No network call ever
 * happens inside it.
 *
 *   1. read `recipientId` without a lock;
 *   2. lock the recipient row (L1), then the reminder row (L2), the same order
 *      every consent change and opt-out uses, so they serialize, never deadlock;
 *   3. the reminder must still be `claimed` by THIS claim token;
 *   4. FAIL CLOSED: the recipient must be `active`, belong to the reminder's
 *      owner, and hold consent v5. Otherwise the reminder is CANCELLED, never sent;
 *   5. only then `dispatching` (+ `dispatchedAt`). Committing that is the point
 *      of no return.
 *
 * Phase 5 adds, inside this same transaction and before step 5: the window,
 * lateness, capacity reservations, the shared account pause, the kill switch
 * and the monitor heartbeat. Nothing calls this yet: no sender is wired, so
 * personal reminders cannot be sent at all.
 */

const T = 'owner_personal_reminders'

export type GateResult =
  | { result: 'dispatching' }
  | { result: 'cancelled'; reason: 'opted_out' | 'recipient_inactive' | 'consent_withdrawn' }
  | { result: 'not_claimed'; status: string | null }

export async function enterDispatch(input: { reminderId: number; claimToken: string; nowMs: number }): Promise<GateResult> {
  return db.transaction(async (trx) => {
    const peek = (await trx(T).where({ id: input.reminderId }).first('recipientId')) as { recipientId: string | number } | undefined
    if (!peek) return { result: 'not_claimed' as const, status: null }
    const recipient = (await trx('owner_whatsapp_recipients')
      .where({ id: peek.recipientId })
      .forUpdate()
      .first('status', 'consentTextVersion', 'agencyId', 'userId')) as Record<string, unknown> | undefined
    const r = (await trx(T)
      .where({ id: input.reminderId })
      .forUpdate()
      .first('id', 'agencyId', 'userId', 'recipientId', 'status', 'claimToken')) as Record<string, unknown> | undefined
    if (!r || r.status !== 'claimed' || r.claimToken !== input.claimToken) return { result: 'not_claimed' as const, status: (r?.status as string) ?? null }

    const now = new Date(input.nowMs)
    const sameOwner = !!recipient && Number(recipient.agencyId) === Number(r.agencyId) && Number(recipient.userId) === Number(r.userId)
    const reason: 'opted_out' | 'recipient_inactive' | 'consent_withdrawn' | null =
      !recipient || !sameOwner
        ? 'recipient_inactive'
        : recipient.status === 'opted_out'
          ? 'opted_out'
          : recipient.status !== 'active'
            ? 'recipient_inactive'
            : !consentCoversPersonalReminders(recipient.consentTextVersion as string)
              ? 'consent_withdrawn'
              : null
    const ev = { agencyId: Number(r.agencyId), userId: Number(r.userId), recipientId: Number(r.recipientId), reminderId: Number(r.id), actorKind: 'system' as const, fromStatus: 'claimed' }

    if (reason) {
      await trx(T)
        .where({ id: r.id, status: 'claimed' })
        .update({ status: 'cancelled', cancelReason: reason, cancelledAt: now, finalizedAt: now, updatedAt: trx.fn.now() })
      await insertReminderEvents(trx, [{ ...ev, type: 'cancelled', toStatus: 'cancelled', reason }])
      return { result: 'cancelled' as const, reason }
    }

    await trx(T).where({ id: r.id, status: 'claimed' }).update({ status: 'dispatching', dispatchedAt: now, updatedAt: trx.fn.now() })
    await insertReminderEvents(trx, [{ ...ev, type: 'dispatched', toStatus: 'dispatching' }])
    return { result: 'dispatching' as const }
  })
}
