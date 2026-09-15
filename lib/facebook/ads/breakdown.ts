import { insightsRangeParams, type AdsRange } from '@/lib/facebook/ads/dateRange'
import { metricsOf, ROW_FIELDS, type AdsMetrics } from '@/lib/facebook/ads/metrics'
import { rowResult, type RowResult } from '@/lib/facebook/ads/results'
import { isAdObjectId, readInsights, readStatuses, type AdsResult } from '@/lib/facebook/ads/insights'

/**
 * Drill-down: the ad sets of one campaign, or the ads of one ad set, for the same
 * account and range. Read with `filtering` on the VERIFIED account's insights
 * edge, so an id from the URL can only narrow inside that account — an id from
 * another account returns no rows, never another account's data.
 *
 * Results use the row's own campaign objective (Meta returns `objective` on each
 * row), the same rule as the campaign table.
 */

export type AdsBreakdownLevel = 'adset' | 'ad'

export type AdsBreakdownRow = {
  id: string
  name: string
  status: string | null
  metrics: AdsMetrics
  result: RowResult
}

export type AdsBreakdown = {
  level: AdsBreakdownLevel
  campaign: { id: string; name: string | null }
  adset: { id: string; name: string | null } | null
  rows: AdsBreakdownRow[]
  statusesAvailable: boolean
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

export async function getAdsBreakdown(
  token: string,
  accountId: string,
  range: AdsRange,
  parent: { campaignId: string; adsetId?: string | null },
): Promise<AdsResult<AdsBreakdown>> {
  if (!isAdObjectId(parent.campaignId) || (parent.adsetId != null && !isAdObjectId(parent.adsetId))) {
    return { ok: false, reason: 'permission_missing' }
  }
  const level: AdsBreakdownLevel = parent.adsetId ? 'ad' : 'adset'
  const filtering = [
    { field: 'campaign.id', operator: 'EQUAL', value: parent.campaignId },
    ...(parent.adsetId ? [{ field: 'adset.id', operator: 'EQUAL', value: parent.adsetId }] : []),
  ]
  const idFields = level === 'ad' ? 'ad_id,ad_name,adset_id,adset_name' : 'adset_id,adset_name'

  const res = await readInsights(
    token,
    accountId,
    {
      level,
      fields: `${idFields},campaign_id,campaign_name,objective,${ROW_FIELDS.join(',')}`,
      filtering: JSON.stringify(filtering),
      ...insightsRangeParams(range),
    },
    { maxPages: 3, what: `${level} insights` },
  )
  if ('reason' in res) return { ok: false, reason: res.reason }

  const idKey = level === 'ad' ? 'ad_id' : 'adset_id'
  const nameKey = level === 'ad' ? 'ad_name' : 'adset_name'
  // Belt and braces: keep only rows of the requested parent.
  const raw = res.value.filter(
    (r) => r.campaign_id === parent.campaignId && (!parent.adsetId || r.adset_id === parent.adsetId) && typeof r[idKey] === 'string',
  )
  const statuses = await readStatuses(
    token,
    raw.map((r) => r[idKey] as string),
  )

  const rows = raw
    .map((r) => {
      const metrics = metricsOf(r)
      const id = r[idKey] as string
      return { id, name: str(r[nameKey]) ?? id, status: statuses?.get(id) ?? null, metrics, result: rowResult(str(r.objective), metrics) }
    })
    .sort((a, b) => (b.metrics.spend ?? -1) - (a.metrics.spend ?? -1))

  return {
    ok: true,
    value: {
      level,
      campaign: { id: parent.campaignId, name: str(raw[0]?.campaign_name) },
      adset: parent.adsetId ? { id: parent.adsetId, name: str(raw[0]?.adset_name) } : null,
      rows,
      statusesAvailable: statuses !== null,
    },
  }
}
