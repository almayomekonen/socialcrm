'use client'

import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { useT } from '@/lib/i18n/I18nProvider'
import { dirFor } from '@/lib/i18n/config'

// New leads vs leads that got a human reply, one point per business day, as a
// shadcn gradient area chart. Time runs left → right regardless of page
// direction. Labels are precomputed on the server.
//
// Mouse: Recharts' hover tooltip. Keyboard: the chart is one focus stop; focus
// selects the latest day and ←/→ move between days, with a status readout and a
// guide line (Recharts' own keyboard layer is off so there is one focus stop).
export type TrendPoint = { newLeads: number; replied: number; short: string; long: string }

export default function LeadsTrendChart({ points, showReplied = true }: { points: TrendPoint[]; showReplied?: boolean }) {
  const t = useT()
  const dir = dirFor(t.locale)
  const [active, setActive] = useState<number | null>(null)
  const n = points.length
  const tip = active != null ? points[active] : null

  const config = {
    newLeads: { label: t('today.analytics.legendNew'), color: 'var(--color-primary)' },
    replied: { label: t('today.analytics.legendReplied'), color: 'var(--color-success)' },
  } satisfies ChartConfig

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const step = e.key === 'ArrowRight' ? 1 : -1
    setActive((a) => Math.min(n - 1, Math.max(0, (a ?? n - 1) + step)))
  }

  return (
    <div
      dir='ltr'
      role='group'
      tabIndex={0}
      aria-label={t('today.analytics.chartLabel')}
      onKeyDown={onKeyDown}
      onFocus={() => setActive((a) => a ?? n - 1)}
      onBlur={() => setActive(null)}
      className='relative flex min-h-[280px] flex-1 flex-col rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary'
    >
      <ChartContainer config={config} className='aspect-auto min-h-[280px] w-full flex-1'>
        <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} accessibilityLayer={false}>
          <defs>
            <linearGradient id='fillNewLeads' x1='0' y1='0' x2='0' y2='1'>
              <stop offset='5%' stopColor='var(--color-newLeads)' stopOpacity={0.45} />
              <stop offset='95%' stopColor='var(--color-newLeads)' stopOpacity={0.03} />
            </linearGradient>
            <linearGradient id='fillReplied' x1='0' y1='0' x2='0' y2='1'>
              <stop offset='5%' stopColor='var(--color-replied)' stopOpacity={0.35} />
              <stop offset='95%' stopColor='var(--color-replied)' stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray='3 3' />
          <XAxis dataKey='short' tickLine={false} axisLine={false} tickMargin={10} minTickGap={28} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tickMargin={6} width={32} />
          <ChartTooltip
            cursor={{ strokeDasharray: '4 4' }}
            content={
              <ChartTooltipContent
                dir={dir}
                indicator='dot'
                labelFormatter={(_, payload) => String(payload[0]?.payload?.long ?? '')}
              />
            }
          />
          {tip && <ReferenceLine x={tip.short} stroke='var(--color-newLeads)' strokeDasharray='4 4' />}
          <Area
            dataKey='newLeads'
            type='monotone'
            fill='url(#fillNewLeads)'
            stroke='var(--color-newLeads)'
            strokeWidth={2}
            activeDot={{ r: 4 }}
          />
          {showReplied && (
            <Area
              dataKey='replied'
              type='monotone'
              fill='url(#fillReplied)'
              stroke='var(--color-replied)'
              strokeWidth={2}
              activeDot={{ r: 4 }}
            />
          )}
          <ChartLegend content={<ChartLegendContent dir={dir} />} />
        </AreaChart>
      </ChartContainer>

      {tip && (
        <div
          dir={dir}
          role='status'
          className='pointer-events-none absolute end-2 top-0 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap text-ink shadow-overlay'
        >
          <div className='mb-0.5 font-semibold'>{tip.long}</div>
          <div className='tabular-nums'>{t('today.analytics.tipNew', { count: tip.newLeads })}</div>
          {showReplied && <div className='text-success-text tabular-nums'>{t('today.analytics.tipReplied', { count: tip.replied })}</div>}
        </div>
      )}
    </div>
  )
}
