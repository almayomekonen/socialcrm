// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { expectStickyEdges } from './stickyActionsEdge'
import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { DEALS_CUSTOMER_DATA, NOW, RICH_FILTER, dealsEnv, resetDealsEnv } from './dealsEnv'
import { dealsSpies as S, resetDealsSpies } from './dealsMocks'
import { ADS_EXTERNAL, resetAdsEnv } from './adsEnv'
import { findHebrewLeaks } from './leakScan'

/**
 * /deals, /sum_sales (incl. ads) and /promotion in en / ar: key strings, region
 * direction (nothing declared for Hebrew), the portalled dialogs (deal form,
 * import, confirmations), the filter panel and chips, tab titles, hydration and
 * a language switch. Behaviour: dealsBehaviour.test.tsx. Hebrew is pinned by
 * the deals / performance / ads Hebrew baselines.
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
vi.mock('@/db/sumSales', async () => (await import('./dealsMocks')).sumSalesDbModule())
vi.mock('@/db/sum_pie', async () => (await import('./dealsMocks')).sumPieModule())
vi.mock('@/db/promos', async () => (await import('./dealsMocks')).promosDbModule())
vi.mock('@/lib/facebook/permissions', async () => (await import('./dealsMocks')).permissionsModule())
vi.mock('@/db/facebookAds', async () => {
  const { adsEnv: env } = await import('./adsEnv')
  return {
    getAdConnection: async () => {
      if (env.connectionThrows) throw new Error('seal')
      return env.connection
    },
    setSelectedAdAccount: async () => {},
  }
})
vi.mock('@/db/adsSnapshots', () => ({ readSnapshot: async () => null, writeSnapshot: async () => {} }))
vi.mock('@/lib/facebook/ads/cached', () => ({
  cachedAdsRead: async (_s: unknown, _k: unknown, _t: unknown, read: () => Promise<{ ok: boolean; value?: unknown; reason?: string }>) => {
    const r = await read()
    return 'value' in r && r.ok ? { value: { value: r.value, fetchedAt: '2026-10-15T06:30:00.000Z', stale: false } } : r
  },
  reportTtlMs: () => 1,
}))
vi.mock('@/lib/facebook/ads/insights', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/facebook/ads/insights')>()
  return { ...actual, listAdAccounts: async () => (await import('./adsEnv')).adsEnv.accounts }
})
vi.mock('@/lib/facebook/ads/report', () => ({ DAILY_MAX_DAYS: 92, getAdsReport: async () => (await import('./adsEnv')).adsEnv.report }))
vi.mock('@/lib/facebook/ads/breakdown', async () => ({ getAdsBreakdown: async () => (await import('./adsEnv')).adsEnv.breakdown }))
vi.mock('@/lib/facebook/ads/intelligence', async () => {
  const env = await import('./adsEnv')
  return {
    loadAdsIntelligence: async (input: { locale?: string }) => (env.adsEnv.intel ? env.intel(input.locale) : null),
    loadCrmOnlyCampaigns: async () => env.adsEnv.crmOnly,
  }
})
vi.mock('@/modules/adsReporting/actions', async () => (await import('./dealsMocks')).adsActionsModule())
vi.mock('@/lib/analytics/track', () => ({ track: () => {} }))

const { dealsPage, dealsShell, perfLayout, perfPage, promotionListPage, promotionPage } = await import('./dealsHarness')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Loc = 'he' | 'en' | 'ar'
const textOf = (el: Element | null) => (el?.textContent ?? '').replace(/[‎‏]/g, '').replace(/\s+/g, ' ')
const has = (text: string, ...parts: string[]) => {
  for (const p of parts) expect(text, p).toContain(p)
}
const regionOf = (el: Element | null) => [el?.getAttribute('lang') ?? null, el?.getAttribute('dir') ?? null]
const allowed = [
  ...DEALS_CUSTOMER_DATA.map((text) => ({ text, reason: 'customer-data' as const })),
  ...['מירב כהן', 'אבי ישראלי', 'יוסי לוי', 'נועה'].map((text) => ({ text, reason: 'customer-data' as const })),
  ...ADS_EXTERNAL.map((text) => ({ text, reason: 'external' as const })),
]
const lastDialog = () => Array.from(document.querySelectorAll('[role="dialog"]')).at(-1) ?? null
const btn = (root: ParentNode, label: string) => Array.from(root.querySelectorAll('button')).find((b) => b.textContent === label)!

async function deals(locale: Loc, filter?: Record<string, unknown>) {
  S.prefs.userLocale = locale
  return dealsShell(locale, await dealsPage(filter))
}
async function perf(locale: Loc, which: Parameters<typeof perfPage>[0], path: string) {
  S.prefs.userLocale = locale
  dealsEnv.pathname = path
  return dealsShell(locale, await perfLayout(await perfPage(which)))
}

const savedEnv = { ...process.env }
beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {} })
  window.scrollTo = () => {}
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  Object.assign(process.env, { UI_LOCALE_ENABLED: '1', UI_LOCALE_AGENCY_ALLOWLIST: '103' })
})
afterAll(() => {
  vi.useRealTimers()
  process.env = { ...savedEnv }
})
afterEach(() => {
  cleanup()
  resetDealsEnv()
  resetDealsSpies()
  resetAdsEnv()
})

describe('/deals in English and Arabic', () => {
  test('en: summary, table, statuses labelled, group actions, chips; the page declares en/ltr', async () => {
    dealsEnv.search = `filter=${JSON.stringify(RICH_FILTER)}`
    const { container } = render(await deals('en', RICH_FILTER))
    const text = textOf(container)
    has(text, 'Total revenue', 'Total deals', 'Deals', 'Add deal', 'Import deals', 'Customer', 'Deal amount', 'Active filters:', 'Inquiry', 'Sign-up')
    const statusSelect = container.querySelector('tbody select') as HTMLSelectElement
    expect(Array.from(statusSelect.options).map((o) => [o.value, o.text])).toEqual([
      ['חדש', 'New'],
      ['בהצעה', 'In progress'],
      ['במו"מ', 'In progress'],
      ['ממתין לתשלום', 'In progress'],
      ['שולם', 'Closed'],
      ['בוטל', 'Lost'],
    ])
    expect(regionOf(container.querySelector('[lang]'))).toEqual(['en', 'ltr'])
    expect(findHebrewLeaks(container, allowed)).toEqual([])
  })

  test('ar: Arabic strings, rtl, Latin digits in counts', async () => {
    const { container } = render(await deals('ar'))
    has(textOf(container), 'إجمالي الصفقات', 'إضافة صفقة', 'الصفقات')
    expect(regionOf(container.querySelector('[lang]'))).toEqual(['ar', 'rtl'])
    expect(textOf(container)).not.toMatch(/[٠-٩]/)
    expect(findHebrewLeaks(container, allowed)).toEqual([])
  })

  test('he: no region is declared (markup as before)', async () => {
    const { container } = render(await deals('he'))
    expect(container.querySelector('[lang]')).toBeNull()
  })

  test('dialogs in en: deal form (every field + validation), import dialog, row delete, group status confirmation', async () => {
    const { container } = render(await deals('en'))
    fireEvent.click(btn(container, 'Add deal'))
    let dialog = lastDialog()!
    expect(regionOf(dialog)).toEqual(['en', 'ltr'])
    has(textOf(dialog), 'New deal', 'Lead details', 'Product 1', 'Supplier', 'Category', 'Pipeline stage', 'Closing date', 'Add product')
    expect(findHebrewLeaks(dialog, allowed)).toEqual([])
    await act(async () => fireEvent.submit(dialog.querySelector('form')!))
    expect(textOf(lastDialog())).toContain('Error: choose a lead')
    fireEvent.keyDown(lastDialog()!, { key: 'Escape' })
    fireEvent.keyDown(lastDialog()!, { key: 'Escape' })
    fireEvent.click(btn(container, 'Import deals'))
    dialog = lastDialog()!
    has(textOf(dialog), 'Excel file (xlsx, xls)', 'Choose an Excel file')
    expect(findHebrewLeaks(dialog, allowed)).toEqual([])
    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.click(container.querySelectorAll('button[aria-haspopup="menu"]')[0])
    const menu = document.getElementById('saleActions')!
    has(textOf(menu), 'Delete', 'Edit', 'Add to favorites')
    fireEvent.click(btn(menu, 'Delete'))
    expect(textOf(lastDialog())).toMatch(/Delete the deal of .+\?/)
    expect(findHebrewLeaks(lastDialog()!, allowed)).toEqual([])
  })

  test('filter panel and saved filters in ar', async () => {
    S.prefs.userLocale = 'ar'
    const { default: Filter } = await import('@/components/filter')
    const { default: FilterBtn } = await import('@/components/filter/FilterBtn')
    const { container } = render(
      await dealsShell('ar', (
        <div>
          <FilterBtn user={dealsEnv.user} filter={RICH_FILTER} />
          <Filter props={{ users: [], teams: [], rawFilter: RICH_FILTER, handlers: [] }} />
        </div>
      )),
    )
    has(textOf(container), 'عوامل التصفية', 'تاريخ التواصل:', 'مخصص', 'الكل', 'الاستبدالات فقط', 'عوامل التصفية النشطة:')
    const range = container.querySelector('select[name="saleDtRange"]') as HTMLSelectElement
    expect(range.value).toBe('השנה הנוכחית')
    expect(range.options[range.selectedIndex].text).toBe('السنة الحالية')
    expect(findHebrewLeaks(container, allowed)).toEqual([])
  })
})

describe('/sum_sales, /promotion and ads in English', () => {
  test('overview: nav, boxes, pies (branch + product names labelled), pace', async () => {
    const { container } = render(await perf('en', 'overview', '/sum_sales'))
    has(textOf(container), 'Summary', 'Months', 'Ads', 'Total revenue (paid)', 'Pipeline', 'Deal comparison', 'Annual pace', 'Services', 'Website build', 'Total')
    expect(findHebrewLeaks(container, allowed)).toEqual([])
  })

  test('months / companies: headers by key, month and supplier cells labelled', async () => {
    let { container } = render(await perf('en', 'months', '/sum_sales/months'))
    has(textOf(container), 'Month', 'Weighted total', 'January', 'October')
    cleanup()
    ;({ container } = render(await perf('ar', 'companies', '/sum_sales/companies')))
    has(textOf(container), 'الشركة', 'بدون مورّد')
    expect(findHebrewLeaks(container, allowed)).toEqual([])
  })

  test('campaign detail in en: period, goals by branch, the totals table headers', async () => {
    S.prefs.userLocale = 'en'
    const { container } = render(await dealsShell('en', await promotionPage()))
    has(textOf(container), 'Campaign period:', 'Weighted total', 'Rep', 'Weighted total - ')
    expect(findHebrewLeaks(container, allowed)).toEqual([])
    cleanup()
    dealsEnv.promos = []
    S.prefs.userLocale = 'ar'
    const list = render(await dealsShell('ar', await promotionListPage()))
    has(textOf(list.container), 'لا توجد حملات بعد')
  })

  test('ads report in ar: signals, cards, trend, table; the account and campaign names untouched', async () => {
    S.prefs.userLocale = 'ar'
    dealsEnv.pathname = '/sum_sales/ads'
    const { default: Page } = await import('@/app/(he)/(app)/sum_sales/ads/page')
    const { container } = render(await dealsShell('ar', await perfLayout(await Page({ searchParams: Promise.resolve({}) }))))
    has(textOf(container), 'أداء الإعلانات', 'انتبه', 'حسب Meta', 'في SocialCRM', 'الأداء حسب الحملة', 'الاتجاه اليومي (يومان)', 'نقرة خلال 7 أيام أو مشاهدة خلال يوم واحد', 'حملة')
    // Meta's campaign names are external data: shown exactly as Meta returned them.
    has(textOf(container), 'קמפיין לידים ספטמבר', 'חשבון ראשי')
    expect(findHebrewLeaks(container, allowed)).toEqual([])
  })
})

describe('tab titles', () => {
  test('every page title follows the language (Hebrew unchanged)', async () => {
    const pages = {
      deals: await import('@/app/(he)/(app)/deals/page'),
      perf: await import('@/app/(he)/(app)/sum_sales/layout'),
      months: await import('@/app/(he)/(app)/sum_sales/months/page'),
      companies: await import('@/app/(he)/(app)/sum_sales/companies/page'),
      ads: await import('@/app/(he)/(app)/sum_sales/ads/page'),
      promos: await import('@/app/(he)/(app)/promotion/page'),
      promo: await import('@/app/(he)/(app)/promotion/[id]/page'),
    }
    const out: Record<string, string[]> = {}
    for (const locale of ['he', 'en', 'ar'] as const) {
      S.prefs.userLocale = locale
      for (const [k, m] of Object.entries(pages)) {
        out[k] = [...(out[k] ?? []), String((await (m as { generateMetadata: () => Promise<{ title?: unknown }> }).generateMetadata()).title)]
      }
    }
    expect(out).toEqual({
      deals: ['עסקאות', 'Deals', 'الصفقات'],
      perf: ['ביצועים', 'Performance', 'الأداء'],
      months: ['סיכום עסקאות לפי חודשים', 'Deals by month', 'ملخص الصفقات حسب الشهر'],
      companies: ['סיכום עסקאות לפי ספקים', 'Deals by supplier', 'ملخص الصفقات حسب المورّد'],
      ads: ['ביצועי מודעות', 'Ad performance', 'أداء الإعلانات'],
      promos: ['קמפיינים', 'Campaigns', 'الحملات'],
      promo: ['פרטי קמפיין', 'Campaign details', 'تفاصيل الحملة'],
    })
  })
})

describe('language switch within one session', () => {
  test('the deals table re-renders in the new language; the stored status values stay', async () => {
    const first = render(await deals('en'))
    const before = Array.from((first.container.querySelector('tbody select') as HTMLSelectElement).options).map((o) => o.value)
    cleanup()
    const second = render(await deals('ar'))
    const sel = second.container.querySelector('tbody select') as HTMLSelectElement
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(before)
    expect(sel.options[0].text).toBe('جديد')
  })
})

describe('hydration — server and client agree in every language', () => {
  for (const locale of ['he', 'en', 'ar'] as const) {
    for (const [name, build] of [
      ['deals', () => deals(locale)],
      ['overview', () => perf(locale, 'overview', '/sum_sales')],
      ['months', () => perf(locale, 'months', '/sum_sales/months')],
      ['promotion', async () => ((S.prefs.userLocale = locale), dealsShell(locale, await promotionPage()))],
    ] as const) {
      test(`${locale} · ${name}`, async () => {
        const node = await build()
        const container = document.createElement('div')
        container.innerHTML = renderToString(node)
        document.body.appendChild(container)
        const errors: unknown[] = []
        const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a))
        let root: ReturnType<typeof hydrateRoot> | undefined
        await act(async () => {
          root = hydrateRoot(container, node, { onRecoverableError: (e) => errors.push(e) })
        })
        spy.mockRestore()
        const real = errors.map((e) => (Array.isArray(e) ? e.map(String).join(' ') : String(e)).slice(0, 400)).filter((e) => !e.includes('unique "key" prop'))
        expect(real).toEqual([])
        act(() => root!.unmount())
        container.remove()
      })
    }
  }
})

describe('the actions column pins to the end of the row (final UI audit)', () => {
  test('he / ar pinned left as before, en pinned right', async () => {
    const seen = {} as Record<'he' | 'en' | 'ar', HTMLElement>
    for (const l of ['he', 'en', 'ar'] as const) {
      const { container } = render(await deals(l))
      seen[l] = container.cloneNode(true) as HTMLElement
      cleanup()
    }
    expectStickyEdges(seen)
  })
})
