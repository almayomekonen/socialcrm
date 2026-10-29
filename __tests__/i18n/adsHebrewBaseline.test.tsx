// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { NOW, dealsEnv, resetDealsEnv } from './dealsEnv'
import { dealsSpies, resetDealsSpies } from './dealsMocks'
import { dealsShell } from './dealsHarness'
import { ACCOUNTS, AD_BREAKDOWN, CRM_ONLY_GROUPS, adsEnv, intel, report, resetAdsEnv } from './adsEnv'

/**
 * HEBREW BASELINE for /sum_sales/ads (ad performance, desktop). Recorded
 * BEFORE Phase E2; every Hebrew render must still match byte-for-byte.
 * The REAL page runs for the page states (Meta reads mocked); report pieces are
 * rendered as the page composes them. Label producers are pinned as data.
 */

vi.mock('next/navigation', async () => (await import('./dealsMocks')).navigationModule())
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }))
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./dealsEnv')).dealsEnv.user }))
vi.mock('@/db/uiLocale', async () => ({
  getUiLocalePrefs: async () => ({ userLocale: (await import('./dealsMocks')).dealsSpies.prefs.userLocale, agencyLocale: null }),
}))
vi.mock('@/lib/device', () => ({ isMobileRequest: async () => false, isMobileWorkspaceRequest: async () => false, getInAppBrowser: async () => null }))
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
vi.mock('@/lib/toast', async () => (await import('./dealsMocks')).toastModule())

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const renderToString = (node: ReactNode) => normalizeIds(renderRaw(<>{node}</>).replaceAll('<!-- -->', ''))
const html = (el: Element | null) => {
  if (!el) throw new Error('element not found')
  return normalizeIds(el.outerHTML)
}

async function adsPage(query: Record<string, string> = {}) {
  const { default: Page } = await import('@/app/(app)/sum_sales/ads/page')
  return Page({ searchParams: Promise.resolve(query) })
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
  resetAdsEnv()
})

