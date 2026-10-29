// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { NOW, TEAM_PROMO, dealsEnv, resetDealsEnv } from './dealsEnv'
import { dealsSpies, resetDealsSpies } from './dealsMocks'
import { dealsShell, perfLayout, perfPage, promotionListPage, promotionPage } from './dealsHarness'

/**
 * HEBREW BASELINE for /sum_sales (performance: overview, reps, months, teams,
 * companies, the shared sub-nav) and /promotion (list + campaign detail),
 * desktop. Recorded BEFORE Phase E2; every Hebrew render must still match
 * byte-for-byte afterwards. REAL pages; only I/O is mocked. No i18n provider.
 *
 * Normalized: React's `<!-- -->` separators and `useId` values only.
 */

vi.mock('next/navigation', async () => (await import('./dealsMocks')).navigationModule())
vi.mock('next/dynamic', async () => ({ default: (await import('./leadTabsHarness')).nextDynamicMock }))
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }))
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./dealsEnv')).dealsEnv.user }))
vi.mock('@/db/uiLocale', async () => ({
  getUiLocalePrefs: async () => ({ userLocale: (await import('./dealsMocks')).dealsSpies.prefs.userLocale, agencyLocale: null }),
}))
vi.mock('@/lib/device', () => ({ isMobileRequest: async () => false, isMobileWorkspaceRequest: async () => false, getInAppBrowser: async () => null }))
vi.mock('@/config/db', async () => (await import('./dealsMocks')).configDbModule())
vi.mock('@/db/filter', async () => (await import('./dealsMocks')).filterDbModule())
vi.mock('@/lib/filter/resolveActiveFilter', async () => (await import('./dealsMocks')).resolveActiveFilterModule())
vi.mock('@/db/salesTbl', async () => (await import('./dealsMocks')).salesTblDbModule())
vi.mock('@/db/usersNTeams', async () => (await import('./dealsMocks')).usersNTeamsModule())
vi.mock('@/db/sumSales', async () => (await import('./dealsMocks')).sumSalesDbModule())
vi.mock('@/db/sum_pie', async () => (await import('./dealsMocks')).sumPieModule())
vi.mock('@/db/promos', async () => (await import('./dealsMocks')).promosDbModule())
vi.mock('@/lib/facebook/permissions', async () => (await import('./dealsMocks')).permissionsModule())
vi.mock('@/actions/clients', async () => (await import('./dealsMocks')).clientsActionsModule())
vi.mock('@/actions/filter', async () => (await import('./dealsMocks')).filterActionsModule())
vi.mock('@/actions/global', async () => (await import('./dealsMocks')).globalActionsModule())
vi.mock('@/lib/toast', async () => (await import('./dealsMocks')).toastModule())

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const renderToString = (node: ReactNode) => normalizeIds(renderRaw(<>{node}</>).replaceAll('<!-- -->', ''))
const html = (el: Element | null) => {
  if (!el) throw new Error('element not found')
  return normalizeIds(el.outerHTML)
}

beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {} })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetDealsEnv()
  resetDealsSpies()
})

const perf = async (which: Parameters<typeof perfPage>[0]) => renderToString(await dealsShell(null, await perfLayout(await perfPage(which))))

