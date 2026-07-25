/**
 * Approved Hebrew copy + constants for ready-made messages.
 *
 * Single source of truth — mirrors `lib/connections/messages.ts`. statusCopy,
 * validate, and components read from here; no other module defines this copy, so
 * the wording cannot drift. No Meta terminology appears in any user-facing string.
 */
import type { RejectionCategory, TemplateStatus } from './types'

/** Status pill labels (RFC §2 / UX spec §6). */
export const TEMPLATE_STATUS_LABELS: Record<TemplateStatus, string> = {
  pending: 'בבדיקת וואטסאפ',
  approved: 'מוכנה לשליחה',
  rejected: 'נדחתה',
  paused: 'מושהית',
  disabled: 'לא פעילה',
}

/** Rejection copy per bucket — actionable, human, never the raw Meta reason (RFC §4). */
export const TEMPLATE_REJECTION_COPY: Record<RejectionCategory, string> = {
  invalid_format: 'ההודעה לא אושרה — הניסוח לא תקין. כדאי לפשט את הטקסט ולנסות שוב.',
  policy: 'ההודעה לא אושרה — התוכן נוגד את מדיניות וואטסאפ. כדאי לנסח מחדש בלי תוכן שיווקי אגרסיבי.',
  content_mismatch: 'ההודעה לא אושרה — מטרת ההודעה לא תואמת לתוכן. כדאי לבחור מטרה אחרת או לשנות את הנוסח.',
  generic: 'וואטסאפ לא אישרה את ההודעה. כדאי לנסח מחדש בפשטות ולנסות שוב.',
}

/** Validation messages (used by validate.ts). */
export const TEMPLATE_VALIDATION_COPY = {
  titleRequired: 'צריך לתת שם להודעה.',
  titleTooLong: 'שם ההודעה ארוך מדי.',
  bodyRequired: 'צריך לכתוב תוכן להודעה.',
  bodyTooLong: 'תוכן ההודעה ארוך מדי.',
  purposeRequired: 'צריך לבחור את מטרת ההודעה.',
  unknownVariable: 'יש פרט אישי לא מוכר בהודעה.',
  manualPlaceholder: 'אין להקליד סוגריים מסולסלים ({{ }}) בהודעה. להוספת פרטים אישיים השתמשו בכפתורי הפרטים.',
} as const

/**
 * The CLOSED variable set (RFC §10). `token` is the chip the owner sees; `field`
 * is the CRM value it resolves to at send time (Sprint 6); `defaultSample` is the
 * preview/Meta-example value. No free-form/custom variables.
 */
export const TEMPLATE_VARIABLES = [
  { token: 'שם הליד', field: 'leadFirstName', defaultSample: 'דוד' },
  { token: 'שם העסק', field: 'businessName', defaultSample: 'העסק שלי' },
] as const

export const ALLOWED_VARIABLE_TOKENS: readonly string[] = TEMPLATE_VARIABLES.map((v) => v.token)

/** Length bounds. Body cap mirrors Meta's ~1024-char BODY limit. */
export const TEMPLATE_LIMITS = { titleMax: 120, bodyMax: 1024 } as const
