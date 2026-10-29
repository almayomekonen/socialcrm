/**
 * Fixed data + mutable state behind the /deals, /sum_sales (performance) and
 * /promotion i18n tests (Phase E2): the Hebrew baseline, the leak gate, the
 * locale and behaviour tests.
 *
 * Customer data (lead names, rep / team / handler names, notes, free-text
 * sources, campaign titles, descriptions, prizes) is Hebrew on purpose — it must
 * reach the screen untouched by any localization. Deal statuses, branches,
 * companies, products, actions and date ranges are STORED Hebrew values
 * (`sales.*`, the filter JSON) and stay exactly as stored.
 */

/** 2026-10-15 10:00 Asia/Jerusalem. */
export const NOW = Date.parse('2026-10-15T07:00:00.000Z')
const DAY = 86_400_000
const at = (ms: number) => new Date(ms).toISOString()

export const DEALS_USER = { id: 7, name: 'דנה כהן', role: 'ADMIN', agencyId: 103, tblPref: null as unknown, savedFilters: [] as unknown[] }

export const PERM_USERS = [
  { id: 7, name: 'דנה כהן', role: 'ADMIN' },
  { id: 12, name: 'רון נציג', role: 'AGNT' },
  { id: 13, name: 'מיכל שותפה', role: 'EXT' },
]
export const PERM_TEAMS = [{ id: 3, name: 'צוות צפון' }]
export const ALL_USERS = [
  { id: 7, name: 'דנה כהן', role: 'ADMIN' },
  { id: 12, name: 'רון נציג', role: 'AGNT' },
  { id: 13, name: 'מיכל שותפה', role: 'EXT' },
  { id: 14, name: 'אבי משרד', role: 'OFFICE' },
]

const deal = (id: number, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  clientId: 40 + id,
  clientData: `${['יוסי לוי', 'מירב כהן', 'אבי ישראלי'][id % 3]} ${id}`,
  status,
  company: 'ללא ספק',
  branch: 'שירותים',
  prdct: 'בניית אתר',
  prdctType: 'תשלום חד פעמי',
  userName: 'רון נציג',
  userIds: [12],
  userPrcnts: [100],
  handlerId: 7,
  handlerName: 'דנה כהן',
  amount: 1000 * id,
  offrDt: at(NOW - (10 + id) * DAY),
  saleDt: at(NOW - id * DAY),
  action: 'מכירה',
  leadSource: 'Facebook',
  bizName: null,
  notes: null,
  bonus: false,
  ...extra,
})

/** One row per stored status, two legacy statuses, a note, a free-text source, a joining deal. */
export const DEALS = [
  deal(1, 'חדש', { notes: 'לחזור אחרי החגים' }),
  deal(2, 'בהצעה'),
  deal(3, 'במו"מ', { company: 'אחר', branch: 'קורסים', prdct: 'סדנה' }),
  deal(4, 'ממתין לתשלום', { leadSource: 'כנס מקצועי' }),
  deal(5, 'שולם', { action: 'הצטרפות' }),
  deal(6, 'בוטל'),
  deal(7, 'הצעה נשלחה'),
  deal(8, 'נגנז', { saleDt: null }),
]

export const DEAL_NOTES = ['לחזור אחרי החגים']
export const DEAL_FREE_SOURCES = ['כנס מקצועי']

/** A filter from the URL: custom date range, statuses, reps, teams, a lead, handlers, both checkboxes. */
export const RICH_FILTER = {
  dateRange: 'מותאם אישית',
  start: '2026-09-01',
  end: '2026-09-30',
  saleDtRange: 'השנה הנוכחית',
  action: 'הצטרפות',
  status: ['חדש', 'שולם', 'בהצעה', 'במו"מ', 'ממתין לתשלום', 'בוטל', 'חדש', 'שולם', 'בוטל'],
  userIds: [12],
  userNames: ['רון נציג'],
  teamIds: [3],
  teamNames: ['צוות צפון'],
  clientIds: [41],
  clientNames: ['מירב כהן 1'],
  handlerIds: [7],
  handlerNames: ['דנה כהן'],
  branch: 'קורסים',
  prdct: ['סדנה'],
  prdctType: ['תשלום חד פעמי'],
  company: ['אחר'],
  replace: true,
  isCollab: true,
}

/** Pie rows as `_flat_sales` groups them (the REAL `formatPieData` shapes them). */
export const PIE_ROWS = [
  { branch: 'שירותים', prdct: 'בניית אתר', prdctType: 'תשלום חד פעמי', annualValue: 12000, cmsn: 12000 },
  { branch: 'שירותים', prdct: 'SEO', prdctType: 'תשלום חודשי', annualValue: 4000, cmsn: 4000 },
  { branch: 'קורסים', prdct: 'סדנה', prdctType: 'תשלום חד פעמי', annualValue: 3000, cmsn: 3000 },
  { branch: 'ייעוץ', prdct: 'ייעוץ עסקי', prdctType: 'תשלום חד פעמי', annualValue: 2500, cmsn: 2500 },
]

export const SALE_STATS = { hofakCount: 4, inProcessCount: 6, totalRevenue: 18500, pipelineValue: 42000 }

