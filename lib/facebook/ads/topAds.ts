import { insightsRangeParams, type AdsRange } from '@/lib/facebook/ads/dateRange'
import { metricsOf, ROW_FIELDS, type AdsMetrics } from '@/lib/facebook/ads/metrics'
import { rowResult, type RowResult } from '@/lib/facebook/ads/results'
import { readInsights, type AdsResult } from '@/lib/facebook/ads/insights'

/**
 * The account's ads with the most spend in the range — so the report can show
 * the actual advertisements, not only campaign names. One insights read at
 * level=ad on the VERIFIED account, sorted by spend (Insights `sort`), capped.
 */

export const TOP_ADS_LIMIT = 12

export type AdsTopAd = {
  id: string
  name: string
  campaignId: string | null
  campaignName: string | null
  adsetId: string | null
  adsetName: string | null
  metrics: AdsMetrics
  result: RowResult
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

/** Insights rows → ads, keeping only rows that carry an ad id. Pure. */
export function topAdsOf(rows: Record<string, unknown>[], limit = TOP_ADS_LIMIT): AdsTopAd[] {
  return rows
    .filter((r) => typeof r.ad_id === 'string')
    .map((r) => {
      const metrics = metricsOf(r)
      const id = r.ad_id as string
      return {
        id,
        name: str(r.ad_name) ?? id,
        campaignId: str(r.campaign_id),
        campaignName: str(r.campaign_name),
        adsetId: str(r.adset_id),
        adsetName: str(r.adset_name),
        metrics,
        result: rowResult(str(r.objective), metrics),
      }
    })
    .sort((a, b) => (b.metrics.spend ?? -1) - (a.metrics.spend ?? -1))
    .slice(0, limit)
}

export async function getTopAds(token: string, accountId: string, range: AdsRange): Promise<AdsResult<AdsTopAd[]>> {
  const res = await readInsights(
    token,
    accountId,
    {
      level: 'ad',
      fields: `ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,objective,${ROW_FIELDS.join(',')}`,
      sort: '["spend_descending"]',
      limit: TOP_ADS_LIMIT,
      ...insightsRangeParams(range),
    },
    { maxPages: 1, what: 'top ads' },
  )
  if ('reason' in res) return { ok: false, reason: res.reason }
  return { ok: true, value: topAdsOf(res.value) }
}
