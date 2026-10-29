// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { DEALS, NOW, RICH_FILTER, dealsEnv, resetDealsEnv } from './dealsEnv'
import { dealsSpies, resetDealsSpies } from './dealsMocks'
import { dealsPage, dealsShell } from './dealsHarness'
import { EXPIRED } from './leadTabsEnv'

/**
 * HEBREW BASELINE for /deals (desktop). Recorded against the code BEFORE
 * Phase E2; every Hebrew render must still match byte-for-byte afterwards.
 *
 * The REAL server page runs here (async server components resolved in place,
 * `next/dynamic` awaited); only I/O (db, actions, toasts, navigation) is
 * mocked. Rendered with NO i18n provider, i.e. exactly what a Hebrew user
 * receives today.
 *
 * Normalized before comparing, and only these:
 *  · React's invisible `<!-- -->` text separators.
 *  · React `useId` values (tree shape, not text).
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
vi.mock('@/db/clients', async () => ({ hasAnyLeads: async () => (await import('./dealsEnv')).dealsEnv.hasLeads }))
vi.mock('@/db/usersNTeams', async () => (await import('./dealsMocks')).usersNTeamsModule())
vi.mock('@/actions/salesTbl', async () => (await import('./dealsMocks')).salesTblActionsModule())
vi.mock('@/actions/dealImport', async () => (await import('./dealsMocks')).dealImportModule())
vi.mock('@/actions/saleForm', async () => (await import('./dealsMocks')).saleFormActionsModule())
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
  document.cookie.split('; ').filter(Boolean).forEach((c) => (document.cookie = `${c.split('=')[0]}=; Path=/; Max-Age=0`))
})

describe('Hebrew baseline — /deals (server HTML)', () => {
  test('populated (admin, this month by default): summary, nav, filter panel, table with every stored + legacy status, footer', async () => {
    const out: Record<string, unknown> = {}
    out.html = renderToString(await dealsShell(null, await dealsPage()))
    out.filter = dealsEnv.lastFilter
    expect(out).toMatchSnapshot()
  })

  test('a URL filter with every chip kind (custom dates, statuses, names, branch, checkboxes)', async () => {
    dealsEnv.search = `filter=${JSON.stringify(RICH_FILTER)}`
    expect(renderToString(await dealsShell(null, await dealsPage(RICH_FILTER)))).toMatchSnapshot()
  })

  test('filtered empty: deals exist, the filter matches none', async () => {
    dealsEnv.deals = []
    dealsEnv.count = 0
    dealsEnv.revenue = 0
    expect(renderToString(await dealsShell(null, await dealsPage({ dateRange: 'החודש הקודם' })))).toMatchSnapshot()
  })

  test('system empty, with leads (add-deal offered) and without leads', async () => {
    const out: Record<string, string> = {}
    Object.assign(dealsEnv, { deals: [], count: 0, revenue: 0, systemEmpty: true })
    out.withLeads = renderToString(await dealsShell(null, await dealsPage()))
    dealsEnv.hasLeads = false
    out.withoutLeads = renderToString(await dealsShell(null, await dealsPage()))
    expect(out).toMatchSnapshot()
  })

  test('a rep (not admin): no default date range, the summary card says total revenue', async () => {
    dealsEnv.user = { ...dealsEnv.user, role: 'AGNT', id: 12, name: 'רון נציג' }
    expect(renderToString(await dealsShell(null, await dealsPage()))).toMatchSnapshot()
  })
})

describe('Hebrew baseline — /deals interactions', () => {
  test('row menu, delete confirmation, favourites, edit; the status picker sends the stored value', async () => {
    const { container } = render(await dealsShell(null, await dealsPage()))
    const out: Record<string, unknown> = {}
    const dots = container.querySelectorAll('button[aria-haspopup="menu"]')
    fireEvent.click(dots[2])
    out.menu = html(document.getElementById('saleActions'))
    const items = Array.from(document.querySelectorAll('#saleActions button'))
    fireEvent.click(items.find((b) => b.textContent === 'הוספה למועדפים')!)
    fireEvent.click(items.find((b) => b.textContent === 'מחיקה')!)
    out.deleteConfirm = html(document.querySelector('[role="dialog"]'))
    await act(async () => {
      fireEvent.click(Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent === 'מחיקה')!)
    })
    const selects = container.querySelectorAll('tbody select')
    await act(async () => {
      fireEvent.change(selects[0], { target: { value: 'שולם' } })
    })
    out.statusSelect = html(selects[1])
    fireEvent.click(container.querySelectorAll('button[aria-haspopup="menu"]')[0])
    fireEvent.click(Array.from(document.querySelectorAll('#saleActions button')).find((b) => b.textContent === 'עריכה')!)
    out.editDialogLabel = document.querySelector('[role="dialog"]')?.getAttribute('aria-label') ?? null
    out.toasts = dealsSpies.toasts
    out.calls = dealsSpies.calls
    expect(out).toMatchSnapshot()
  })

  test('group actions: options, each confirmation, toasts, arguments; bulk delete label and skipped message', async () => {
    const { container } = render(await dealsShell(null, await dealsPage()))
    const out: Record<string, unknown> = {}
    const group = Array.from(container.querySelectorAll('select')).find((s) => s.querySelector('optgroup'))!
    out.groupSelect = html(group)
    const rows = Array.from(container.querySelectorAll('input[name="checkRow"]')) as HTMLInputElement[]
    rows.slice(0, 2).forEach((r) => (r.checked = true))
    const confirms: string[] = []
    for (const val of ['מחיקת העסקאות', 'הוספה למועדפים', 'במו"מ']) {
      fireEvent.change(group, { target: { value: val } })
      confirms.push(html(document.querySelector('[role="dialog"]')))
      await act(async () => {
        fireEvent.click(Array.from(document.querySelectorAll('[role="dialog"] button')).at(-1)!)
      })
    }
    dealsSpies.deleteDeals.mockImplementation(async () => 0)
    fireEvent.change(group, { target: { value: 'מחיקת העסקאות' } })
    await act(async () => {
      fireEvent.click(Array.from(document.querySelectorAll('[role="dialog"] button')).at(-1)!)
    })
    out.confirms = confirms
    rows.slice(0, 2).forEach((r) => fireEvent.change(r, { target: { checked: true } }))
    await act(async () => {})
    out.bulkButton = html(Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.startsWith('מחק'))!)
    rows.forEach((r) => (r.checked = true))
    fireEvent.change(rows[0])
    out.bulkAllButton = html(Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.startsWith('מחק'))!)
    fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.startsWith('מחק'))!)
    out.bulkConfirm = html(document.querySelector('[role="dialog"]'))
    dealsSpies.deleteManyDeals.mockImplementation(async () => ({ deleted: 5, skipped: 3 }))
    await act(async () => {
      fireEvent.click(Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent === 'מחיקה')!)
    })
    out.skipped = html(document.querySelector('[role="dialog"]'))
    out.toasts = dealsSpies.toasts
    out.calls = dealsSpies.calls.filter((c) => c[0] !== 'saveTblPref')
    expect(out).toMatchSnapshot()
  })

  test('search a deal by lead (redirect filter), add-deal dialog opens, import dialog opens', async () => {
    const { container } = render(await dealsShell(null, await dealsPage()))
    const out: Record<string, unknown> = {}
    fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'ייבוא עסקאות')!)
    out.importDialog = html(document.querySelector('[role="dialog"]'))
    fireEvent.keyDown(document.querySelector('[role="dialog"]')!, { key: 'Escape' })
    fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'הוסף עסקה')!)
    out.formDialogLabel = document.querySelector('[role="dialog"]')?.getAttribute('aria-label') ?? null
    expect(out).toMatchSnapshot()
  })

  test('expired subscription: the deal form shows the lock panel', async () => {
    const { container } = render(await dealsShell(null, await dealsPage(), EXPIRED))
    fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'הוסף עסקה')!)
    expect(html(document.querySelector('[role="dialog"]'))).toMatchSnapshot()
  })
})

describe('Hebrew baseline — /deals producers', () => {
  test('revenue label by filter, the export / table headers, statuses and options', async () => {
    const { revenueLabel } = await import('@/components/dashboard/DashboardSummary')
    const { saleTableHeaders } = await import('@/components/sales/salesTable/saleHeaders')
    const lists = await import('@/types/lists')
    const { getActions } = await import('@/components/sales/salesTable/funcs')
    expect({
      revenue: [
        revenueLabel({ dateRange: 'החודש הנוכחי' }),
        revenueLabel({ dateRange: 'החודש הנוכחי', saleDtRange: 'כל התאריכים' }),
        revenueLabel({ dateRange: 'החודש הנוכחי', saleDtRange: 'השנה הנוכחית' }),
        revenueLabel({ dateRange: 'כל התאריכים' }),
        revenueLabel(null),
      ],
      headers: saleTableHeaders(null),
      statusOptions: lists.DEAL_STATUS_OPTIONS,
      normalized: DEALS.map((d) => [d.status, lists.normalizeStatus(d.status), lists.displayStatus(d.status)]),
      actions: Object.keys(getActions()),
    }).toMatchSnapshot()
  })
})
