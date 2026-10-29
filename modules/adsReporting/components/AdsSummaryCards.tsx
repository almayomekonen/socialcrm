import Icon from '@/lib/Icon'
import { costPer, returnOnAdSpend, type AdsMetrics } from '@/lib/facebook/ads/metrics'
import { relativeChange } from '@/lib/facebook/ads/periods'
import { formatAdsChange, formatAdsCount, formatAdsMoney, formatAdsPercent, formatAdsRatio, formatAdsRoas } from '@/lib/facebook/ads/format'
import type { AdsCampaignRow } from '@/lib/facebook/ads/report'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { Translator } from '@/lib/i18n/translate'

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

function StatBox({ box, compare, t }: { box: Box; compare: boolean; t: Translator }) {
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
            t('performance.ads.summary.fromZero')
          ) : box.change ? (
            <>
              <span dir='ltr'>{box.change}</span> {t('performance.ads.summary.vsPrevious')}
            </>
          ) : (
            t('performance.ads.summary.noCompare')
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
  locale = 'he',
}: {
  totals: AdsMetrics
  /** Previous period totals; null when Meta returned no delivery then; undefined when not compared. */
  previous: AdsMetrics | null | undefined
  campaigns: AdsCampaignRow[]
  currency: string | null
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
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
    { title: t('performance.ads.summary.spend'), value: formatAdsMoney(totals.spend, currency), change: change((m) => m.spend), strong: true },
    ...(showLeads
      ? [{ title: t('performance.ads.summary.leads'), value: formatAdsCount(totals.leads), hint: t('performance.ads.summary.costPerLead', { value: formatAdsMoney(costPerLead, currency) }), change: change((m) => m.leads) }]
      : []),
    ...(showPurchases
      ? [
          {
            title: t('performance.ads.summary.purchases'),
            value: formatAdsCount(totals.purchases),
            hint: t('performance.ads.summary.purchaseHint', {
              value: formatAdsMoney(totals.purchaseValue, currency),
              roas: formatAdsRoas(returnOnAdSpend(totals.purchaseValue, totals.spend)),
            }),
            change: change((m) => m.purchases),
          },
        ]
      : []),
    { title: t('performance.ads.summary.linkClicks'), value: formatAdsCount(totals.linkClicks), hint: t('performance.ads.summary.linkCpc', { value: formatAdsMoney(totals.linkCpc, currency) }), change: change((m) => m.linkClicks) },
    { title: t('performance.ads.summary.linkCtr'), value: formatAdsPercent(totals.linkCtr), change: change((m) => m.linkCtr) },
  ]
  const delivery: Box[] = [
    { title: t('performance.ads.summary.impressions'), value: formatAdsCount(totals.impressions), change: change((m) => m.impressions) },
    { title: t('performance.ads.summary.reach'), value: formatAdsCount(totals.reach), change: change((m) => m.reach) },
    { title: t('performance.ads.summary.frequency'), value: formatAdsRatio(totals.frequency), hint: t('performance.ads.summary.frequencyHint'), change: change((m) => m.frequency) },
  ]
  const more: Box[] = [
    { title: t('performance.ads.summary.clicks'), value: formatAdsCount(totals.clicks), hint: t('performance.ads.summary.clicksHint') },
    { title: t('performance.ads.summary.ctr'), value: formatAdsPercent(totals.ctr) },
    { title: t('performance.ads.summary.cpc'), value: formatAdsMoney(totals.cpc, currency) },
    { title: t('performance.ads.summary.cpm'), value: formatAdsMoney(totals.cpm, currency) },
    ...((totals.messagingConversations ?? 0) > 0 ? [{ title: t('performance.ads.summary.conversations'), value: formatAdsCount(totals.messagingConversations) }] : []),
  ]

  return (
    <section aria-label={t('performance.ads.summary.label')} className='grid gap-4'>
      <div className='flex flex-wrap gap-4 min-w-0 mobile:grid grid-cols-2'>
        {primary.map((b) => (
          <StatBox key={b.title} box={b} compare={compare} t={t} />
        ))}
      </div>
      <div className='flex flex-wrap gap-4 min-w-0 mobile:grid grid-cols-2'>
        {delivery.map((b) => (
          <StatBox key={b.title} box={b} compare={compare} t={t} />
        ))}
      </div>
      <details className='group/more'>
        <summary className='flex w-fit cursor-pointer list-none items-center gap-1.5 text-sm text-solid [&::-webkit-details-marker]:hidden'>
          <Icon name='chevron-down' type='reg' className='size-3 bg-solid transition-transform duration-200 group-open/more:rotate-180' />
          {t('performance.ads.summary.more')}
        </summary>
        <div className='mt-3 flex flex-wrap gap-4 min-w-0 mobile:grid grid-cols-2'>
          {more.map((b) => (
            <StatBox key={b.title} box={b} compare={false} t={t} />
          ))}
        </div>
      </details>
    </section>
  )
}
