// @vitest-environment jsdom
/**
 * The ad performance tab: where it appears, and which ONE state it shows.
 *
 * Production 2026-09-15: the feature was deployed but invisible — the tab and the
 * page are gated by FACEBOOK_ADS_REPORTING_ENABLED + its agency allowlist, which
 * were never set. These tests pin the gate (so "missing tab" has one explanation)
 * and every non-data state, so a missing permission, an expired token, a Meta
 * failure and "no activity" can never be confused with one another or with zero.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const h = vi.hoisted(() => ({
  user: { id: 332, agencyId: 103, role: 'ADMIN' } as Record<string, unknown> | null,
  connection: null as unknown,
  connectionThrows: false,
  accounts: { ok: true, value: [] } as unknown,
  report: { ok: true, value: { totals: null, campaigns: [] } } as unknown,
  reportCalls: [] as string[],
  breakdownCalls: [] as unknown[],
  redirects: [] as string[],
}))

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    h.redirects.push(to)
    throw new Error(`REDIRECT ${to}`)
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/sum_sales/ads',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/db/auth', () => ({ getUser: async () => h.user }))
vi.mock('@/db/facebookAds', () => ({
  getAdConnection: async () => {
    if (h.connectionThrows) throw new Error('seal could not be opened')
    return h.connection
  },
  setSelectedAdAccount: async () => {},
}))
// The snapshot cache starts empty, so every read below goes to the (mocked) Meta reads.
vi.mock('@/db/adsSnapshots', () => ({ readSnapshot: async () => null, writeSnapshot: async () => {} }))
// Meta ↔ SocialCRM context is covered by its own tests; here the report states are under test.
vi.mock('@/lib/facebook/ads/intelligence', () => ({ loadAdsIntelligence: async () => null, loadCrmOnlyCampaigns: async () => [] }))
vi.mock('@/lib/device', () => ({ getInAppBrowser: async () => null }))
vi.mock('@/lib/facebook/ads/insights', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/facebook/ads/insights')>()
  return { ...actual, listAdAccounts: async () => h.accounts }
})
vi.mock('@/lib/facebook/ads/report', () => ({
  DAILY_MAX_DAYS: 92,
  getAdsReport: async (_token: string, accountId: string) => {
    h.reportCalls.push(accountId)
    return h.report
  },
}))
vi.mock('@/lib/facebook/ads/breakdown', () => ({
  getAdsBreakdown: async (_t: string, accountId: string, _r: unknown, parent: unknown) => {
    h.breakdownCalls.push({ accountId, parent })
    return { ok: true, value: { level: 'adset', campaign: { id: '111', name: 'Leads' }, adset: null, rows: [], statusesAvailable: true } }
  },
}))
vi.mock('@/modules/adsReporting/actions', () => ({ disconnectAds: vi.fn() }))
vi.mock('@/components/settings/MetaPermissionButton', () => ({
  default: ({ href, lbl }: { href: string; lbl: string }) => <a href={href}>{lbl}</a>,
}))

import AdsReportingPage from '@/app/(app)/sum_sales/ads/page'
import SumSalesNav from '@/components/sumSales/SumSalesNav'
import { ADS_NOTICES } from '@/modules/adsReporting/notices'

const CONNECTED = { id: 1, token: 'server-only', grantedScopes: ['ads_read', 'public_profile'], tokenExpiresAt: null }
const ACCOUNTS = {
  ok: true,
  value: [
    { id: 'act_1', name: 'Socialcrm Ads', currency: 'ILS', status: 1 },
    { id: 'act_2', name: 'Second', currency: 'USD', status: 1 },
  ],
}

async function renderPage(sp: Record<string, string> = {}) {
  render(await AdsReportingPage({ searchParams: Promise.resolve(sp) }))
}
const connectLink = () => screen.queryByRole('link', { name: /חבר|לנסות שוב|חבר שוב|חבר מחדש/ })

beforeEach(() => {
  vi.stubEnv('FACEBOOK_ADS_REPORTING_ENABLED', '1')
  vi.stubEnv('FACEBOOK_ADS_REPORTING_AGENCY_ALLOWLIST', '103')
  h.user = { id: 332, agencyId: 103, role: 'ADMIN' }
  h.connection = CONNECTED
  h.connectionThrows = false
  h.accounts = ACCOUNTS
  h.report = { ok: true, value: { period: null, totals: null, previous: null, daily: [], campaigns: [], statusesAvailable: true } }
  h.reportCalls = []
  h.breakdownCalls = []
  h.redirects = []
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('where the feature appears', () => {
  it('the ביצועים sub-navigation shows מודעות only when the layout allows it', () => {
    const { rerender } = render(<SumSalesNav user={{ role: 'ADMIN' }} showAds />)
    expect(screen.getByRole('link', { name: 'מודעות' })).toHaveAttribute('href', '/sum_sales/ads')
    rerender(<SumSalesNav user={{ role: 'ADMIN' }} showAds={false} />)
    expect(screen.queryByRole('link', { name: 'מודעות' })).not.toBeInTheDocument()
  })

  it('without the rollout flag for the agency the page is not reachable — it redirects to ביצועים', async () => {
    vi.stubEnv('FACEBOOK_ADS_REPORTING_AGENCY_ALLOWLIST', '999')
    await expect(renderPage()).rejects.toThrow('REDIRECT /sum_sales')
  })

  it('a non-admin sees an explanation, never ad spend', async () => {
    h.user = { id: 400, agencyId: 103, role: 'AGNT' }
    await renderPage()
    expect(screen.getByText('ביצועי המודעות זמינים למנהלי החשבון בלבד.')).toBeInTheDocument()
    expect(h.reportCalls).toEqual([])
  })
})

describe('authorization states — each distinct', () => {
  it('never connected: the connect prompt, starting the ads_read-only flow', async () => {
    h.connection = null
    await renderPage()
    expect(screen.getByText(ADS_NOTICES.connect.title)).toBeInTheDocument()
    expect(connectLink()).toHaveAttribute('href', '/api/auth/facebook/ads')
  })

  it.each(['declined', 'denied'])('ads_error=%s after Meta: declined, not the first-time prompt', async (err) => {
    h.connection = null
    await renderPage({ ads_error: err })
    expect(screen.getByText(ADS_NOTICES.declined.title)).toBeInTheDocument()
  })

  it.each(['token', 'save', 'state'])('ads_error=%s: the connection failed — said so, with a way to retry', async (err) => {
    h.connection = null
    await renderPage({ ads_error: err })
    expect(screen.getByText(ADS_NOTICES.connect_failed.title)).toBeInTheDocument()
    expect(screen.queryByText(ADS_NOTICES.connect.title)).not.toBeInTheDocument()
    expect(connectLink()).toHaveAttribute('href', '/api/auth/facebook/ads')
  })

  it('a stored connection without ads_read is a missing permission', async () => {
    h.connection = { ...CONNECTED, grantedScopes: ['public_profile'] }
    await renderPage()
    expect(screen.getByText(ADS_NOTICES.declined.title)).toBeInTheDocument()
  })

  it('an expired token, or a token this deployment cannot open, asks to reconnect', async () => {
    h.connection = { ...CONNECTED, tokenExpiresAt: new Date(Date.now() - 1000) }
    await renderPage()
    expect(screen.getByText(ADS_NOTICES.expired.title)).toBeInTheDocument()
    cleanup()
    h.connectionThrows = true
    await renderPage()
    expect(screen.getByText(ADS_NOTICES.expired.title)).toBeInTheDocument()
  })
})

describe('Meta responses — failures are never zero', () => {
  it.each([
    ['reconnect_required', 'expired'],
    ['permission_missing', 'permission'],
    ['rate_limited', 'rate_limited'],
    ['meta_error', 'meta_error'],
  ] as const)('account list %s → %s notice', async (reason, kind) => {
    h.accounts = { ok: false, reason }
    await renderPage()
    expect(screen.getByText(ADS_NOTICES[kind].title)).toBeInTheDocument()
    expect(h.reportCalls).toEqual([])
  })

  it('no ad accounts for this user', async () => {
    h.accounts = { ok: true, value: [] }
    await renderPage()
    expect(screen.getByText(ADS_NOTICES.no_accounts.title)).toBeInTheDocument()
  })

  it('an insights failure is an error notice, not an empty report', async () => {
    h.report = { ok: false, reason: 'meta_error' }
    await renderPage()
    expect(screen.getByText(ADS_NOTICES.meta_error.title)).toBeInTheDocument()
    expect(screen.queryByText('הוצאה')).not.toBeInTheDocument()
  })

  it('no rows from Meta for the range is "no activity" — not zero spend', async () => {
    await renderPage()
    expect(screen.getByText(ADS_NOTICES.no_activity.title)).toBeInTheDocument()
    expect(screen.queryByText('הוצאה')).not.toBeInTheDocument()
  })

  it("shows Meta's numbers inside the report shell; a metric Meta did not return is a dash", async () => {
    const metrics = { spend: 1234.5, impressions: 56789, reach: null, frequency: null, clicks: 321, ctr: null, cpc: 3.85, cpm: null, linkClicks: 200, linkCtr: null, linkCpc: null, leads: 12, purchases: 0, purchaseValue: null, messagingConversations: 0, attribution: '7d_click,1d_view' }
    h.report = {
      ok: true,
      value: {
        period: { since: '2026-08-16', until: '2026-09-14' },
        totals: metrics,
        previous: null,
        daily: [],
        campaigns: [{ id: '111', name: 'קמפיין לידים', objective: 'OUTCOME_LEADS', status: 'ACTIVE', metrics, result: { kind: 'leads', count: 12, cost: 102.88 } }],
        statusesAvailable: true,
      },
    }
    await renderPage()
    expect(screen.getAllByText('הוצאה').length).toBeGreaterThan(0)
    expect(screen.getByText('קמפיין לידים')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.getByTestId('ads-report-status')).toHaveTextContent('הבחירה: Socialcrm Ads · 30 ימים אחרונים')
  })

  it('repeated or malformed query values never crash the page or reach Meta', async () => {
    h.report = { ok: true, value: { period: null, totals: { spend: 1 }, previous: null, daily: [], campaigns: [], statusesAvailable: true } }
    render(await AdsReportingPage({ searchParams: Promise.resolve({ range: ['last_7d', 'last_30d'], campaign: 'not-a-number' }) as never }))
    expect(h.reportCalls).toEqual(['act_1'])
    expect(h.breakdownCalls).toEqual([])
  })

  it('a drill-down id in the URL is read only inside the verified account', async () => {
    h.report = { ok: true, value: { period: null, totals: { spend: 1 }, previous: null, daily: [], campaigns: [], statusesAvailable: true } }
    await renderPage({ account: 'act_999', campaign: '111' })
    expect(h.breakdownCalls).toEqual([{ accountId: 'act_1', parent: { campaignId: '111', adsetId: undefined } }])
  })

  it('an account id the token cannot see is never queried — the first listed account is', async () => {
    await renderPage({ account: 'act_999' })
    expect(h.reportCalls).toEqual(['act_1'])
    cleanup()
    h.reportCalls = []
    await renderPage({ account: 'act_2' })
    expect(h.reportCalls).toEqual(['act_2'])
  })
})
