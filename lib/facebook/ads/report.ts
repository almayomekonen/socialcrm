import { insightsRangeParams, type AdsRange } from '@/lib/facebook/ads/dateRange'
import { actionMap, LEAD_TYPE, metricsOf, ROW_FIELDS, toNumber, type AdsMetrics } from '@/lib/facebook/ads/metrics'
import { dayCount, previousEquivalentRange, type DayRange } from '@/lib/facebook/ads/periods'
import { rowResult, type RowResult } from '@/lib/facebook/ads/results'
import { readInsights, readStatuses, type AdsResult } from '@/lib/facebook/ads/insights'

/**
 * The account report for one date range:
 *   totals (level=account)                 — Meta's deduplicated account numbers
 *   the previous equivalent period         — same length, immediately before
 *   a daily trend (time_increment=1)       — ranges up to DAILY_MAX_DAYS
 *   campaigns (level=campaign) + status    — objective-based results per row
 *
 * The totals and campaigns ARE the report: if either fails, the report fails.
 * The comparison, the trend and delivery status are context: a failure there is
 * flagged as unavailable and never shown as zero.
 */

export const DAILY_MAX_DAYS = 92
const MAX_CAMPAIGN_PAGES = 5

export type AdsCampaignRow = {
  id: string
  name: string
  objective: string | null
  status: string | null
  metrics: AdsMetrics
  result: RowResult
}

export type AdsTrendDay = {
  date: string
  spend: number | null
  impressions: number | null
  linkClicks: number | null
  leads: number | null
}

export type AdsReport = {
  /** Meta's own resolution of the range, in the account's timezone. */
  period: DayRange | null
  /** Null when Meta returned no rows: no delivery in this range (not "never advertised"). */
  totals: AdsMetrics | null
  /**
   * 'partial': the period includes today, which has not ended — comparing a few
   * hours with a full previous day would read as a false drop, so no comparison.
   */
  previous: { period: DayRange; totals: AdsMetrics | null } | 'unavailable' | 'partial' | null
  daily: AdsTrendDay[] | 'too_long' | 'unavailable'
  campaigns: AdsCampaignRow[]
  statusesAvailable: boolean
  /** Meta refused the full field set and the report fell back to the basic one; some metrics show "—". */
  reducedFields: boolean
}

/** The field set the report shipped with before reach/link clicks/actions were added. */
const BASIC_FIELDS = 'spend,impressions,clicks,ctr,cpc'

function periodOf(row: Record<string, unknown> | undefined): DayRange | null {
  const since = row?.date_start
  const until = row?.date_stop
  return typeof since === 'string' && typeof until === 'string' && dayCount({ since, until }) !== null ? { since, until } : null
}

