/**
 * Display labels for STORED deal values (`sales.*`, the filter JSON, the
 * performance report keys). The stored Hebrew value never changes; these are
 * looked up by it in `lib/deals/labels.ts` (Hebrew returns the stored value
 * itself). Keys are slugs of the stored value.
 */

/** `sales.status` (types/lists STATUS_LIST). */
export const status = {
  new: 'חדש',
  proposal: 'בהצעה',
  negotiating: 'במו"מ',
  awaitingPayment: 'ממתין לתשלום',
  paid: 'שולם',
  cancelled: 'בוטל',
  /** The filter's "every status" choice (`status: ['הכל']`). */
  all: 'הכל',
} as const

/** `sales.branch` and the performance report's branch keys (`משוקלל` is the total). */
export const branch = {
  total: 'משוקלל',
  services: 'שירותים',
  products: 'מוצרים',
  courses: 'קורסים',
  subscriptions: 'מנויים',
  packages: 'חבילות',
  consulting: 'ייעוץ',
  others: 'אחר',
} as const

/** `sales.company` (COMPANIES). */
export const company = { none: 'ללא ספק', others: 'אחר' } as const

/** `sales.prdctType` (PRDCT_TYPES). */
export const productType = { transfer: 'העברה', monthly: 'תשלום חודשי', oneTime: 'תשלום חד פעמי' } as const

/** `sales.prdct` — the predefined product list of each branch (prdctOptByBranch). */
export const product = {
  socialMedia: 'ניהול סושיאל מדיה',
  website: 'בניית אתר',
  seo: 'SEO',
  ppc: 'PPC',
  content: 'תוכן שיווקי',
  physical: 'מוצר פיזי',
  digital: 'מוצר דיגיטלי',
  software: 'תוכנה',
  onlineCourse: 'קורס אונליין',
  workshop: 'סדנה',
  coaching: 'ליווי אישי',
  monthlySub: 'מנוי חודשי',
  yearlySub: 'מנוי שנתי',
  basicPackage: 'חבילה בסיסית',
  advancedPackage: 'חבילה מתקדמת',
  premiumPackage: 'חבילה פרמיום',
  businessConsulting: 'ייעוץ עסקי',
  marketingConsulting: 'ייעוץ שיווקי',
  strategyConsulting: 'ייעוץ אסטרטגי',
  others: 'אחר',
} as const

/** `sales.action` and the filter's "every action" choice. */
export const action = { sale: 'מכירה', join: 'הצטרפות', all: 'הכל' } as const

/** The filter's stored date-range presets (lib/dates getDateRange reads these values). */
export const dateRange = {
  all: 'כל התאריכים',
  thisMonth: 'החודש הנוכחי',
  lastMonth: 'החודש הקודם',
  thisWeek: 'השבוע הנוכחי',
  lastWeek: 'השבוע הקודם',
  thisYear: 'השנה הנוכחית',
  lastYear: 'השנה הקודמת',
  custom: 'מותאם אישית',
} as const

/** The deal form's fixed lead sources (types/lists leadSources; brands stay Latin). */
export const leadSource = {
  website: 'אתר',
  referral: 'המלצה',
  paid: 'פרסום ממומן',
  organic: 'אורגני',
} as const
