/**
 * OWNER_PERSONAL_REMINDERS_SEND_ENABLED: the environment kill switch for the
 * personal-reminder sender (Reminder Engine Phase 5). Only exactly `1` sends.
 * Anything else, absent included, is a DRY RUN: the tick monitors and counts but
 * claims nothing and calls Meta never. The database switch
 * (platform_whatsapp_send_controls."remindersEnabled") must ALSO be on.
 * Read per call.
 */
export function personalRemindersSendEnabled(): boolean {
  return process.env.OWNER_PERSONAL_REMINDERS_SEND_ENABLED === '1'
}

/** A claim older than this was interrupted before the gate: safe to return to `scheduled`. */
export const REMINDER_CLAIM_LEASE_MS = 2 * 60 * 1000
/** A dispatch older than this may have reached Meta: it becomes `unknown`, never resent. */
export const REMINDER_DISPATCH_LEASE_MS = 2 * 60 * 1000
/** The gate refuses while the monitor heartbeat is older than this (architecture v1.5/v1.6). */
export const MONITOR_STALE_MS = 5 * 60 * 1000
/** Approved (B4): delivery up to 60 minutes late; later is `too_late`. */
export const REMINDER_MAX_LATENESS_MS = 60 * 60 * 1000
/** Approved (B4): more than 5 minutes late, the message names the original time. */
export const REMINDER_LATE_NOTE_MS = 5 * 60 * 1000
/** Approved horizon: free text only while the owner's last verified message is under 23 hours old. */
export const REMINDER_WINDOW_MS = 23 * 60 * 60 * 1000
/** Reminders claimed per tick. */
export const REMINDER_CLAIMS_PER_TICK = 20
/** Text purge: 90 days after a terminal state (approved, B10). */
export const REMINDER_TEXT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
