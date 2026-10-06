// @vitest-environment jsdom
/**
 * Which ad account the report reads, and what it does when Meta is down.
 *
 *  · an account is read ONLY if Meta lists it for this connection's token — the
 *    URL's choice, else the remembered one, else the first;
 *  · the choice is remembered only after that verification;
 *  · a transient Meta failure may show the remembered account's last good
 *    report, labelled stale; an auth/permission failure never shows cached data;
 *  · without a connection, the SocialCRM-only view is shown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const h = vi.hoisted(() => ({
  connection: null as unknown,
  accounts: { ok: true, value: [] } as unknown,
  report: { ok: true, value: null } as unknown,
  reportCalls: [] as string[],
  selected: [] as string[],
  snapshots: new Map<string, { payload: unknown; fetchedAt: Date }>(),
  crmOnlyCalls: 0,
}))

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`)
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/sum_sales/ads',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/db/auth', () => ({ getUser: async () => ({ id: 332, agencyId: 103, role: 'ADMIN' }) }))
vi.mock('@/db/facebookAds', () => ({
  getAdConnection: async () => h.connection,
  setSelectedAdAccount: async (_a: number, _u: number, id: string) => void h.selected.push(id),
}))
vi.mock('@/db/adsSnapshots', () => ({
  readSnapshot: async (scope: { accountId: string; kind: string }, key: string) =>
    h.snapshots.get(`${scope.accountId}|${scope.kind}|${key}`) ?? null,
  writeSnapshot: async () => {},
}))
vi.mock('@/lib/facebook/ads/intelligence', () => ({
  loadAdsIntelligence: async () => null,
  loadCrmOnlyCampaigns: async () => {
    h.crmOnlyCalls++
    return [
      {
        id: '111',
        name: 'קמפיין מהלידים',
        outcome: {
          captured: 3,
          untouched: 1,
          contacted: 2,
          interested: 0,
          closed: 0,
          lost: 0,
          unknownStatus: 0,
          followUpScheduled: 0,
        },
      },
    ]
  },
}))
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
vi.mock('@/lib/facebook/ads/breakdown', () => ({ getAdsBreakdown: async () => null }))
vi.mock('@/modules/adsReporting/actions', () => ({ disconnectAdsReporting: vi.fn() }))
vi.mock('@/components/settings/MetaPermissionButton', () => ({
  default: ({ href, lbl }: { href: string; lbl: string }) => <a href={href}>{lbl}</a>,
}))

import AdsReportingPage from '@/app/(app)/sum_sales/ads/page'
import { businessDateString } from '@/lib/today/time'

const ACC_1 = { id: 'act_1', name: 'Main', currency: 'ILS', timezone: 'Asia/Jerusalem', status: 1 }
const ACC_2 = { id: 'act_2', name: 'Second', currency: 'USD', timezone: 'Asia/Jerusalem', status: 1 }
const REPORT = {
  period: { since: '2026-09-06', until: '2026-10-05' },
  totals: {
    spend: 100,
    impressions: 1000,
    reach: null,
    frequency: null,
    clicks: 10,
    ctr: 1,
    cpc: 10,
    cpm: 100,
    linkClicks: 5,
    linkCtr: null,
    linkCpc: null,
    leads: 3,
    purchases: 0,
    purchaseValue: null,
    messagingConversations: 0,
    attribution: null,
  },
  previous: null,
  daily: [],
  campaigns: [],
  statusesAvailable: true,
  reducedFields: false,
}
const connection = (selectedAccountId: string | null) => ({
  id: 1,
  token: 'server-only',
  grantedScopes: ['ads_read'],
  tokenExpiresAt: null,
  selectedAccountId,
})
const renderPage = async (sp: Record<string, string> = {}) =>
  render(await AdsReportingPage({ searchParams: Promise.resolve(sp) }))

beforeEach(() => {
  vi.stubEnv('FACEBOOK_ADS_REPORTING_ENABLED', '1')
  vi.stubEnv('FACEBOOK_ADS_REPORTING_AGENCY_ALLOWLIST', '103')
  h.connection = connection(null)
  h.accounts = { ok: true, value: [ACC_1, ACC_2] }
  h.report = { ok: true, value: REPORT }
  h.reportCalls = []
  h.selected = []
  h.snapshots.clear()
  h.crmOnlyCalls = 0
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('account selection', () => {
  it('opens on the remembered account when Meta still lists it', async () => {
    h.connection = connection('act_2')
    await renderPage()
    expect(h.reportCalls).toEqual(['act_2'])
    expect(h.selected).toEqual([])
  })

  it('remembers a choice from the URL only after verifying it', async () => {
    await renderPage({ account: 'act_2' })
    expect(h.reportCalls).toEqual(['act_2'])
    expect(h.selected).toEqual(['act_2'])
  })

  it('never reads or remembers an account Meta does not list for this token', async () => {
    h.connection = connection('act_999')
    await renderPage({ account: 'act_777' })
    expect(h.reportCalls).toEqual(['act_1'])
    expect(h.reportCalls).not.toContain('act_777')
    expect(h.selected).toEqual(['act_1'])
  })
})

describe('Meta outages', () => {
  it("a transient failure shows the remembered account's last good report", async () => {
    h.connection = connection('act_1')
    h.accounts = { ok: false, reason: 'meta_error' }
    h.report = { ok: false, reason: 'meta_error' }
    const today = businessDateString(Date.now())
    h.snapshots.set('act_1|account|meta', { payload: ACC_1, fetchedAt: new Date() })
    h.snapshots.set(`act_1|report|last_30d@${today}`, { payload: REPORT, fetchedAt: new Date(Date.now() - 3 * 3600_000) })
    await renderPage()
    expect(h.reportCalls).toEqual(['act_1']) // Meta was asked first, and failed
    expect(screen.getByText('תקופה:')).toBeInTheDocument() // the cached report rendered
    expect(h.selected).toEqual([]) // nothing is "remembered" from a cache
  })

  it('without a remembered account, a transient failure is an honest error, not old data', async () => {
    h.connection = connection(null)
    h.accounts = { ok: false, reason: 'meta_error' }
    await renderPage()
    expect(h.reportCalls).toEqual([])
    expect(screen.queryByText('תקופה:')).not.toBeInTheDocument()
  })

  it('an auth failure never falls back to cached data', async () => {
    h.connection = connection('act_1')
    h.accounts = { ok: false, reason: 'reconnect_required' }
    h.snapshots.set('act_1|account|meta', { payload: ACC_1, fetchedAt: new Date() })
    await renderPage()
    expect(h.reportCalls).toEqual([])
  })
})

describe('without a connection', () => {
  it('shows the SocialCRM-only campaigns beside the connect notice', async () => {
    h.connection = null
    await renderPage()
    expect(h.crmOnlyCalls).toBe(1)
    expect(screen.getByRole('region', { name: 'לידים ממודעות Meta ב-SocialCRM' })).toHaveTextContent('קמפיין מהלידים')
    expect(h.reportCalls).toEqual([])
  })
})