export const GOALS_AND_TOTALS = {
  goals: { משוקלל: 240000, שירותים: 120000, קורסים: '0' },
  monthly_totals: { משוקלל: 21500, שירותים: 16000, מוצרים: 0, קורסים: 3000, מנויים: 0, חבילות: 0, ייעוץ: 2500, אחר: 0 },
  yearly_totals: { משוקלל: 180000, שירותים: 120000, מוצרים: 0, קורסים: 30000, מנויים: 0, חבילות: 0, ייעוץ: 30000, אחר: 0 },
}

const branchesRow = (head: Record<string, unknown>, base: number) => ({
  ...head,
  משוקלל: base * 7,
  שירותים: base * 3,
  מוצרים: base,
  קורסים: base,
  מנויים: 0,
  חבילות: base,
  ייעוץ: base,
  אחר: 0,
})

export const BY_USER = [branchesRow({ נציג: 'רון נציג' }, 1000), branchesRow({ נציג: 'מיכל שותפה' }, 500)]
export const BY_MONTH = [branchesRow({ חודש: 'ינואר' }, 800), branchesRow({ חודש: 'פברואר' }, 900), branchesRow({ חודש: 'אוקטובר' }, 1200)]
export const BY_TEAM = [branchesRow({ צוות: 'צוות צפון' }, 2000)]
export const BY_COMPANY = [branchesRow({ חברה: 'ללא ספק' }, 1500), branchesRow({ חברה: 'אחר' }, 300), branchesRow({ חברה: 'ספק פרטי' }, 100)]

const promo = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: `תחרות הסתיו ${id}`,
  desc: 'מי שסוגר הכי הרבה עסקאות זוכה בסופ"ש',
  start: new Date(NOW - 20 * DAY),
  end: new Date(NOW + 10 * DAY),
  img: null,
  files: [],
  grpIds: [],
  userIds: [12, 13],
  combined_ids: [12, 13],
  isPromoGrp: false,
  goals: JSON.stringify({
    target: { משוקלל: [5000, 10000], שירותים: [2000, 4000] },
    prize: ['ארוחה זוגית', 'סופ"ש בצימר'],
    conditions: [{ branch: 'משוקלל' }, { branch: 'שירותים', prdcts: ['בניית אתר'] }],
  }),
  ...extra,
})

export const PROMOS = [promo(1), promo(2, { end: new Date(NOW - 2 * DAY), title: 'תחרות הקיץ' })]
export const PROMO = promo(1)
export const TEAM_PROMO = promo(3, { isPromoGrp: true, grpIds: [3], userIds: [], combined_ids: [12] })
export const PROMO_TOTALS = [
  { נציג: 'רון נציג', משוקלל: 7000, שירותים: 2500 },
  { נציג: 'מיכל שותפה', משוקלל: 3000, שירותים: 500 },
]
export const TEAM_PROMO_TOTALS = [{ צוות: 'צוות צפון', משוקלל: 12000, שירותים: 4500 }]

export const DEALS_DEFAULTS = {
  user: DEALS_USER as Record<string, unknown>,
  deals: DEALS as Record<string, unknown>[],
  count: DEALS.length as number | string,
  revenue: 36000,
  systemEmpty: false,
  hasLeads: true,
  /** The page's own reads (`?filter=` wins; else the remembered cookie value). */
  storedFilter: undefined as string | undefined,
  search: '',
  pathname: '/deals',
  adsEnabled: true,
  pieRows: PIE_ROWS as Record<string, unknown>[],
  saleStats: SALE_STATS as Record<string, unknown>,
  goals: GOALS_AND_TOTALS as Record<string, unknown> | null,
  byUser: BY_USER as Record<string, unknown>[],
  byMonth: BY_MONTH as Record<string, unknown>[],
  byTeam: BY_TEAM as Record<string, unknown>[],
  byCompany: BY_COMPANY as Record<string, unknown>[],
  promos: PROMOS as Record<string, unknown>[],
  promo: PROMO as Record<string, unknown> | null,
  promoTotals: PROMO_TOTALS as Record<string, unknown>[],
  teamPromoTotals: TEAM_PROMO_TOTALS as Record<string, unknown>[],
  gotPermIds: [7, 12, 13] as number[],
  /** The last `getPermsAndFilter` raw filter (the page passes the URL filter through). */
  lastFilter: null as unknown,
}

export const dealsEnv = { ...DEALS_DEFAULTS }

export function resetDealsEnv() {
  Object.assign(dealsEnv, DEALS_DEFAULTS, { lastFilter: null })
}

/** Hebrew customer data these pages render verbatim. */
export const DEALS_CUSTOMER_DATA = [
  ...DEALS.map((d) => d.clientData),
  ...ALL_USERS.map((u) => u.name),
  ...PERM_TEAMS.map((t) => t.name),
  ...DEAL_NOTES,
  ...DEAL_FREE_SOURCES,
  ...PROMOS.map((p) => p.title),
  PROMO.desc,
  TEAM_PROMO.title,
  'ארוחה זוגית',
  'סופ"ש בצימר',
  'ספק פרטי',
] as string[]
