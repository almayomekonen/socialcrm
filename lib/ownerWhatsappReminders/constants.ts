/**
 * Owner WhatsApp reminders: fixed product rules (approved) and operating limits.
 */

/** A hand-off is reminded about once it has waited this long with no human reply. */
export const REMINDER_DELAY_MS = 120 * 60 * 1000
/** Hand-offs older than this are never reminded about (also the send-time cut-off). */
export const REMINDER_MAX_AGE_MS = 24 * 60 * 60 * 1000
/** At most one reminder per conversation per this window (sent, sending or unknown). */
export const REMINDER_COOLDOWN_MS = 12 * 60 * 60 * 1000
/** Fallback recipients: at most this many activated ADMIN users. */
export const MAX_ADMIN_RECIPIENTS = 3

/** Candidates examined per tick, and sends attempted per tick. */
export const CANDIDATES_PER_TICK = 50
export const SENDS_PER_TICK = 10
/** Graph request timeout. Past it the outcome is unknown and never retried. */
export const SEND_TIMEOUT_MS = 8_000
/** A delivery left in `sending` longer than this is marked unknown (never resent). */
export const SENDING_LEASE_MS = 2 * 60 * 1000
/** Rate-limited sends: retry delays; past the last one the delivery fails. */
export const RATE_LIMIT_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000] as const
/** After an account-wide rejection, no send is attempted for this long. */
export const ACCOUNT_PAUSE_MS = 60 * 60 * 1000

/** Advisory-lock namespace (int4) for per-conversation reminder work. */
export const REMINDER_CONVERSATION_LOCK_NAMESPACE = 20261013
/** Advisory-lock namespace (int4) serialising one-off test sends per recipient. */
export const ONE_OFF_RECIPIENT_LOCK_NAMESPACE = 20261018
/** One-off test send, `immediate` mode only: the hand-off's minimum wait. The cron keeps REMINDER_DELAY_MS. */
export const ONE_OFF_IMMEDIATE_DELAY_MS = 60_000

/**
 * The template, as it must be submitted to Meta (UTILITY, Hebrew). Nothing in
 * this PR submits it. Body variable {{1}} is the waiting time; the URL button's
 * variable is the conversation id. No lead name or customer data, by decision.
 */
export const REMINDER_TEMPLATE = {
  name: 'lead_followup_alert',
  language: 'he',
  category: 'UTILITY',
  body: 'עדכון מ-SocialCRM: יש ליד שממתין למענה שלך כבר {{1}}. אפשר להמשיך את השיחה ישירות ב-SocialCRM.',
  footer: 'להפסקת ההתראות השיבו: הסר',
  button: { type: 'URL', text: 'פתיחת השיחה', url: 'https://getsocialcrm.com/inbox?conversation={{1}}' },
} as const