export async function getAdsReport(
  token: string,
  accountId: string,
  range: AdsRange,
  opts: { today?: string } = {},
): Promise<AdsResult<AdsReport>> {
  const rangeParams = insightsRangeParams(range)
  let fields = ROW_FIELDS.join(',')
  let reducedFields = false

  let totalsRes = await readInsights(
    token,
    accountId,
    { level: 'account', fields: `${fields},date_start,date_stop`, ...rangeParams },
    { what: 'account insights' },
  )
  // The same ladder lead attribution uses: if Meta refuses the wider field set,
  // the report that already worked must still load — with the extra metrics "—".
  if ('reason' in totalsRes && totalsRes.reason === 'meta_error') {
    fields = BASIC_FIELDS
    reducedFields = true
    totalsRes = await readInsights(token, accountId, { level: 'account', fields: `${fields},date_start,date_stop`, ...rangeParams }, { what: 'account insights (basic fields)' })
  }
  if ('reason' in totalsRes) return { ok: false, reason: totalsRes.reason }
  const totalRow = totalsRes.value[0]
  if (!totalRow) {
    return { ok: true, value: { period: null, totals: null, previous: null, daily: [], campaigns: [], statusesAvailable: true, reducedFields } }
  }
  const period = periodOf(totalRow)
  const includesToday = Boolean(period && opts.today && period.until >= opts.today)
  const previousRange = period && !includesToday ? previousEquivalentRange(period) : null
  const days = period ? dayCount(period) : null

  const [campaignsRes, previousRes, dailyRes] = await Promise.all([
    readInsights(
      token,
      accountId,
      { level: 'campaign', fields: `campaign_id,campaign_name,${reducedFields ? '' : 'objective,'}${fields}`, ...rangeParams },
      { maxPages: MAX_CAMPAIGN_PAGES, what: 'campaign insights' },
    ),
    previousRange
      ? readInsights(token, accountId, { level: 'account', fields, time_range: JSON.stringify(previousRange) }, { what: 'previous period' })
      : Promise.resolve(null),
    days !== null && days <= DAILY_MAX_DAYS && !reducedFields
      ? readInsights(
          token,
          accountId,
          { level: 'account', fields: 'date_start,spend,impressions,inline_link_clicks,actions', time_increment: 1, ...rangeParams },
          { maxPages: 2, what: 'daily trend' },
        )
      : Promise.resolve(null),
  ])
  if ('reason' in campaignsRes) return { ok: false, reason: campaignsRes.reason }

  const campaignRows = campaignsRes.value.filter((r) => typeof r.campaign_id === 'string')
  const statuses = await readStatuses(
    token,
    campaignRows.map((r) => r.campaign_id as string),
  )

  const campaigns: AdsCampaignRow[] = campaignRows
    .map((r) => {
      const metrics = metricsOf(r)
      const objective = typeof r.objective === 'string' ? r.objective : null
      const id = r.campaign_id as string
      return { id, name: String(r.campaign_name ?? id), objective, status: statuses?.get(id) ?? null, metrics, result: rowResult(objective, metrics) }
    })
    .sort((a, b) => (b.metrics.spend ?? -1) - (a.metrics.spend ?? -1))

  const previous: AdsReport['previous'] = includesToday
    ? 'partial'
    : previousRange && previousRes
      ? 'value' in previousRes
        ? { period: previousRange, totals: previousRes.value[0] ? metricsOf(previousRes.value[0]) : null }
        : 'unavailable'
      : null

  const daily: AdsReport['daily'] =
    dailyRes === null
      ? days !== null && days > DAILY_MAX_DAYS
        ? 'too_long'
        : 'unavailable'
      : 'value' in dailyRes && period && !(dailyRes.value.length === 0 && (toNumber(totalRow.spend) ?? 0) > 0)
        ? dailyTrend(dailyRes.value, period)
        : 'unavailable'

  return {
    ok: true,
    value: { period, totals: metricsOf(totalRow), previous, daily, campaigns, statusesAvailable: statuses !== null, reducedFields },
  }
}

/**
 * One entry per calendar day of the period. Meta returns rows only for days with
 * delivery, so a day it did not return had no spend, impressions, clicks or leads
 * — that zero is what the API means, not a fill-in guess.
 */
export function dailyTrend(rows: Record<string, unknown>[], period: DayRange): AdsTrendDay[] {
  const byDate = new Map<string, AdsTrendDay>()
  for (const d of rows) {
    if (typeof d.date_start !== 'string') continue
    const impressions = toNumber(d.impressions)
    const delivered = impressions !== null && impressions > 0
    const actions = actionMap(d.actions)
    // Within the trend a missing number on a delivered day reads like a missing day: none of it.
    const orZero = (v: number | null) => (v === null && delivered ? 0 : v)
    byDate.set(d.date_start, {
      date: d.date_start,
      spend: toNumber(d.spend),
      impressions,
      linkClicks: orZero(toNumber(d.inline_link_clicks)),
      leads: actions.has(LEAD_TYPE) ? actions.get(LEAD_TYPE)! : orZero(null),
    })
  }
  const days: AdsTrendDay[] = []
  const stop = Date.parse(`${period.until}T00:00:00Z`)
  for (let t = Date.parse(`${period.since}T00:00:00Z`); t <= stop; t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10)
    days.push(byDate.get(date) ?? { date, spend: 0, impressions: 0, linkClicks: 0, leads: 0 })
  }
  return days
}
