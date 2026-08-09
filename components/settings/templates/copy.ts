import type { TemplateCategory } from '@/lib/automations/templates/types'
import { TEMPLATE_CATEGORIES } from '@/lib/automations/templates/types'

/**
 * Marketplace copy, keyed by the closed category vocabulary. `Record<K, …>`
 * means adding a category without deciding its Hebrew is a compile error.
 */
export const CATEGORY: Record<TemplateCategory, string> = {
  lead: 'לידים',
  form: 'טפסים באתר',
  appointment: 'פגישות',
  internal: 'עבודה פנימית',
}

export const CATEGORY_ORDER: readonly TemplateCategory[] = TEMPLATE_CATEGORIES

export const ERRORS: Record<string, string> = {
  forbidden: 'אין לך הרשאה לבצע פעולה זו',
  template_unknown: 'התבנית לא נמצאה',
  template_invalid: 'התבנית אינה זמינה כרגע',
  variable_required: 'יש להשלים את כל השדות',
  /**
   * Reasons an inline creator can return. They travel through the same error
   * line as an install failure, so the dialog owns their Hebrew — a raw machine
   * code must never reach a customer, whichever step produced it.
   */
  template_required: 'יש לבחור הצעת מחיר או לבנות חדשה',
  name_required: 'יש להזין שם להצעה',
  name_too_long: 'שם ההצעה ארוך מדי',
  name_taken: 'כבר קיימת הצעה פעילה בשם הזה',
  title_too_long: 'כותרת ההצעה ארוכה מדי',
  validity_invalid: 'תוקף ההצעה חייב להיות בין 1 ל-90 ימים',
  items_required: 'יש להוסיף לפחות שורה אחת להצעה',
  too_many_items: 'יותר מדי שורות בהצעה',
  item_title_required: 'לכל שורה בהצעה צריך תיאור',
  item_title_too_long: 'תיאור השורה ארוך מדי',
  item_quantity_invalid: 'הכמות חייבת להיות גדולה מאפס',
  item_price_invalid: 'המחיר אינו תקין',
  item_discount_invalid: 'ההנחה אינה תקינה',
  invalid_input: 'לא ניתן לשמור את ההצעה',
}

export const errorMessage = (reason: string) => ERRORS[reason] ?? 'הפעולה נכשלה. נסו שוב.'
