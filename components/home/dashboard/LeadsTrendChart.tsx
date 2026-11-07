'use client'

import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { useT } from '@/lib/i18n/I18nProvider'
import { dirFor } from '@/lib/i18n/config'

// New leads vs leads that got a human reply, one point per business day — the
// shadcn dashboard-01 "Area Chart – Interactive" in the app colours (primary / success).
// Time runs left → right regardless of page direction. Labels are precomputed
// on the server.
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
      className='relative rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-primary/25'
    >
      <ChartContainer config={config} className='aspect-auto h-[250px] w-full'>
        <AreaChart data={points} margin={{ top: 8, right: 0, left: 0, bottom: 0 }} accessibilityLayer={false}>
          <defs>
            <linearGradient id='fillNewLeads' x1='0' y1='0' x2='0' y2='1'>
              <stop offset='5%' stopColor='var(--color-newLeads)' stopOpacity={0.55} />
              <stop offset='95%' stopColor='var(--color-newLeads)' stopOpacity={0.04} />
            </linearGradient>
            <linearGradient id='fillReplied' x1='0' y1='0' x2='0' y2='1'>
              <stop offset='5%' stopColor='var(--color-replied)' stopOpacity={0.5} />
              <stop offset='95%' stopColor='var(--color-replied)' stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis dataKey='short' tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                dir={dir}
                indicator='dot'
                labelFormatter={(_, payload) => String(payload[0]?.payload?.long ?? '')}
              />
            }
          />
          {tip && <ReferenceLine x={tip.short} stroke='var(--color-primary)' strokeDasharray='4 4' />}
          <Area dataKey='newLeads' type='monotone' fill='url(#fillNewLeads)' stroke='var(--color-newLeads)' strokeWidth={1.5} />
          {showReplied && (
            <Area dataKey='replied' type='monotone' fill='url(#fillReplied)' stroke='var(--color-replied)' strokeWidth={1.5} />
          )}
        </AreaChart>
      </ChartContainer>

      {tip && (
        <div
          dir={dir}
          role='status'
          className='pointer-events-none absolute end-2 top-0 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap text-ink shadow-xl'
        >
          <div className='mb-0.5 font-medium'>{tip.long}</div>
          <div className='tabular-nums'>{t('today.analytics.tipNew', { count: tip.newLeads })}</div>
          {showReplied && <div className='text-gray-500 tabular-nums'>{t('today.analytics.tipReplied', { count: tip.replied })}</div>}
        </div>
      )}
    </div>
  )
}
