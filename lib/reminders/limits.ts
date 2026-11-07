/**
 * Approved limits for personal reminders (architecture v1.1 B8, v1.3–v1.5) and
 * the deterministic action identity (v1.5 §3.2).
 */

/** Live reminders (`scheduled` or `claimed`) one owner may have at once. */
export const REMINDER_MAX_SCHEDULED_PER_USER = 50
/** Reminders due (or already sent) for one recipient in one business day. */
export const REMINDER_MAX_PER_RECIPIENT_DAY = 30

export type ReminderOp = 'create' | 'cancel' | 'reschedule'

/**
 * `rem_<reminderId>_v<version>_<op>`: the action id AND idempotency key for one
 * operation on one version of one reminder. The same request always maps to the
 * same `agent_actions` row and the same single approval token.
 */
export function reminderActionId(op: ReminderOp, reminderId: number, version: number): string {
  if (!Number.isSafeInteger(reminderId) || reminderId <= 0) throw new Error('reminderActionId: bad reminder id')
  if (!Number.isSafeInteger(version) || version <= 0) throw new Error('reminderActionId: bad version')
  return `rem_${reminderId}_v${version}_${op}`
}
