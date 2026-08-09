import type { QuoteTemplateState } from '@/db/quotes/templates'

/**
 * Hebrew copy for the template surfaces.
 *
 * Actions return machine codes and the client owns the wording — the house
 * convention (`sheetOptions.ts` for automations, `issueErrorMessages.ts` for
 * billing). One map, so a reason can never be shown raw.
 */

const ERRORS: Record<string, string> = {
  forbidden: 'אין לך הרשאה לנהל תבניות הצעות מחיר',
  not_found: 'התבנית לא נמצאה',
  name_taken: 'כבר קיימת תבנית פעילה בשם הזה',
  invalid_input: 'לא ניתן לשמור את התבנית',
  name_required: 'יש להזין שם לתבנית',
  name_too_long: 'שם התבנית ארוך מדי',
  title_too_long: 'כותרת ההצעה ארוכה מדי',
  validity_invalid: 'תוקף ההצעה חייב להיות בין 1 ל-90 ימים',
  items_required: 'יש להוסיף לפחות שורה אחת',
  too_many_items: 'יותר מדי שורות בתבנית',
  item_title_required: 'לכל שורה צריך תיאור',
  item_title_too_long: 'תיאור השורה ארוך מדי',
  item_quantity_invalid: 'הכמות חייבת להיות גדולה מאפס',
  item_price_invalid: 'המחיר אינו תקין',
  item_discount_invalid: 'ההנחה אינה תקינה',
}

export const quoteTemplateErrorMessage = (reason: string) => ERRORS[reason] ?? 'לא ניתן לשמור'

export const TEMPLATE_STATE_LABEL: Record<QuoteTemplateState, string> = {
  active: 'פעילה',
  archived: 'בארכיון',
}

/** Relative time, Hebrew — the `AutomationCard.updatedLabel` shape. */
export function updatedLabel(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return null
  const mins = Math.max(0, Math.round((now - then) / 60000))
  if (mins < 1) return 'עודכן עכשיו'
  if (mins < 60) return `עודכן לפני ${mins} דק׳`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `עודכן לפני ${hours} ש׳`
  const days = Math.round(hours / 24)
  if (days === 1) return 'עודכן אתמול'
  return `עודכן לפני ${days} ימים`
}

/** "14 ימים" / "יום אחד" — the validity window as the admin reads it. */
export const validityLabel = (days: number): string => (days === 1 ? 'יום אחד' : `${days} ימים`)
