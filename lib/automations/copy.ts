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
  no_email: 'לא נשלח — אין כתובת אימייל לליד', // (spec)
  address_undeliverable: 'לא נשלח — כתובת האימייל לא תקינה', // (spec §9, "לא נשלח —" prefix unified)
  already_sent: 'לא נשלח — כבר נשלח לליד הזה', // (spec)
  lead_daily_cap: 'לא נשלח — הליד קיבל היום את מספר האימיילים המרבי',
  agency_daily_cap: 'לא נשלח — הגעתם למכסת האימיילים היומית',
  quiet_hours: 'לא נשלח — מחוץ לחלון השליחה שהוגדר',
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
