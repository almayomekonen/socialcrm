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
}

export const errorMessage = (reason: string) => ERRORS[reason] ?? 'הפעולה נכשלה. נסו שוב.'
