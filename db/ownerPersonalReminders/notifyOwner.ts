import type { Knex } from 'knex'
import { notifyEvent } from '@/lib/notifications/emit'

/**
 * R9: tell the reminder's OWNER, in the app, that it was not delivered
 * (`failed`) or that its delivery cannot be confirmed (`unknown`).
 *
 * Called inside the SAME transaction as the reminder's state transition, so the
 * notification job commits or rolls back with it. The enqueue itself runs in a
 * savepoint (notifyEvent `savepoint`), so a notification problem can never undo
 * or poison the reminder's own write.
 *
 * The owner is re-checked here, in this transaction: an unsuspended user of the
 * reminder's own agency. The recipient is then resolved again by the worker from
 * the database (`reminder_owner`): (agency, reminder) → that same owner, nobody else.
 *
 * Carries ids and the scheduled time only: never the reminder text, a phone
 * number, or a provider code. Once per reminder per kind (the event key).
 *
 * NOT called for: a sent reminder, a deferral (still pending), a cancellation
 * (consent withdrawn, opted out, inactive: the owner's own choice or state), or a
 * rate-limit retry (still pending).
 */
export type ReminderNotDelivered = 'failed' | 'unknown'

export async function notifyOwnerReminderNotDelivered(
  trx: Knex.Transaction,
  r: { id: number; agencyId: number; userId: number; remindAt: Date | string | number },
  kind: ReminderNotDelivered,
  nowMs: number,
): Promise<void> {
  const owner = await trx('users').where({ id: r.userId, agencyId: r.agencyId }).whereRaw('suspended IS NOT TRUE').first('id')
  if (!owner) return
  const remindAtMs = new Date(r.remindAt).getTime()
  await notifyEvent(
    {
      type: kind === 'failed' ? 'followup.reminder_failed' : 'followup.reminder_unconfirmed',
      agencyId: r.agencyId,
      entityType: 'personal_reminder',
      entityId: r.id,
      actorUserId: null,
      occurredAt: new Date(nowMs),
      payload: { remindAtMs: Number.isFinite(remindAtMs) ? remindAtMs : null },
    },
    { trx, savepoint: true },
  )
}
