/**
 * Display labels for STORED deal values — `sales.status` / `branch` / `company`
 * / `prdct` / `prdctType` / `action` / `leadSource`, the filter's stored date
 * ranges, and the performance report's branch keys. PURE; display only.
 *
 * The stored value is Hebrew text that filters, imports, the performance SQL
 * and saved filters depend on (plan §3 C1/C2), so it never changes: pickers keep
 * it as the option VALUE, logic compares it, and only the visible text comes
 * from here. Hebrew returns the stored value itself (byte-identical to before);
 * a value with no label (a legacy or free-text one) is shown as stored.
 */
import type { UiLocale } from '@/lib/i18n/config'
import { intlLocale, type MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'
import { DEAL_STATUS_DISPLAY_MAP, STATUS_LIST } from '@/types/lists'

const STATUS: Record<string, MessageKey> = {
  חדש: 'deals.status.new',
  בהצעה: 'deals.status.proposal',
  'במו"מ': 'deals.status.negotiating',
  'ממתין לתשלום': 'deals.status.awaitingPayment',
  שולם: 'deals.status.paid',
  בוטל: 'deals.status.cancelled',
  הכל: 'deals.status.all',
}

/** The table's pill words (DEAL_STATUS_DISPLAY_MAP) are the lead statuses' words: same keys. */
const DISPLAY_STATUS: Record<string, MessageKey> = {
  חדש: 'leads.status.new',
  בטיפול: 'leads.status.contacted',
  סגור: 'leads.status.closed',
  אבוד: 'leads.status.lost',
}

const BRANCH: Record<string, MessageKey> = {
  משוקלל: 'deals.branch.total',
  שירותים: 'deals.branch.services',
  מוצרים: 'deals.branch.products',
  קורסים: 'deals.branch.courses',
  מנויים: 'deals.branch.subscriptions',
  חבילות: 'deals.branch.packages',
  ייעוץ: 'deals.branch.consulting',
  אחר: 'deals.branch.others',
}

const COMPANY: Record<string, MessageKey> = { 'ללא ספק': 'deals.company.none', אחר: 'deals.company.others' }

const PRODUCT_TYPE: Record<string, MessageKey> = {
  העברה: 'deals.productType.transfer',
  'תשלום חודשי': 'deals.productType.monthly',
  'תשלום חד פעמי': 'deals.productType.oneTime',
}

const PRODUCT: Record<string, MessageKey> = {
  'ניהול סושיאל מדיה': 'deals.product.socialMedia',
  'בניית אתר': 'deals.product.website',
  SEO: 'deals.product.seo',
  PPC: 'deals.product.ppc',
  'תוכן שיווקי': 'deals.product.content',
  'מוצר פיזי': 'deals.product.physical',
  'מוצר דיגיטלי': 'deals.product.digital',
  תוכנה: 'deals.product.software',
  'קורס אונליין': 'deals.product.onlineCourse',
  סדנה: 'deals.product.workshop',
  'ליווי אישי': 'deals.product.coaching',
  'מנוי חודשי': 'deals.product.monthlySub',
  'מנוי שנתי': 'deals.product.yearlySub',
  'חבילה בסיסית': 'deals.product.basicPackage',
  'חבילה מתקדמת': 'deals.product.advancedPackage',
  'חבילה פרמיום': 'deals.product.premiumPackage',
  'ייעוץ עסקי': 'deals.product.businessConsulting',
  'ייעוץ שיווקי': 'deals.product.marketingConsulting',
  'ייעוץ אסטרטגי': 'deals.product.strategyConsulting',
  אחר: 'deals.product.others',
}

const ACTION: Record<string, MessageKey> = { מכירה: 'deals.action.sale', הצטרפות: 'deals.action.join', הכל: 'deals.action.all' }

const DATE_RANGE: Record<string, MessageKey> = {
  'כל התאריכים': 'deals.dateRange.all',
  'החודש הנוכחי': 'deals.dateRange.thisMonth',
  'החודש הקודם': 'deals.dateRange.lastMonth',
  'השבוע הנוכחי': 'deals.dateRange.thisWeek',
  'השבוע הקודם': 'deals.dateRange.lastWeek',
  'השנה הנוכחית': 'deals.dateRange.thisYear',
  'השנה הקודמת': 'deals.dateRange.lastYear',
  'מותאם אישית': 'deals.dateRange.custom',
}

/** Brand sources (Instagram, Facebook, WhatsApp) are shown as stored. */
const LEAD_SOURCE: Record<string, MessageKey> = {
  אתר: 'deals.leadSource.website',
  המלצה: 'deals.leadSource.referral',
  'פרסום ממומן': 'deals.leadSource.paid',
  אורגני: 'deals.leadSource.organic',
}

function labeler(map: Record<string, MessageKey>) {
  return (stored: unknown, locale: UiLocale = 'he'): string => {
    const value = stored == null ? '' : String(stored)
    if (locale === 'he') return value
    const key = map[value]
    return key ? translatorFor(locale)(key) : value
  }
}

export const dealStatusLabel = labeler(STATUS)
export const dealDisplayStatusLabel = labeler(DISPLAY_STATUS)
export const dealBranchLabel = labeler(BRANCH)
export const dealCompanyLabel = labeler(COMPANY)
export const dealProductTypeLabel = labeler(PRODUCT_TYPE)
export const dealProductLabel = labeler(PRODUCT)
export const dealActionLabel = labeler(ACTION)
export const dateRangeLabel = labeler(DATE_RANGE)
export const dealLeadSourceLabel = labeler(LEAD_SOURCE)

/** `{ id: stored, name: label }` picker options (Select / MultiSelectSearch); Hebrew options read exactly as before. */
export function labelledOptions(values: readonly string[], label: (v: unknown, l?: UiLocale) => string, locale: UiLocale = 'he') {
  return values.map((value) => ({ id: value, name: label(value, locale) }))
}

/** The table's status picker: stored value → pill word (`DEAL_STATUS_OPTIONS`, labelled). */
export function dealStatusOptions(locale: UiLocale = 'he') {
  return STATUS_LIST.map((value) => ({ value, label: dealDisplayStatusLabel(DEAL_STATUS_DISPLAY_MAP[value] ?? value, locale) }))
}

const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']

/**
 * The months report names each row by a Hebrew month name (`db/sumSales`
 * `hebrewMonths`, a response VALUE). Display only: another language words the
 * same month with `Intl` (Arabic with Latin-digit locale, like every formatter).
 */
export function reportMonthLabel(stored: unknown, locale: UiLocale = 'he'): string {
  const value = stored == null ? '' : String(stored)
  if (locale === 'he') return value
  const index = HE_MONTHS.indexOf(value)
  if (index < 0) return value
  return new Intl.DateTimeFormat(intlLocale(locale), { month: 'long', timeZone: 'UTC' }).format(Date.UTC(2026, index, 15))
}
