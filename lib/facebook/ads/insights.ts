import { describeGraphError, graphRequest, type MetaGraphError } from '@/lib/facebook/graphClient'
import { insightsRangeParams, type AdsRange } from '@/lib/facebook/ads/dateRange'

/**
 * Read-only ad performance through `ads_read`:
 *   GET /me/adaccounts                    — accounts this user may read
 *   GET /{act_id}/insights (level=account) — totals
 *   GET /{act_id}/insights (level=campaign) — per campaign
 * No mutation endpoint is called, and `ads_management` is never requested.
 *
 * NUMBERS ARE META'S. A metric Meta did not return stays `null` and renders as
 * "—"; nothing is defaulted to 0, because "no data" and "zero" mean different
 * things to someone deciding where to spend.
 *
 * Pagination follows cursors (`after`) through graphClient — never Meta's
 * `paging.next` URL, which embeds the access token.
 */

export type AdAccount = { id: string; name: string; currency: string | null; status: number | null }

export type AdsMetrics = {
  spend: number | null
  impressions: number | null
  clicks: number | null
  ctr: number | null
  cpc: number | null
}

export type CampaignPerformance = AdsMetrics & { campaignId: string; campaignName: string }

export type AdsFailure = 'reconnect_required' | 'permission_missing' | 'rate_limited' | 'meta_error'

export type AdsResult<T> = { ok: true; value: T } | { ok: false; reason: AdsFailure }

const METRIC_FIELDS = ['spend', 'impressions', 'clicks', 'ctr', 'cpc']
const MAX_ACCOUNT_PAGES = 5
const CAMPAIGN_PAGE_SIZE = 100
const MAX_CAMPAIGN_PAGES = 5

/**
 * Error → reason, per the Graph error-handling guide: 190 invalid token;
 * 10 and 200-299 permission errors; 4/17/32/613 throttling, plus the
 * 80000-80014 range the Marketing API uses for its business-use-case rate limits.
 */
export function adsFailureFromGraph(error: MetaGraphError): AdsFailure {
  if (error.kind !== 'graph') return 'meta_error'
  const code = error.code
  if (code === 190 || error.status === 401) return 'reconnect_required'
  if (code === 4 || code === 17 || code === 32 || code === 613 || (code !== null && code >= 80000 && code <= 80014)) {
    return 'rate_limited'
  }
  if (code === 10 || (code !== null && code >= 200 && code <= 299)) return 'permission_missing'
  return 'meta_error'
}

const toNumber = (v: unknown): number | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function metricsOf(row: Record<string, unknown> | undefined): AdsMetrics {
  return {
    spend: toNumber(row?.spend),
    impressions: toNumber(row?.impressions),
    clicks: toNumber(row?.clicks),
    ctr: toNumber(row?.ctr),
    cpc: toNumber(row?.cpc),
  }
}

function fail<T>(error: MetaGraphError, what: string): AdsResult<T> {
  const reason = adsFailureFromGraph(error)
  console.warn(`[AdsReporting] ${what} failed`, { reason, detail: describeGraphError(error) })
  return { ok: false, reason }
}

export async function listAdAccounts(token: string): Promise<AdsResult<AdAccount[]>> {
  const accounts: AdAccount[] = []
  let after: string | undefined
  for (let page = 0; page < MAX_ACCOUNT_PAGES; page++) {
    const result = await graphRequest<{ data?: Record<string, unknown>[]; paging?: { cursors?: { after?: string } } }>({
      path: '/me/adaccounts',
      token,
      query: { fields: 'id,name,currency,account_status', limit: 100, after },
    })
    if ('error' in result) return fail(result.error, 'list ad accounts')
    for (const a of result.data.data ?? []) {
      if (typeof a.id !== 'string' || !a.id.startsWith('act_')) continue
      accounts.push({
        id: a.id,
        name: typeof a.name === 'string' && a.name ? a.name : a.id,
        currency: typeof a.currency === 'string' ? a.currency : null,
        status: toNumber(a.account_status),
      })
    }
    after = result.data.paging?.cursors?.after
    if (!after || (result.data.data ?? []).length === 0) break
  }
  return { ok: true, value: accounts }
}

export type AdsReport = {
  /** Null when Meta returned no rows for the range — no activity, not an error. */
  totals: AdsMetrics | null
  campaigns: CampaignPerformance[]
}

/**
 * `accountId` MUST already be verified as one of `listAdAccounts(token)` for
 * this token — the page does that before calling. The id shape is re-checked
 * here so a malformed value can never be spliced into a Graph path.
 */
export async function getAdsReport(token: string, accountId: string, range: AdsRange): Promise<AdsResult<AdsReport>> {
  if (!/^act_\d+$/.test(accountId)) return { ok: false, reason: 'permission_missing' }
  const rangeParams = insightsRangeParams(range)

  const totals = await graphRequest<{ data?: Record<string, unknown>[] }>({
    path: `/${accountId}/insights`,
    token,
    query: { level: 'account', fields: METRIC_FIELDS.join(','), ...rangeParams },
  })
  if ('error' in totals) return fail(totals.error, 'account insights')

  // Campaign rows, following cursors (never paging.next) up to a bounded number of pages.
  const campaignRows: Record<string, unknown>[] = []
  let after: string | undefined
  for (let page = 0; page < MAX_CAMPAIGN_PAGES; page++) {
    const res = await graphRequest<{ data?: Record<string, unknown>[]; paging?: { cursors?: { after?: string } } }>({
      path: `/${accountId}/insights`,
      token,
      query: {
        level: 'campaign',
        fields: ['campaign_id', 'campaign_name', ...METRIC_FIELDS].join(','),
        limit: CAMPAIGN_PAGE_SIZE,
        after,
        ...rangeParams,
      },
      timeoutMs: 15000,
    })
    if ('error' in res) return fail(res.error, 'campaign insights')
    const batch = res.data.data ?? []
    campaignRows.push(...batch)
    after = res.data.paging?.cursors?.after
    if (!after || batch.length < CAMPAIGN_PAGE_SIZE) break
  }

  const totalRow = (totals.data.data ?? [])[0]
  const rows = campaignRows
    .filter((r) => typeof r.campaign_id === 'string')
    .map((r) => ({ campaignId: r.campaign_id as string, campaignName: String(r.campaign_name ?? r.campaign_id), ...metricsOf(r) }))
    .sort((a, b) => (b.spend ?? -1) - (a.spend ?? -1))

  return { ok: true, value: { totals: totalRow ? metricsOf(totalRow) : null, campaigns: rows } }
}
