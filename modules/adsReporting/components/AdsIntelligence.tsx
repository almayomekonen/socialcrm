import type { AdsCampaignRow } from '@/lib/facebook/ads/report'
import type { AdsBreakdown } from '@/lib/facebook/ads/breakdown'
import type { AdsResult } from '@/lib/facebook/ads/insights'
import type { AdsIntelligenceData } from '@/lib/facebook/ads/intelligence'
import { formatBusinessDateTime } from '@/lib/today/time'
import AdsSignals from './AdsSignals'
import AdsCampaignCards from './AdsCampaignCards'
import AdsCreativeGrid from './AdsCreativeGrid'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { formatLeadDateTime } from '@/lib/leads/leadDate'

/**
 * The part of the report that connects Meta to SocialCRM: factual signals,
 * campaign (or ad set) cards with both kinds of number, and the ads themselves.
 * Everything here is data the page already loaded — nothing calls Meta.
 */

export default function AdsIntelligence({
  data,
  campaigns,
  breakdown,
  currency,
  locale = 'he',
}: {
  data: AdsIntelligenceData
  campaigns: AdsCampaignRow[]
  breakdown: AdsResult<AdsBreakdown> | null
  currency: string | null
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  // Hebrew keeps its business-time format; other languages word it in BUSINESS_TZ too.
  const when = (at: string) => (locale === 'he' ? formatBusinessDateTime(at) : formatLeadDateTime(locale, at))
  const drilled = breakdown && 'value' in breakdown ? breakdown.value : null
  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
      {data.freshness?.stale && (
        <p role='status' className='rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700'>
          {t('performance.adsIntel.stale', { time: when(data.freshness.fetchedAt) })}
        </p>
      )}

      <AdsSignals signals={data.signals} locale={locale} />

      {breakdown === null && (
        <>
          <AdsCampaignCards
            title={t('performance.adsIntel.byCampaign')}
            rows={campaigns.map((c) => ({
              id: c.id,
              name: c.name,
              status: c.status,
              objective: c.objective,
              spend: c.metrics.spend,
              result: c.result,
            }))}
            outcomes={data.outcomes.campaign}
            currency={currency}
            emptyText={t('performance.ads.table.noCampaigns')}
            drill={{ label: t('performance.adsIntel.campaignAdsets'), to: (row) => ({ campaign: row.id }) }}
            locale={locale}
          />
          {data.outsideReport > 0 && (
            <p className='text-xs text-gray-500'>
              {t('performance.adsIntel.outside', { count: String(data.outsideReport) })}
            </p>
          )}
          {data.topAds && (
            <AdsCreativeGrid
              title={t('performance.adsIntel.topAds')}
              hint={t('performance.adsIntel.topAdsHint')}
              rows={data.topAds.map((a) => ({
                id: a.id,
                name: a.name,
                campaignName: a.campaignName,
                spend: a.metrics.spend,
                result: a.result,
              }))}
              creatives={data.creatives}
              outcomes={data.outcomes.ad}
              currency={currency}
              videoPreview
              locale={locale}
            />
          )}
        </>
      )}

      {drilled?.level === 'adset' && (
        <AdsCampaignCards
          title={t('performance.adsIntel.byAdset')}
          rows={drilled.rows.map((r) => ({ id: r.id, name: r.name, status: r.status, spend: r.metrics.spend, result: r.result }))}
          outcomes={data.outcomes.adset}
          currency={currency}
          emptyText={t('performance.ads.table.noLevel')}
          drill={{ label: t('performance.adsIntel.adsetAds'), to: (row) => ({ adset: row.id }) }}
          locale={locale}
        />
      )}

      {drilled?.level === 'ad' && (
        <AdsCreativeGrid
          title={t('performance.adsIntel.adsOfAdset')}
          rows={drilled.rows.map((r) => ({ id: r.id, name: r.name, spend: r.metrics.spend, result: r.result }))}
          creatives={data.creatives}
          outcomes={data.outcomes.ad}
          currency={currency}
          locale={locale}
        />
      )}
    </div>
  )
}
