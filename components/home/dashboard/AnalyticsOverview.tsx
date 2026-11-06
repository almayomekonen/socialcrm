import { formatRoundCurrency } from '@/lib/funcs'
import { dayLabels, formatDuration, percentDelta, type DashboardStats } from '@/lib/dashboard/stats'
import KpiCard from './KpiCard'
import RangeTabs from './RangeTabs'
import LeadsTrendChart from './LeadsTrendChart'
import SourceDonut from './SourceDonut'
import AnalyticsUnavailable from './AnalyticsUnavailable'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from './card'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

// KPI row + charts row (async RSC). Streams in after the brief; the page shows a
// matching skeleton meanwhile. A card with nothing true to say is omitted.
export default async function AnalyticsOverview({
  stats: statsPromise,
  locale = 'he',
}: {
  stats: Promise<DashboardStats | null>
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  const stats = await statsPromise
  if (!stats) return <AnalyticsUnavailable locale={locale} />
  const { range, days, newLeads, replied, responseMinutes: rt, revenue, sources } = stats

  const kpis = [
    <KpiCard
      key='new'
      label={t('today.analytics.newLeads')}
      value={String(newLeads.total)}
      sub={t('today.analytics.newLeadsSub', { range })}
      delta={percentDelta(newLeads.total, newLeads.prevTotal)}
      spark={days.map((d) => d.newLeads)}
      color='var(--color-primary)'
      locale={locale}
    />,
    (replied.total > 0 || replied.prevTotal > 0) && (
      <KpiCard
        key='replied'
        label={t('today.analytics.replied')}
        value={String(replied.total)}
        sub={t('today.analytics.repliedSub')}
        delta={percentDelta(replied.total, replied.prevTotal)}
        spark={days.map((d) => d.replied)}
        color='var(--color-success)'
        locale={locale}
      />
    ),
    rt.avg != null && (
      <KpiCard
        key='response'
        label={t('today.analytics.responseTime')}
        value={formatDuration(rt.avg)}
        sub={t('today.analytics.responseTimeSub')}
        delta={percentDelta(rt.avg, rt.prevAvg)}
        upIsGood={false}
        spark={rt.daily}
        color='var(--color-solid-green)'
        locale={locale}
      />
    ),
    revenue && (
      <KpiCard
        key='revenue'
        label={t('today.analytics.revenue', { range })}
        // Deals carry no currency of their own (claude/i18n.md "Formatting
        // sources"), so revenue keeps the existing ILS formatter in every locale.
        value={String(formatRoundCurrency(revenue.total))}
        sub={t('today.analytics.revenueDeals', { count: revenue.deals })}
        delta={percentDelta(revenue.total, revenue.prevTotal)}
        spark={revenue.daily}
        color='var(--color-ink)'
        locale={locale}
      />
    ),
  ].filter(Boolean)

  const points = days.map((d) => ({ newLeads: d.newLeads, replied: d.replied, ...dayLabels(d.day, locale) }))
  const hasTrend = days.some((d) => d.newLeads > 0 || d.replied > 0)
  // An all-zero series says nothing (CLAUDE.md §11): no area, no legend entry.
  const hasReplies = days.some((d) => d.replied > 0)

  // Even rows at every width: 4 → 2×2 below xl, one row above; never a 3 + 1
  // orphan. Fewer cards keep their normal width instead of stretching.
  const cols = kpis.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2 xl:grid-cols-4'

  return (
    <>
      <section aria-label={t('today.analytics.kpis')} className={`grid grid-cols-1 gap-4 ${cols}`}>
        {kpis}
      </section>

      <div className='flex flex-wrap items-stretch gap-4'>
        <Card className='flex-[2_1_560px]'>
          <CardHeader>
            <CardTitle>{t('today.analytics.trendTitle')}</CardTitle>
            <CardDescription>{t('today.analytics.newLeadsSub', { range })}</CardDescription>
            <CardAction>
              <RangeTabs range={range} locale={locale} />
            </CardAction>
          </CardHeader>
          <CardContent className='flex flex-1 flex-col'>
            {hasTrend ? (
              <LeadsTrendChart points={points} showReplied={hasReplies} />
            ) : (
              <p className='flex h-48 items-center justify-center rounded-lg border border-dashed border-border bg-bg text-sm text-gray-500'>
                {t('today.analytics.trendEmpty')}
              </p>
            )}
          </CardContent>
        </Card>

        {sources.length > 0 && (
          <Card className='flex-[1_1_300px]'>
            <CardHeader>
              <CardTitle>{t('today.analytics.sourcesTitle')}</CardTitle>
              <CardDescription>{t('today.analytics.newLeadsSub', { range })}</CardDescription>
            </CardHeader>
            <CardContent>
              <SourceDonut slices={sources} />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}
