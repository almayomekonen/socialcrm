import type { SkipReason } from './types'

/**
 * The single Hebrew copy map for the engine's activity log. Strings marked
 * (spec) are verbatim from docs/email-automations-plan.md §8–§9 and must not
 * drift — copy.test.ts pins them. Raw provider errors never reach the UI
 * (the whatsappErrorCopy precedent).
 */
export const SKIP_REASON_COPY: Record<SkipReason, string> = {
  origin_import: 'לא נשלח — לידים מיובאים אינם נכללים באוטומציות',
  lead_deleted: 'לא נשלח — הליד נמחק לפני מועד השליחה', // (spec)
  premise_expired: 'לא נשלח — הליד כבר טופל', // (spec)
  suppressed: 'לא נשלח — הליד הוסר מרשימת התפוצה', // (spec)
  opted_out: 'לא נשלח — הליד ביקש להפסיק לקבל הודעות',
  no_email: 'לא נשלח — אין כתובת אימייל לליד', // (spec)
  no_phone: 'לא נשלח — אין מספר טלפון לליד',
  address_undeliverable: 'לא נשלח — כתובת האימייל לא תקינה', // (spec §9, "לא נשלח —" prefix unified)
  already_sent: 'לא נשלח — כבר נשלח לליד הזה', // (spec)
  // Channel-neutral wording: since the messaging action shipped, these caps
  // count every automated MESSAGE a lead received today — email, WhatsApp, and
  // the instant-response reply — not emails alone. Saying "אימיילים" would now
  // be a false explanation of a WhatsApp skip.
  lead_daily_cap: 'לא נשלח — הליד קיבל היום את מספר ההודעות המרבי',
  agency_daily_cap: 'לא נשלח — הגעתם למכסת ההודעות היומית',
  quiet_hours: 'לא נשלח — מחוץ לחלון השליחה שהוגדר',
  meeting_missing: 'לא נשלח — הפגישה לא נמצאה',
  meeting_cancelled: 'לא נשלח — הפגישה בוטלה',
  meeting_passed: 'לא נשלח — מועד הפגישה כבר עבר',
  action_unavailable: 'לא נשלח — הפעולה אינה זמינה כעת. נדרשת בדיקה בהגדרות.',
}

// Failure copy (worker-side outcomes, not law skips — Phase 4 consumes these).
export const FAILURE_COPY = {
  transient: 'לא נשלח — תקלה זמנית, ננסה שוב', // (spec)
  terminal: 'לא נשלח — השליחה נכשלה',
} as const

// Delay-accuracy honesty (ADR-011: cron cadence bounds accuracy; never
// presented as exact). Phase 6 shows this next to the timing slot.
export const TIMING_ACCURACY_COPY = 'שליחה מתוזמנת מתבצעת תוך מספר דקות מהמועד שנקבע'