describe('Hebrew baseline — /sum_sales/ads page states (server HTML)', () => {
  test('every notice state, non-admin, the SocialCRM-only section', async () => {
    const out: Record<string, string> = {}
    const page = async (q: Record<string, string> = {}) => renderToString(await dealsShell(null, await adsPage(q)))
    adsEnv.connection = null
    out.connect = await page()
    out.connectFailed = await page({ ads_error: 'token' })
    out.declined = await page({ ads_error: 'declined' })
    adsEnv.connectionThrows = true
    out.expired = await page()
    adsEnv.connectionThrows = false
    adsEnv.connection = { ...(await import('./adsEnv')).CONNECTED, grantedScopes: [] }
    out.declinedScope = await page()
    resetAdsEnv()
    adsEnv.accounts = { ok: true, value: [] }
    out.noAccounts = await page()
    for (const reason of ['reconnect_required', 'permission_missing', 'rate_limited', 'meta_error'] as const) {
      adsEnv.accounts = { ok: false, reason }
      out[`accounts_${reason}`] = await page()
    }
    resetAdsEnv()
    adsEnv.report = { ok: true, value: report({ totals: null }) }
    out.noActivity = await page()
    adsEnv.report = { ok: false, reason: 'rate_limited' }
    out.reportRateLimited = await page({ range: 'custom', since: '2026-10-10', until: '2026-10-01' })
    dealsEnv.user = { ...dealsEnv.user, role: 'AGNT' }
    out.notAdmin = await page()
    expect(out).toMatchSnapshot()
  })

  test('a full report: context line, summary, intelligence, trend, campaign table, footnote', async () => {
    expect(renderToString(await dealsShell(null, await adsPage({ account: 'act_1', range: 'last_7d' })))).toMatchSnapshot()
  })

  test('drill-down: ad sets of a campaign, ads of an ad set (no names, statuses not loaded), a failed drill-down', async () => {
    const out: Record<string, string> = {}
    out.adsets = renderToString(await dealsShell(null, await adsPage({ campaign: '111' })))
    adsEnv.breakdown = { ok: true, value: AD_BREAKDOWN }
    out.ads = renderToString(await dealsShell(null, await adsPage({ campaign: '111', adset: '811' })))
    adsEnv.breakdown = { ok: false, reason: 'permission_missing' }
    out.failed = renderToString(await dealsShell(null, await adsPage({ campaign: '111' })))
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — /sum_sales/ads pieces', () => {
  test('report variants: no comparison states, daily trend too long / unavailable, intel without stale or outside leads', async () => {
    const { default: AdsReportShell } = await import('@/modules/adsReporting/components/AdsReportShell')
    const { default: AdsReportView } = await import('@/modules/adsReporting/components/AdsReportView')
    const account = { name: 'חשבון ראשי', currency: null, timezone: null }
    const out: Record<string, string> = {}
    const view = (r: ReturnType<typeof report>, withIntel = false) =>
      renderToString(
        <AdsReportShell rendered={{}} renderedLabel='x' controls={null}>
          <AdsReportView report={r as never} breakdown={null} account={account} intel={withIntel ? intel(undefined, { freshness: null, outsideReport: 0, topAds: null }) : null} />
        </AdsReportShell>,
      )
    out.unavailable = view(report({ previous: 'unavailable', daily: 'too_long', reducedFields: false }))
    out.partial = view(report({ previous: 'partial', daily: 'unavailable' }))
    out.noPrevious = view(report({ previous: null, daily: [], campaigns: [] }), true)
    out.previousEmpty = view(report({ previous: { period: { since: '2026-08-16', until: '2026-09-14' }, totals: null } }))
    expect(out).toMatchSnapshot()
  })

  test('controls (custom range), shell updating, retry, disconnect confirmation + toast, video preview states, skeleton, error boundary', async () => {
    const { default: AdsReportShell } = await import('@/modules/adsReporting/components/AdsReportShell')
    const { default: AdsReportControls } = await import('@/modules/adsReporting/components/AdsReportControls')
    const { default: AdsRetryButton } = await import('@/modules/adsReporting/components/AdsRetryButton')
    const { default: DisconnectAdsButton } = await import('@/modules/adsReporting/components/DisconnectAdsButton')
    const { default: AdVideoPreview } = await import('@/modules/adsReporting/components/AdVideoPreview')
    const { default: AdsReportSkeleton } = await import('@/modules/adsReporting/components/AdsReportSkeleton')
    const { default: AdsError } = await import('@/app/(app)/sum_sales/ads/error')
    const out: Record<string, unknown> = {}
    const { container } = render(
      await dealsShell(
        null,
        <AdsReportShell rendered={{ account: 'act_1', range: 'custom', since: '2026-10-01', until: '2026-10-05' }} renderedLabel='חשבון ראשי · 2026-10-01 – 2026-10-05' controls={<AdsReportControls accounts={ACCOUNTS} accountId='act_1' today='2026-10-15' />}>
          <AdsRetryButton />
          <DisconnectAdsButton />
          <AdVideoPreview adId='902' url='https://cdn.test/video.jpg' name='מודעת וידאו' />
        </AdsReportShell>,
      ),
    )
    out.idle = html(container.firstElementChild)
    fireEvent.change(container.querySelector('#ads-since')!, { target: { value: '2026-10-09' } })
    fireEvent.change(container.querySelector('#ads-until')!, { target: { value: '2026-10-02' } })
    out.invalidCustom = html(container.querySelector('#ads-until')!.closest('.flex'))
    fireEvent.change(container.querySelector('#ads-range')!, { target: { value: 'last_month' } })
    out.updating = html(container.querySelector('[data-testid="ads-report-status"]'))
    fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'נתק חשבון מודעות')!)
    out.disconnectConfirm = html(document.querySelector('[role="dialog"]'))
    await act(async () => fireEvent.click(Array.from(document.querySelectorAll('[role="dialog"] button')).at(-1)!))
    await act(async () => fireEvent.click(container.querySelector('button[aria-haspopup="dialog"]')!))
    out.previewError = html(Array.from(document.querySelectorAll('[role="dialog"]')).at(-1)!)
    out.toasts = dealsSpies.toasts
    out.pushes = dealsSpies.pushes
    cleanup()
    out.skeleton = renderToString(<AdsReportSkeleton />)
    out.error = renderToString(<AdsError error={new Error('x')} reset={() => {}} />)
    out.retryAlone = renderToString(<AdsRetryButton lbl='חבר שוב' />)
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — ads producers', () => {
  test('notices, range labels, objective / result / status labels, attribution, signals, the CRM-only fallback name', async () => {
    const notices = await import('@/modules/adsReporting/notices')
    const range = await import('@/lib/facebook/ads/dateRange')
    const results = await import('@/lib/facebook/ads/results')
    expect({
      notices: notices.ADS_NOTICES,
      noConnection: ['declined', 'denied', 'token', 'save', 'state', undefined, 'x'].map((e) => notices.noConnectionNotice(e)),
      rangeLabels: range.ADS_RANGE_LABEL,
      rangeLabel: [range.adsRangeLabel({ kind: 'preset', preset: 'this_month' }), range.adsRangeLabel({ kind: 'custom', since: '2026-10-01', until: '2026-10-05' })],
      objectives: results.OBJECTIVE_LABEL,
      results: results.RESULT_LABEL,
      statuses: results.STATUS_LABEL,
      attribution: ['1d_click', '7d_click,1d_view', '28d_click,1d_ev', 'mixed', 'default', 'skan', null].map((s) => results.attributionLabel(s)),
      signals: intel().signals,
      crmOnly: CRM_ONLY_GROUPS.map((g) => g.name),
    }).toMatchSnapshot()
  })
})
