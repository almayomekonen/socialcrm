import type { Surface } from './surfaces'
import type { Allowance } from './leakScan'
import { DEALS_CUSTOMER_DATA, PROMOS, TEAM_PROMO } from './dealsEnv'
import { dealsPage, dealsShell, perfLayout, perfPage, promotionListPage, promotionPage, withDealsEnv } from './dealsHarness'
import { ADS_EXTERNAL, AD_BREAKDOWN, adsEnv, resetAdsEnv } from './adsEnv'

/**
 * Leak-gate registrations for /deals, /sum_sales (incl. ads) and /promotion
 * (Phase E2, desktop). Spread into SURFACES (surfaces.tsx); rendering relies on
 * the mocks in leakGate.test.tsx. Dialogs (deal form, import, confirmations,
 * filter panel) are scanned in dealsLocales.test.tsx, where they are opened.
 *
 * Data shown verbatim: lead / rep / team names, campaign titles, descriptions
 * and prizes (customer data); Meta campaign, ad set, ad and account names
 * (external). Nothing else may stay Hebrew.
 */

function data(...texts: string[]): Allowance[] {
  return texts.map((text) => {
    if (!DEALS_CUSTOMER_DATA.includes(text)) throw new Error(`not declared as deals customer data: ${text}`)
    return { text, reason: 'customer-data' as const }
  })
}
function external(...texts: string[]): Allowance[] {
  return texts.map((text) => {
    if (!ADS_EXTERNAL.includes(text)) throw new Error(`not declared as external ads data: ${text}`)
    return { text, reason: 'external' as const }
  })
}

const LEAD_NAMES = ['מירב כהן', 'אבי ישראלי', 'יוסי לוי']
const leadNames = (): Allowance[] => LEAD_NAMES.map((text) => ({ text, reason: 'customer-data' as const }))

async function ads(query: Record<string, string>, over: Partial<typeof adsEnv> = {}) {
  resetAdsEnv()
  Object.assign(adsEnv, over)
  const { default: Page } = await import('@/app/(app)/sum_sales/ads/page')
  try {
    return await perfLayout(await Page({ searchParams: Promise.resolve(query) }))
  } finally {
    resetAdsEnv()
  }
}

