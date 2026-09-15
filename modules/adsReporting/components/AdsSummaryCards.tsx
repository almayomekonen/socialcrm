import Icon from '@/lib/Icon'
import { costPer, returnOnAdSpend, type AdsMetrics } from '@/lib/facebook/ads/metrics'
import { relativeChange } from '@/lib/facebook/ads/periods'
import { formatAdsChange, formatAdsCount, formatAdsMoney, formatAdsPercent, formatAdsRatio, formatAdsRoas } from '@/lib/facebook/ads/format'
import type { AdsCampaignRow } from '@/lib/facebook/ads/report'

/**
 * The account summary a business owner reads first: what was spent and what it
 * brought. Existing `num-box` stat pattern from ביצועים.
 *
 *  · Leads and purchases appear only when the account has them or runs campaigns
 *    for them — never an always-empty box.
 *  · Cost per lead is over LEAD campaigns only (spend on awareness would inflate
 *    it); lead counts are additive across campaigns because each lead is
 *    attributed to one ad. ROAS is purchase value ÷ the whole account spend.
 *  · Link clicks and all clicks are labelled apart; all-clicks rates are secondary.
 *  · The comparison is neutral (no good/bad colouring): the same metric for the
 *    previous period of equal length, as Meta returned it.
 */

type Box = { title: string; value: string; hint?: string; change?: string | null; strong?: boolean }

/** The previous period had exactly 0 of this — a percentage of nothing is not a number, so say so. */
const FROM_ZERO = 'from-zero'

function StatBox({ box, compare }: { box: Box; compare: boolean }) {
  return (
    <div className={`num-box grid gap-1 px-6 py-5 ${box.strong ? 'bg-softy border-soft text-solid font-bold' : ''}`}>
      <span>{box.title}</span>
      <div className='flex justify-between *:text-3xl'>
        <h2 dir='ltr'>{box.value}</h2>
      </div>
      {box.hint && <span className='text-xs font-normal text-gray-600'>{box.hint}</span>}
      {compare && (
        <span className='text-xs font-normal text-gray-500'>
          {box.change === FROM_ZERO ? (
            '0 בתקופה הקודמת'
          ) : box.change ? (
            <>
              <span dir='ltr'>{box.change}</span> לעומת התקופה הקודמת
            </>
          ) : (
            'אין נתון להשוואה'
          )}
        </span>
      )}
    </div>
  )
}

function sum(rows: AdsCampaignRow[], pick: (r: AdsCampaignRow) => number | null): number | null {
  let total = 0
  let any = false
  for (const r of rows) {
    const v = pick(r)
    if (v !== null && v !== undefined) {
      total += v
      any = true
    }
  }
  return any ? total : null
}

export default function AdsSummaryCards({
  totals,
  previous,
  campaigns,
  currency,
}: {
  totals: AdsMetrics
  /** Previous period totals; null when Meta returned no delivery then; undefined when not compared. */
  previous: AdsMetrics | null | undefined
  campaigns: AdsCampaignRow[]
  currency: string | null
}) {
  const compare = previous !== undefined
  const change = (pick: (m: AdsMetrics) => number | null) => {
    if (!previous) return null
    const before = pick(previous)
    if (before === 0 && pick(totals) !== null) return FROM_ZERO
    return formatAdsChange(relativeChange(pick(totals), before))
  }

  const leadCampaigns = campaigns.filter((c) => c.result.kind === 'leads')
  const showLeads = (totals.leads ?? 0) > 0 || leadCampaigns.length > 0
  const showPurchases = (totals.purchases ?? 0) > 0 || (totals.purchaseValue ?? 0) > 0 || campaigns.some((c) => c.result.kind === 'purchases')
  const costPerLead = costPer(
    sum(leadCampaigns, (c) => c.metrics.spend),
    sum(leadCampaigns, (c) => c.metrics.leads),
  )

  const primary: Box[] = [
    { title: 'הוצאה', value: formatAdsMoney(totals.spend, currency), change: change((m) => m.spend), strong: true },
    ...(showLeads
      ? [{ title: 'לידים (לפי Meta)', value: formatAdsCount(totals.leads), hint: `עלות לליד בקמפייני לידים: ${formatAdsMoney(costPerLead, currency)}`, change: change((m) => m.leads) }]
      : []),
    ...(showPurchases
      ? [
          {
            title: 'רכישות (לפי Meta)',
            value: formatAdsCount(totals.purchases),
            hint: `ערך: ${formatAdsMoney(totals.purchaseValue, currency)} · החזר על ההוצאה (ROAS): ${formatAdsRoas(returnOnAdSpend(totals.purchaseValue, totals.spend))}`,
            change: change((m) => m.purchases),
          },
        ]
      : []),
    { title: 'קליקים על קישור', value: formatAdsCount(totals.linkClicks), hint: `עלות לקליק על קישור: ${formatAdsMoney(totals.linkCpc, currency)}`, change: change((m) => m.linkClicks) },
    { title: 'אחוז הקלקה על קישור', value: formatAdsPercent(totals.linkCtr), change: change((m) => m.linkCtr) },
  ]
  const delivery: Box[] = [
    { title: 'חשיפות', value: formatAdsCount(totals.impressions), change: change((m) => m.impressions) },
    { title: 'אנשים שנחשפו', value: formatAdsCount(totals.reach), change: change((m) => m.reach) },
    { title: 'תדירות', value: formatAdsRatio(totals.frequency), hint: 'ממוצע חשיפות לאדם', change: change((m) => m.frequency) },
  ]
  const more: Box[] = [
    { title: 'כל הקליקים', value: formatAdsCount(totals.clicks), hint: 'כל קליק על המודעה, כולל לייקים והרחבה' },
    { title: 'אחוז הקלקה (כל הקליקים)', value: formatAdsPercent(totals.ctr) },
    { title: 'עלות לקליק (כל הקליקים)', value: formatAdsMoney(totals.cpc, currency) },
    { title: 'עלות ל-1,000 חשיפות', value: formatAdsMoney(totals.cpm, currency) },
    ...((totals.messagingConversations ?? 0) > 0 ? [{ title: 'שיחות שהתחילו', value: formatAdsCount(totals.messagingConversations) }] : []),
  ]

  return (
    <section aria-label='סיכום החשבון' className='grid gap-4'>
      <div className='flex flex-wrap gap-4 min-w-0 mobile:grid grid-cols-2'>
        {primary.map((b) => (
          <StatBox key={b.title} box={b} compare={compare} />
        ))}
      </div>
      <div className='flex flex-wrap gap-4 min-w-0 mobile:grid grid-cols-2'>
        {delivery.map((b) => (
          <StatBox key={b.title} box={b} compare={compare} />
        ))}
      </div>
      <details className='group/more'>
        <summary className='flex w-fit cursor-pointer list-none items-center gap-1.5 text-sm text-solid [&::-webkit-details-marker]:hidden'>
          <Icon name='chevron-down' type='reg' className='size-3 bg-solid transition-transform duration-200 group-open/more:rotate-180' />
          מדדים נוספים
        </summary>
        <div className='mt-3 flex flex-wrap gap-4 min-w-0 mobile:grid grid-cols-2'>
          {more.map((b) => (
            <StatBox key={b.title} box={b} compare={false} />
          ))}
        </div>
      </details>
    </section>
  )
}
