/**
 * Operational alerts for personal-reminder delivery. ONE structured log line per
 * event, with a fixed prefix a log monitor (the existing Axiom drain) can match:
 *
 *   [personal-reminders][alert] <kind> { …ids and codes… }
 *
 * Kinds (each is something an operator must look at, never routine traffic):
 *   send_failed        Meta rejected a dispatched reminder (definite non-delivery)
 *   send_unknown       the outcome is ambiguous; it is NEVER resent automatically
 *   gate_failed        the send gate refused a due reminder (cap, window, pricing, lateness)
 *   enabled_blocked    delivery is switched ON in the database but cannot run
 *                      (a missing control, the heartbeat, credentials, the account pause)
 *   delivery_deferred  a due reminder was handed back by the gate (monitor stale,
 *                      account paused, kill switch)
 *
 * Never logged: reminder text, phone numbers, tokens. Ids and codes only.
 */

export type ReminderAlertKind = 'send_failed' | 'send_unknown' | 'gate_failed' | 'enabled_blocked' | 'delivery_deferred'

export const ALERT_PREFIX = '[personal-reminders][alert]'

export function reminderAlert(kind: ReminderAlertKind, fields: Record<string, string | number | boolean | null | string[]>): void {
  const line = `${ALERT_PREFIX} ${kind}`
  if (kind === 'send_failed' || kind === 'send_unknown' || kind === 'enabled_blocked') console.error(line, fields)
  else console.warn(line, fields)
}
