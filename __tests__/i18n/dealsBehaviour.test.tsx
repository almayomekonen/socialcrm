// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { ALL_USERS, DEALS, DEALS_USER, NOW, PERM_USERS, RICH_FILTER, dealsEnv, resetDealsEnv } from './dealsEnv'
import { dealsSpies as S, resetDealsSpies } from './dealsMocks'
import { resetAdsEnv } from './adsEnv'

/**
 * Behaviour is the same in every language (Phase E2): every write sends the
 * same arguments, the filter URL and stored values are unchanged, validation is
 * shown translated, dialogs close on Escape and give focus back, icon-only
 * controls are named in the interface language.
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

const { dealsPage, dealsShell } = await import('./dealsHarness')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const LOCALES = ['he', 'en', 'ar'] as const
type Loc = (typeof LOCALES)[number]
const lastDialog = () => Array.from(document.querySelectorAll('[role="dialog"]')).at(-1) ?? null
const calls = (name: string) => S.calls.filter((c) => c[0] === name)
const formProps = { user: DEALS_USER, officeGotPerm: [], saleId: undefined, allUsers: ALL_USERS }

async function deals(locale: Loc) {
  S.prefs.userLocale = locale
  return render(await dealsShell(locale, await dealsPage()))
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

async function perLocale<T>(run: (locale: Loc) => Promise<T>): Promise<T[]> {
  const out: T[] = []
  for (const locale of LOCALES) {
    out.push(await run(locale))
    cleanup()
    resetDealsSpies()
  }
  return out
}
const same = <T,>(values: T[]) => {
  // Never vacuous: the Hebrew run recorded real writes.
  expect(JSON.stringify(values[0]).length, JSON.stringify(values[0])).toBeGreaterThan(40)
  expect(values[1]).toEqual(values[0])
  expect(values[2]).toEqual(values[0])
}

describe('every write sends the same arguments in every language', () => {
  test('deal form: edit + save (insertSale), product-exists check', async () => {
    same(
      await perLocale(async (locale) => {
        const { default: SaleForm } = await import('@/components/sales/saleForm/SaleForm')
        S.prefs.userLocale = locale
        const { container } = render(await dealsShell(locale, <SaleForm props={formProps as never} curSale={{ ...DEALS[2] } as never} onClose={() => {}} />))
        await act(async () => fireEvent.submit(container.querySelector('form')!))
        return [calls('isPrdctsExists'), calls('insertSale')]
      }),
    )
  })

  test('table: row status picker, row favourite, row delete; group status / favourites / delete', async () => {
    same(
      await perLocale(async (locale) => {
        const { container } = await deals(locale)
        await act(async () => fireEvent.change(container.querySelector('tbody select')!, { target: { value: 'שולם' } }))
        fireEvent.click(container.querySelectorAll('button[aria-haspopup="menu"]')[1])
        const menu = Array.from(document.querySelectorAll('#saleActions button'))
        fireEvent.click(menu[2])
        fireEvent.click(menu[0])
        await act(async () => fireEvent.click(Array.from(lastDialog()!.querySelectorAll('button')).at(-1)!))
        const rows = Array.from(container.querySelectorAll('input[name="checkRow"]')) as HTMLInputElement[]
        rows.slice(0, 2).forEach((r) => (r.checked = true))
        const group = Array.from(container.querySelectorAll('select')).find((s) => s.querySelector('optgroup'))!
        const optionValues = Array.from(group.querySelectorAll('option')).map((o) => o.value)
        for (const val of ['בוטל', 'הוספה למועדפים', 'מחיקת העסקאות']) {
          fireEvent.change(group, { target: { value: val } })
          await act(async () => fireEvent.click(Array.from(lastDialog()!.querySelectorAll('button')).at(-1)!))
        }
        return { optionValues, calls: S.calls.filter((c) => c[0] !== 'saveTblPref') }
      }),
    )
  })

  test('filter: submit URL, chip removal URL, a saved filter', async () => {
    same(
      await perLocale(async (locale) => {
        S.prefs.userLocale = locale
        const { default: Filter } = await import('@/components/filter')
        const { default: FilterBtn } = await import('@/components/filter/FilterBtn')
        const { container } = render(
          await dealsShell(locale, (
            <div>
              <FilterBtn user={DEALS_USER} filter={RICH_FILTER} />
              <Filter props={{ users: PERM_USERS, teams: [], rawFilter: RICH_FILTER, handlers: PERM_USERS }} />
            </div>
          )),
        )
        await act(async () => fireEvent.submit(container.querySelector('#filterPop form')!))
        const removes = Array.from(container.querySelectorAll('button[aria-label]')).filter((b) => b.className.includes('rounded-full'))
        removes.forEach((b) => fireEvent.click(b))
        const saved = container.querySelector('#savedFilters') as HTMLSelectElement
        return { replaces: [...S.replaces], saved: Array.from(saved.options).map((o) => o.value) }
      }),
    )
  })

  test('import: the confirmed rows reach importDeals unchanged', async () => {
    same(
      await perLocale(async (locale) => {
        const { default: UploadDealsData } = await import('@/components/sales/UploadDealsData')
        S.prefs.userLocale = locale
        S.uploadDealData.mockImplementation(async () => ({ data: [{ amount: 1 }, { amount: 2 }], wrongData: [] }))
        const { container } = render(await dealsShell(locale, <UploadDealsData />))
        await act(async () => fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'a.xlsx')] } }))
        await act(async () => fireEvent.click(Array.from(lastDialog()!.querySelectorAll('button')).at(-1)!))
        return calls('importDeals')
      }),
    )
  })
})

describe('validation, dialogs and names in the interface language', () => {
  test('ar: the deal form validation message is Arabic', async () => {
    const { default: SaleForm } = await import('@/components/sales/saleForm/SaleForm')
    S.prefs.userLocale = 'ar'
    const { container } = render(await dealsShell('ar', <SaleForm props={formProps as never} onClose={() => {}} />))
    await act(async () => fireEvent.submit(container.querySelector('form')!))
    expect(lastDialog()!.textContent).toContain('خطأ، يجب اختيار عميل محتمل')
    expect(calls('insertSale')).toEqual([])
  })

  test('Escape closes the deal dialog and gives focus back to its opener', async () => {
    const { container } = await deals('en')
    const opener = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Import deals')!
    opener.focus()
    fireEvent.click(opener)
    expect(lastDialog()).not.toBeNull()
    fireEvent.keyDown(lastDialog()!, { key: 'Escape' })
    expect(lastDialog()).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  test('icon-only controls are named in the interface language', async () => {
    S.prefs.userLocale = 'en'
    dealsEnv.search = `filter=${JSON.stringify({ status: ['שולם'] })}`
    const { container } = render(await dealsShell('en', await dealsPage({ status: ['שולם'] })))
    const names = Array.from(container.querySelectorAll('button[aria-label], button[title], a[aria-label]')).map((b) => b.getAttribute('aria-label') ?? b.getAttribute('title'))
    expect(names).toEqual(expect.arrayContaining(['Actions', 'Clear filter', 'Add filter', 'Remove filter Status', 'Import deals']))
  })

  test('stored values: status options, branch / supplier / product options keep their Hebrew values', async () => {
    const { default: SaleForm } = await import('@/components/sales/saleForm/SaleForm')
    const values = await perLocale(async (locale) => {
      S.prefs.userLocale = locale
      const { container } = render(await dealsShell(locale, <SaleForm props={formProps as never} curSale={{ ...DEALS[0] } as never} onClose={() => {}} />))
      return Array.from(container.querySelectorAll('fieldset select')).map((s) => Array.from((s as HTMLSelectElement).options).map((o) => o.value))
    })
    same(values)
    expect(values[0].flat()).toEqual(expect.arrayContaining(['ללא ספק', 'שירותים', 'בניית אתר', 'ממתין לתשלום']))
  })
})

describe('Hebrew constants and the catalog say the same thing', () => {
  test('ads notices, range / objective / result / status labels; deal labels are the identity in Hebrew', async () => {
    const { ADS_NOTICES, adsNotice } = await import('@/modules/adsReporting/notices')
    const { ADS_RANGE_LABEL, ADS_RANGE_PRESETS, adsPresetLabel } = await import('@/lib/facebook/ads/dateRange')
    const results = await import('@/lib/facebook/ads/results')
    const { translatorFor } = await import('@/lib/i18n/translators')
    const labels = await import('@/lib/deals/labels')
    const lists = await import('@/types/lists')
    for (const kind of Object.keys(ADS_NOTICES) as (keyof typeof ADS_NOTICES)[]) {
      expect(adsNotice(kind, 'he')).toBe(ADS_NOTICES[kind])
      // The English notice keeps the same shape (tone, call to action, number of reasons).
      const en = adsNotice(kind, 'en')
      expect([en.tone, en.cta, en.reasons?.length, Boolean(en.nextStep), Boolean(en.action)]).toEqual([
        ADS_NOTICES[kind].tone,
        ADS_NOTICES[kind].cta,
        ADS_NOTICES[kind].reasons?.length,
        Boolean(ADS_NOTICES[kind].nextStep),
        Boolean(ADS_NOTICES[kind].action),
      ])
    }
    const t = translatorFor('he')
    for (const p of [...ADS_RANGE_PRESETS, 'custom'] as const) expect(adsPresetLabel(p, 'he')).toBe(ADS_RANGE_LABEL[p])
    for (const [code, he] of Object.entries(results.OBJECTIVE_LABEL)) expect(results.objectiveLabel(code, 'he')).toBe(he)
    for (const [code, he] of Object.entries(results.STATUS_LABEL)) expect(results.adsStatusLabel(code, 'he')).toBe(he)
    for (const [kind, he] of Object.entries(results.RESULT_LABEL)) expect(results.resultLabel(kind as never, 'he')).toBe(he)
    expect(t('performance.adsNotices.connect.title')).toBe(ADS_NOTICES.connect.title)
    for (const v of [...lists.STATUS_LIST, ...lists.BRANCHES, ...lists.COMPANIES, ...lists.PRDCT_TYPES, ...lists.extendedBranchList])
      expect([labels.dealStatusLabel(v), labels.dealBranchLabel(v), labels.dealCompanyLabel(v), labels.dealProductTypeLabel(v)]).toEqual([v, v, v, v])
    // Every stored value has a label in another language (none falls back to Hebrew).
    for (const v of lists.STATUS_LIST) expect(labels.dealStatusLabel(v, 'en')).not.toBe(v)
    for (const v of lists.extendedBranchList) expect(labels.dealBranchLabel(v, 'ar')).not.toBe(v)
    for (const { prdctList } of Object.values(lists.prdctOptByBranch))
      for (const v of prdctList) if (!['SEO', 'PPC'].includes(v)) expect(labels.dealProductLabel(v, 'en')).not.toBe(v)
    expect(labels.reportMonthLabel('ינואר', 'ar')).toBe('يناير')
  })
})
