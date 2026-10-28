import { formatRoundCurrency } from '@/lib/funcs'
import { dayLabels, formatDuration, percentDelta, type DashboardStats } from '@/lib/dashboard/stats'
import KpiCard from './KpiCard'
import RangeTabs from './RangeTabs'
import LeadsTrendChart from './LeadsTrendChart'
import SourceDonut from './SourceDonut'
import AnalyticsUnavailable from './AnalyticsUnavailable'

// KPI row + charts row (async RSC). Streams in after the brief; the page shows a
// matching skeleton meanwhile. A card with nothing true to say is omitted.
export default async function AnalyticsOverview({ stats: statsPromise }: { stats: Promise<DashboardStats | null> }) {
  const stats = await statsPromise
  if (!stats) return <AnalyticsUnavailable />
  const { range, days, newLeads, replied, responseMinutes: rt, revenue, sources } = stats

  const kpis = [
    <KpiCard
      key='new'
      label='לידים חדשים'
      value={String(newLeads.total)}
      sub={`ב־${range} הימים האחרונים`}
      delta={percentDelta(newLeads.total, newLeads.prevTotal)}
      spark={days.map((d) => d.newLeads)}
      color='var(--color-primary)'
    />,
    (replied.total > 0 || replied.prevTotal > 0) && (
      <KpiCard
        key='replied'
        label='לידים שנענו'
        value={String(replied.total)}
        sub='מענה ב־WhatsApp ו־Messenger'
        delta={percentDelta(replied.total, replied.prevTotal)}
        spark={days.map((d) => d.replied)}
        color='var(--color-success)'
      />
    ),
    rt.avg != null && (
      <KpiCard
        key='response'
        label='זמן תגובה ממוצע'
        value={formatDuration(rt.avg)}
        sub='עד מענה ראשון ב־WhatsApp'
        delta={percentDelta(rt.avg, rt.prevAvg)}
        upIsGood={false}
        spark={rt.daily}
        color='var(--color-solid-green)'
      />
    ),
    revenue && (
      <KpiCard
        key='revenue'
        label={`הכנסות ב־${range} ימים`}
        value={String(formatRoundCurrency(revenue.total))}
        sub={revenue.deals === 1 ? 'עסקה אחת שולמה' : `${revenue.deals} עסקאות שולמו`}
        delta={percentDelta(revenue.total, revenue.prevTotal)}
        spark={revenue.daily}
        color='var(--color-ink)'
      />
    ),
  ].filter(Boolean)

  const points = days.map((d) => ({ newLeads: d.newLeads, replied: d.replied, ...dayLabels(d.day) }))
  const hasTrend = days.some((d) => d.newLeads > 0 || d.replied > 0)
  // An all-zero series says nothing (CLAUDE.md §11): no line, no legend entry.
  const hasReplies = days.some((d) => d.replied > 0)

  // Even rows at every width: 4 → 2×2 below xl, one row above; never a 3 + 1
  // orphan. Fewer cards keep their normal width instead of stretching.
  const cols = kpis.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2 xl:grid-cols-4'

  return (
    <>
      <section aria-label='מדדים' className={`grid grid-cols-1 gap-4 ${cols}`}>
        {kpis}
      </section>

      <div className='flex flex-wrap items-start gap-5'>
        <section className='min-w-0 flex-[2_1_560px] rounded-2xl border border-border bg-surface px-[22px] py-5'>
          <div className='mb-3.5 flex flex-wrap items-center justify-between gap-3'>
            <div>
              <h2 className='text-lg font-bold text-ink'>לידים נכנסים מול נענו</h2>
              <div className='mt-1.5 flex flex-wrap gap-4 text-[13px] text-gray-600'>
                <span className='flex items-center gap-1.5'>
                  <span aria-hidden className='size-2.5 rounded-[3px] bg-primary' />
                  לידים חדשים
                </span>
                {hasReplies && (
                  <span className='flex items-center gap-1.5'>
                    <span aria-hidden className='h-[3px] w-3.5 rounded-sm bg-success' />
                    נענו (WhatsApp / Messenger)
                  </span>
                )}
              </div>
            </div>
            <RangeTabs range={range} />
          </div>
          {hasTrend ? (
            <LeadsTrendChart points={points} showReplied={hasReplies} />
          ) : (
            <p className='flex h-48 items-center justify-center rounded-xl bg-bg text-sm text-gray-500'>
              אין לידים חדשים בתקופה הזו
            </p>
          )}
        </section>

        {sources.length > 0 && (
          <section className='min-w-0 flex-[1_1_300px] rounded-2xl border border-border bg-surface px-[22px] py-5'>
            <h2 className='mb-4 text-lg font-bold text-ink'>מקורות לידים</h2>
            <SourceDonut slices={sources} />
          </section>
        )}
      </div>
    </>
  )
}
