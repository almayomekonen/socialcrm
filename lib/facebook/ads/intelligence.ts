import { listAttributedLeads } from '@/db/adsCrmOutcomes'
import { groupOutcomes, type CrmOutcome, type CrmOutcomeGroup } from '@/lib/facebook/ads/crmOutcomes'
import { adsSignals } from '@/lib/facebook/ads/signals'
import { getTopAds } from '@/lib/facebook/ads/topAds'
import { getAdCreatives } from '@/lib/facebook/ads/creatives'
import { cachedAdsRead, reportTtlMs } from '@/lib/facebook/ads/cached'
import type { AdsRange } from '@/lib/facebook/ads/dateRange'
import type { AdsReport } from '@/lib/facebook/ads/report'
import type { AdsBreakdown } from '@/lib/facebook/ads/breakdown'
import type { DayRange } from '@/lib/facebook/ads/periods'
import type { AdsTopAd } from '@/lib/facebook/ads/topAds'
import type { AdCreative } from '@/lib/facebook/ads/creatives'
import type { AdsSignal } from '@/lib/facebook/ads/signals'

/**
 * Server-side assembly of the Meta ↔ SocialCRM sections. Called only after the
 * page verified `accountId` for this connection's token.
 *
 * The CRM side reads attributed leads for the SAME period Meta resolved for the
 * report (its `date_start`/`date_stop`, in the account's timezone). Context is
 * best-effort: a failure here leaves the Meta report intact and simply omits
 * the extra sections — never shown as zeros.
 */

export type AdsIntelligenceData = {
  outcomes: { campaign: Record<string, CrmOutcome>; adset: Record<string, CrmOutcome>; ad: Record<string, CrmOutcome> }
  signals: AdsSignal[]
  topAds: AdsTopAd[] | null
  creatives: Record<string, AdCreative>
  /** When the Meta numbers on screen were fetched; `stale` = Meta failed and this is the last good answer. */
  freshness: { fetchedAt: string; stale: boolean } | null
  /** Attributed SocialCRM leads in the period whose campaign is not in this report (e.g. another ad account). */
  outsideReport: number
}

const toRecord = (groups: Map<string, CrmOutcomeGroup>): Record<string, CrmOutcome> =>
  Object.fromEntries([...groups].map(([id, g]) => [id, g.outcome]))

export async function loadAdsIntelligence(input: {
  agencyId: number
  accountId: string
  token: string
  range: AdsRange
  rangeKey: string
  report: AdsReport
  breakdown: AdsBreakdown | null
  timezone: string | null
  currency: string | null
  freshness: { fetchedAt: string; stale: boolean } | null
  now?: Date
}): Promise<AdsIntelligenceData | null> {
  if (!input.report.period) return null
  const now = input.now ?? new Date()
  try {
    const leads = await listAttributedLeads(input.agencyId, input.report.period, input.timezone)
    const byCampaign = groupOutcomes(leads, 'campaign', now)
    const inReport = new Set(input.report.campaigns.map((c) => c.id))
    const outsideReport = leads.filter((l) => l.campaignId && !inReport.has(l.campaignId)).length

    // Top ads only on the account overview; the drill-down has its own rows.
    const top =
      input.breakdown === null && !input.freshness?.stale
        ? await cachedAdsRead(
            { agencyId: input.agencyId, accountId: input.accountId, kind: 'top_ads' },
            input.rangeKey,
            reportTtlMs(input.rangeKey),
            () => getTopAds(input.token, input.accountId, input.range),
          )
        : null
    const topAds = top && 'value' in top ? top.value.value : null

    const adIds = [
      ...(topAds ?? []).map((a) => a.id),
      ...(input.breakdown?.level === 'ad' ? input.breakdown.rows.map((r) => r.id) : []),
    ]
    const creatives = input.freshness?.stale
      ? new Map()
      : await getAdCreatives({ agencyId: input.agencyId, accountId: input.accountId }, input.token, adIds, now)

    const signals = adsSignals(
      input.report.campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        spend: c.metrics.spend,
        metaLeads: c.metrics.leads,
        // Only a campaign whose result IS leads can meaningfully have "no leads".
        leadObjective: c.result.kind === 'leads',
        crm: byCampaign.get(c.id)?.outcome,
      })),
      input.currency,
    )

    return {
      outcomes: {
        campaign: toRecord(byCampaign),
        adset: toRecord(groupOutcomes(leads, 'adset', now)),
        ad: toRecord(groupOutcomes(leads, 'ad', now)),
      },
      signals,
      topAds,
      creatives: Object.fromEntries(creatives),
      freshness: input.freshness,
      outsideReport,
    }
  } catch (err) {
    console.warn('[AdsReporting] SocialCRM context unavailable:', err instanceof Error ? err.message : 'unknown')
    return null
  }
}

/**
 * Before an ad account is connected: attributed SocialCRM leads per campaign,
 * from what Meta put on each lead. Business timezone; explicit days.
 */
export async function loadCrmOnlyCampaigns(
  agencyId: number,
  period: DayRange,
  now: Date = new Date(),
): Promise<CrmOutcomeGroup[]> {
  try {
    const leads = await listAttributedLeads(agencyId, period, 'Asia/Jerusalem')
    return [...groupOutcomes(leads, 'campaign', now).values()].sort((a, b) => b.outcome.captured - a.outcome.captured)
  } catch (err) {
    console.warn('[AdsReporting] SocialCRM-only view unavailable:', err instanceof Error ? err.message : 'unknown')
    return []
  }
}
