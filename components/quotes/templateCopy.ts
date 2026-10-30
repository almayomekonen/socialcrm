import type { QuoteTemplateState } from '@/db/quotes/templates'
import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * Hebrew copy for the template surfaces.
 *
 * Actions return machine codes and the client owns the wording — the house
 * convention (`sheetOptions.ts` for automations, `issueErrorMessages.ts` for
 * billing). One map, so a reason can never be shown raw.
 *
 * Every producer takes an optional interface `locale` (default Hebrew). Hebrew
 * returns the constants below unchanged; other languages word the same code
 * from the `admin.quotes` catalog (a test pins catalog = constants).
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

const ERROR_KEY: Record<string, MessageKey> = {
  forbidden: 'admin.quotes.error.forbidden',
  not_found: 'admin.quotes.error.not_found',
  name_taken: 'admin.quotes.error.name_taken',
  invalid_input: 'admin.quotes.error.invalid_input',
  name_required: 'admin.quotes.error.name_required',
  name_too_long: 'admin.quotes.error.name_too_long',
  title_too_long: 'admin.quotes.error.title_too_long',
  validity_invalid: 'admin.quotes.error.validity_invalid',
  items_required: 'admin.quotes.error.items_required',
  too_many_items: 'admin.quotes.error.too_many_items',
  item_title_required: 'admin.quotes.error.item_title_required',
  item_title_too_long: 'admin.quotes.error.item_title_too_long',
  item_quantity_invalid: 'admin.quotes.error.item_quantity_invalid',
  item_price_invalid: 'admin.quotes.error.item_price_invalid',
  item_discount_invalid: 'admin.quotes.error.item_discount_invalid',
}

export const quoteTemplateErrorMessage = (reason: string, locale: UiLocale = 'he') => {
  if (locale === 'he') return ERRORS[reason] ?? 'לא ניתן לשמור'
  const t = translatorFor(locale)
  return ERROR_KEY[reason] && Object.hasOwn(ERRORS, reason) ? t(ERROR_KEY[reason]) : t('admin.quotes.error.unknown')
}

export const TEMPLATE_STATE_LABEL: Record<QuoteTemplateState, string> = {
  active: 'פעילה',
  archived: 'בארכיון',
}

/** A template's state word in the interface language (Hebrew: `TEMPLATE_STATE_LABEL`). */
export function templateStateLabel(state: QuoteTemplateState, locale: UiLocale = 'he'): string {
  if (locale === 'he') return TEMPLATE_STATE_LABEL[state]
  return translatorFor(locale)(state === 'archived' ? 'admin.quotes.state.archived' : 'admin.quotes.state.active')
}

/** Relative time, Hebrew — the `AutomationCard.updatedLabel` shape. Other languages: `admin.quotes.updated.*`. */
export function updatedLabel(iso: string | null | undefined, now: number, locale: UiLocale = 'he'): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return null
  const mins = Math.max(0, Math.round((now - then) / 60000))
  if (locale !== 'he') return updatedLabelIn(mins, locale)
  if (mins < 1) return 'עודכן עכשיו'
  if (mins < 60) return `עודכן לפני ${mins} דק׳`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `עודכן לפני ${hours} ש׳`
  const days = Math.round(hours / 24)
  if (days === 1) return 'עודכן אתמול'
  return `עודכן לפני ${days} ימים`
}

function updatedLabelIn(mins: number, locale: UiLocale): string {
  const t = translatorFor(locale)
  if (mins < 1) return t('admin.quotes.updated.now')
  if (mins < 60) return t('admin.quotes.updated.minutes', { count: String(mins) })
  const hours = Math.round(mins / 60)
  if (hours < 24) return t('admin.quotes.updated.hours', { count: String(hours) })
  const days = Math.round(hours / 24)
  if (days === 1) return t('admin.quotes.updated.yesterday')
  return t('admin.quotes.updated.days', { count: String(days) })
}

/** "14 ימים" / "יום אחד" — the validity window as the admin reads it. */
export const validityLabel = (days: number): string => (days === 1 ? 'יום אחד' : `${days} ימים`)

/** `validityLabel` in the interface language (Hebrew: `validityLabel` itself). */
export const validityLabelIn = (days: number, locale: UiLocale = 'he'): string =>
  locale === 'he' ? validityLabel(days) : translatorFor(locale)('admin.quotes.days', { count: days })
