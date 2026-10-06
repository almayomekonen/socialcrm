import type { AdsCampaignRow } from '@/lib/facebook/ads/report'
import type { AdsBreakdown } from '@/lib/facebook/ads/breakdown'
import type { AdsResult } from '@/lib/facebook/ads/insights'
import type { AdsIntelligenceData } from '@/lib/facebook/ads/intelligence'
import { formatBusinessDateTime } from '@/lib/today/time'
import AdsSignals from './AdsSignals'
import AdsCampaignCards from './AdsCampaignCards'
import AdsCreativeGrid from './AdsCreativeGrid'

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
}: {
  data: AdsIntelligenceData
  campaigns: AdsCampaignRow[]
  breakdown: AdsResult<AdsBreakdown> | null
  currency: string | null
}) {
  const drilled = breakdown && 'value' in breakdown ? breakdown.value : null
  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
      {data.freshness?.stale && (
        <p role='status' className='rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700'>
          Meta לא זמינה כרגע. מוצגים הנתונים האחרונים שהתקבלו, מ-{formatBusinessDateTime(data.freshness.fetchedAt)}.
        </p>
      )}

      <AdsSignals signals={data.signals} />

      {breakdown === null && (
        <>
          <AdsCampaignCards
            title='Meta ו-SocialCRM לפי קמפיין'
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
            emptyText='לא נמצאו קמפיינים עם פעילות בטווח הזה.'
            drill={{ label: 'קבוצות המודעות בקמפיין', to: (row) => ({ campaign: row.id }) }}
          />
          {data.outsideReport > 0 && (
            <p className='text-xs text-gray-500'>
              עוד {data.outsideReport} לידים מ-Meta נקלטו בתקופה הזו מקמפיינים שאינם בחשבון המודעות שנבחר.
            </p>
          )}
          {data.topAds && (
            <AdsCreativeGrid
              title='המודעות עם ההוצאה הגבוהה ביותר'
              hint='עד 12 מודעות בתקופה, לפי ההוצאה ב-Meta.'
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
            />
          )}
        </>
      )}

      {drilled?.level === 'adset' && (
        <AdsCampaignCards
          title='Meta ו-SocialCRM לפי קבוצת מודעות'
          rows={drilled.rows.map((r) => ({ id: r.id, name: r.name, status: r.status, spend: r.metrics.spend, result: r.result }))}
          outcomes={data.outcomes.adset}
          currency={currency}
          emptyText='לא נמצאה פעילות ברמה הזו בטווח התאריכים שנבחר.'
          drill={{ label: 'המודעות בקבוצה', to: (row) => ({ adset: row.id }) }}
        />
      )}

      {drilled?.level === 'ad' && (
        <AdsCreativeGrid
          title='המודעות בקבוצת המודעות'
          rows={drilled.rows.map((r) => ({ id: r.id, name: r.name, spend: r.metrics.spend, result: r.result }))}
          creatives={data.creatives}
          outcomes={data.outcomes.ad}
          currency={currency}
        />
      )}
    </div>
  )
}