export const DEALS_SURFACES: Surface[] = [
  {
    name: 'deals — populated: summary, nav, filter panel, table (every status), row menu, footer',
    route: '/deals',
    render: async (locale) => dealsShell(locale, await withDealsEnv({}, () => dealsPage())),
    allowed: [...leadNames(), ...data('דנה כהן')],
  },
  {
    name: 'deals — filtered empty',
    route: '/deals',
    render: async (locale) => dealsShell(locale, await withDealsEnv({ deals: [], count: 0, revenue: 0 }, () => dealsPage({ dateRange: 'החודש הקודם' }))),
    allowed: [],
  },
  {
    name: 'deals — system empty (with leads)',
    route: '/deals',
    render: async (locale) => dealsShell(locale, await withDealsEnv({ deals: [], count: 0, revenue: 0, systemEmpty: true }, () => dealsPage())),
    allowed: [],
  },
  {
    name: 'performance — overview (sub-nav, pies, annual pace, stat boxes)',
    route: '/sum_sales',
    render: async (locale) => dealsShell(locale, await withDealsEnv({ pathname: '/sum_sales' }, async () => perfLayout(await perfPage('overview')))),
    allowed: [],
  },
  {
    name: 'performance — reps table',
    route: '/sum_sales/agents',
    render: async (locale) => dealsShell(locale, await withDealsEnv({ pathname: '/sum_sales/agents' }, async () => perfLayout(await perfPage('agents')))),
    allowed: data('רון נציג', 'מיכל שותפה'),
  },
  {
    name: 'performance — months table',
    route: '/sum_sales/months',
    render: async (locale) => dealsShell(locale, await withDealsEnv({ pathname: '/sum_sales/months' }, async () => perfLayout(await perfPage('months')))),
    allowed: [],
  },
  {
    name: 'performance — teams table',
    route: '/sum_sales/teams',
    render: async (locale) => dealsShell(locale, await withDealsEnv({ pathname: '/sum_sales/teams' }, async () => perfLayout(await perfPage('teams')))),
    allowed: data('צוות צפון'),
  },
  {
    name: 'performance — companies table (stored suppliers labelled, a free-text one as data)',
    route: '/sum_sales/companies',
    render: async (locale) =>
      dealsShell(locale, await withDealsEnv({ pathname: '/sum_sales/companies' }, async () => perfLayout(await perfPage('companies')))),
    allowed: data('ספק פרטי'),
  },
  {
    name: 'performance — empty report table',
    route: '/sum_sales/months',
    render: async (locale) => dealsShell(locale, await withDealsEnv({ pathname: '/sum_sales/months', byMonth: [] }, async () => perfLayout(await perfPage('months')))),
    allowed: [],
  },
  {
    name: 'ad performance — full report (summary, intelligence, trend, campaign table)',
    route: '/sum_sales/ads',
    render: async (locale) => dealsShell(locale, await withDealsEnv({ pathname: '/sum_sales/ads' }, () => ads({ account: 'act_1' }))),
    allowed: external('קמפיין לידים ספטמבר', 'קמפיין מיתוג', 'קמפיין מכירות', 'קמפיין תנועה', 'קמפיין מעורבות', 'קמפיין הודעות', 'קמפיין לידים ריק', 'מודעת תמונה', 'מודעת וידאו', 'חשבון ראשי'),
  },
  {
    name: 'ad performance — drill-down: ad sets, then ads (no names, statuses not loaded)',
    route: '/sum_sales/ads',
    render: async (locale) =>
      dealsShell(
        locale,
        await withDealsEnv({ pathname: '/sum_sales/ads' }, async () => (
          <>
            {await ads({ campaign: '111' })}
            {await ads({ campaign: '111', adset: '811' }, { breakdown: { ok: true, value: AD_BREAKDOWN } })}
          </>
        )),
      ),
    allowed: external('קמפיין לידים ספטמבר', 'קמפיין לידים ריק', 'קהל חם', 'מודעת תמונה', 'חשבון ראשי'),
  },
  {
    name: 'ad performance — not connected: the connect notice + the SocialCRM-only section',
    route: '/sum_sales/ads',
    render: async (locale) => dealsShell(locale, await withDealsEnv({ pathname: '/sum_sales/ads' }, () => ads({}, { connection: null }))),
    allowed: external('קמפיין לידים ספטמבר'),
  },
  {
    name: 'ad performance — Meta failure + no activity + invalid range',
    route: '/sum_sales/ads',
    render: async (locale) =>
      dealsShell(
        locale,
        await withDealsEnv({ pathname: '/sum_sales/ads' }, async () => (
          <>
            {await ads({}, { accounts: { ok: false, reason: 'permission_missing' } })}
            {await ads({ range: 'nope' }, { report: { ok: false, reason: 'meta_error' } })}
          </>
        )),
      ),
    allowed: external('חשבון ראשי'),
  },
  {
    name: 'campaigns — active + past',
    route: '/promotion',
    // The gate's clock (dashboard fixtures) is later than the deals one: keep the first campaign running.
    render: async (locale) =>
      dealsShell(locale, await withDealsEnv({ promos: [{ ...PROMOS[0], end: new Date('2027-01-01') }, PROMOS[1]] }, () => promotionListPage())),
    allowed: data('תחרות הסתיו 1', 'תחרות הקיץ', 'מי שסוגר הכי הרבה עסקאות זוכה בסופ"ש'),
  },
  {
    name: 'campaigns — empty',
    route: '/promotion',
    render: async (locale) => dealsShell(locale, await withDealsEnv({ promos: [] }, () => promotionListPage())),
    allowed: [],
  },
  {
    name: 'campaign detail — reps: card, progress, totals table, rep filter',
    route: '/promotion/[id]',
    render: async (locale) => dealsShell(locale, await withDealsEnv({}, () => promotionPage())),
    allowed: data('תחרות הסתיו 1', 'מי שסוגר הכי הרבה עסקאות זוכה בסופ"ש', 'רון נציג', 'מיכל שותפה', 'ארוחה זוגית', 'סופ"ש בצימר'),
  },
  {
    name: 'campaign detail — teams, and the not-found / no-data lines',
    route: '/promotion/[id]',
    render: async (locale) =>
      dealsShell(
        locale,
        <>
          {await withDealsEnv({ promo: TEAM_PROMO }, () => promotionPage('3'))}
          {await withDealsEnv({ promo: null }, () => promotionPage())}
          {await withDealsEnv({ promoTotals: [] }, () => promotionPage())}
        </>,
      ),
    allowed: data('תחרות הסתיו 1', 'תחרות הסתיו 3', 'מי שסוגר הכי הרבה עסקאות זוכה בסופ"ש', 'צוות צפון', 'ארוחה זוגית', 'סופ"ש בצימר'),
  },
]
