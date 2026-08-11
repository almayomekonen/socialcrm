import type { StatusRole } from '@/lib/StatusBadge'
import type { SupportCategory, SupportErrorCode, SupportKind, SupportStatus } from './vocabulary'

/**
 * Every customer-facing string in the Support Center, keyed by a closed
 * vocabulary value.
 *
 * `Record<K, …>` throughout: adding a status or category without deciding its
 * Hebrew is a compile error. That is the whole reason this file exists
 * separately from the components.
 *
 * The voice is the product's own — plain, calm, and never technical. A customer
 * reading any of this must never meet an internal concept: no agencyId, no
 * connection id, no error code, no resolver name, no internal status that has
 * no meaning to them.
 */

export const STATUS_COPY: Record<SupportStatus, { label: string; role: StatusRole }> = {
  open: { label: 'נפתחה', role: 'info' },
  in_progress: { label: 'בטיפול', role: 'warning' },
  // Written as an instruction, not a state name — this is the one status that
  // asks the reader to do something, and "ממתינה לתשובה" would leave them
  // wondering whose.
  waiting_for_customer: { label: 'ממתינה לתשובתך', role: 'warning' },
  resolved: { label: 'נסגרה', role: 'success' },
}

export const CATEGORY_COPY: Record<SupportCategory, string> = {
  leads: 'לידים',
  whatsapp: 'WhatsApp',
  meta: 'Facebook ו-Instagram',
  automations: 'אוטומציות',
  ai: 'עוזר חכם',
  billing: 'מנוי ותשלום',
  account: 'חשבון והגדרות',
  integrations: 'אינטגרציות',
  other: 'אחר',
}

/**
 * The tile wording is the feature. Someone whose WhatsApp will not connect
 * recognises themselves in "יש לי תקלה" instantly, where "פתיחת פנייה" would
 * make them classify their own problem before they could ask for help.
 */
export const KIND_COPY: Record<
  SupportKind,
  { tileTitle: string; tileDescription: string; formTitle: string }
> = {
  problem: {
    tileTitle: 'יש לי תקלה',
    tileDescription: 'משהו ב-SocialCRM לא עובד',
    // The form IS the question — not "open a ticket".
    formTitle: 'מה קרה?',
  },
  question: {
    tileTitle: 'יש לי שאלה',
    tileDescription: 'עזרה בשימוש במערכת',
    formTitle: 'מה השאלה?',
  },
}

const ERRORS: Record<SupportErrorCode, string> = {
  forbidden: 'אין לך הרשאה לפעולה הזו',
  not_found: 'הפנייה לא נמצאה',
  invalid_subject: 'צריך לכתוב נושא קצר לפנייה',
  invalid_body: 'צריך לכתוב מה קרה',
  invalid_category: 'צריך לבחור נושא מהרשימה',
  rate_limited: 'נשלחו הרבה פניות בזמן קצר. אפשר לנסות שוב בעוד שעה.',
}

export function supportErrorMessage(code: SupportErrorCode): string {
  return ERRORS[code] ?? 'הפעולה נכשלה. נסו שוב.'
}

/**
 * The only two labels a message can carry in the customer's thread.
 *
 * `support` is deliberately a TEAM, not a person: the platform owner's identity
 * is stored for internal attribution and must never reach the customer.
 */
export const AUTHOR_LABEL = {
  self: 'את/ה',
  support: 'צוות SocialCRM',
} as const