describe('Hebrew baseline — /sum_sales (server HTML)', () => {
  test('overview (admin, ads tab on): sub-nav, pies, annual pace, goals table, stat boxes', async () => {
    dealsEnv.pathname = '/sum_sales'
    expect(await perf('overview')).toMatchSnapshot()
  })

  test('overview for a rep with goals (goals table), ads tab off, one user only (no reps tab)', async () => {
    dealsEnv.pathname = '/sum_sales'
    dealsEnv.adsEnabled = false
    dealsEnv.user = { ...dealsEnv.user, role: 'AGNT', id: 12, name: 'רון נציג' }
    expect(await perf('overview')).toMatchSnapshot()
  })

  test('reps, months, teams, companies tables; empty table; not allowed for a rep', async () => {
    const out: Record<string, string> = {}
    dealsEnv.pathname = '/sum_sales/agents'
    out.agents = await perf('agents')
    dealsEnv.pathname = '/sum_sales/months'
    out.months = await perf('months')
    dealsEnv.pathname = '/sum_sales/teams'
    out.teams = await perf('teams')
    dealsEnv.pathname = '/sum_sales/companies'
    out.companies = await perf('companies')
    dealsEnv.byMonth = []
    out.empty = await perf('months')
    dealsEnv.user = { ...dealsEnv.user, role: 'AGNT' }
    out.agentsDenied = await perf('agents')
    out.teamsDenied = await perf('teams')
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — /sum_sales interactions', () => {
  test('pie legend hover tooltip, legend click filter, table columns menu', async () => {
    dealsEnv.pathname = '/sum_sales'
    const { container } = render(await dealsShell(null, await perfPage('overview')))
    const out: Record<string, unknown> = {}
    const legendRow = Array.from(container.querySelectorAll('.cursor-pointer')).find((el) => el.textContent?.includes('שירותים'))!
    const valueCell = Array.from(container.querySelectorAll('.w-34')).find((el) => el.textContent?.includes('₪'))!
    fireEvent.mouseEnter(valueCell, { clientX: 300, clientY: 200 })
    out.tooltipValue = html(document.querySelector('.fixed.z-9999'))
    fireEvent.click(legendRow)
    out.redirects = dealsSpies.redirects
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — /promotion (server HTML)', () => {
  test('list: active + past campaigns; empty', async () => {
    const out: Record<string, string> = {}
    out.list = renderToString(await dealsShell(null, await promotionListPage()))
    dealsEnv.promos = []
    out.empty = renderToString(await dealsShell(null, await promotionListPage()))
    expect(out).toMatchSnapshot()
  })

  test('detail: rep campaign, team campaign, no data, not included, not found, broken goals', async () => {
    const out: Record<string, string> = {}
    out.rep = renderToString(await dealsShell(null, await promotionPage()))
    dealsEnv.promo = TEAM_PROMO
    out.team = renderToString(await dealsShell(null, await promotionPage('3')))
    dealsEnv.promo = { ...dealsEnv.promo, isPromoGrp: false }
    dealsEnv.promoTotals = []
    out.noData = renderToString(await dealsShell(null, await promotionPage()))
    dealsEnv.promoTotals = [{ נציג: 'רון נציג', משוקלל: 1 }]
    dealsEnv.user = { ...dealsEnv.user, role: 'AGNT' }
    dealsEnv.gotPermIds = [99]
    out.notIncluded = renderToString(await dealsShell(null, await promotionPage()))
    dealsEnv.promo = null
    out.notFound = renderToString(await dealsShell(null, await promotionPage()))
    dealsEnv.promo = { id: 9, goals: '{oops' }
    out.broken = renderToString(await dealsShell(null, await promotionPage()))
    expect(out).toMatchSnapshot()
  })

  test('detail interactions: rep filter of the totals table', async () => {
    const { container } = render(await dealsShell(null, await promotionPage()))
    const out: Record<string, unknown> = {}
    const filterInput = container.querySelector('form input[placeholder]') as HTMLInputElement
    fireEvent.focus(filterInput)
    out.options = html(filterInput.closest('.relative'))
    fireEvent.mouseDown(Array.from(filterInput.closest('.relative')!.querySelectorAll('button')).at(-1)!)
    fireEvent.submit(filterInput.closest('form')!)
    out.table = html(container.querySelector('table'))
    out.clearButton = html(container.querySelector('button[title="איפוס סינון"]'))
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — performance producers', () => {
  test('promo table rows, branch lists, product lists', async () => {
    const { formatNumAndPrecent } = await import('@/components/promo/funcs')
    const lists = await import('@/types/lists')
    const promo = { ...dealsEnv.promo, goals: JSON.parse(String((dealsEnv.promo as { goals: string }).goals)) }
    expect({
      promoRows: dealsEnv.promoTotals.map((u) => formatNumAndPrecent(u, promo as never)),
      branches: lists.BRANCHES,
      extended: lists.extendedBranchList,
      companies: lists.COMPANIES,
      productTypes: lists.PRDCT_TYPES,
      products: lists.prdctOptByBranch,
      leadSources: lists.leadSources,
    }).toMatchSnapshot()
  })
})
