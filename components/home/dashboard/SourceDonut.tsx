'use client'

import { Label, Pie, PieChart } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import type { SourceGroup, SourceSlice } from '@/lib/dashboard/stats'
import { useT } from '@/lib/i18n/I18nProvider'
import { dirFor } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'

// Lead sources for the period as a shadcn donut with the total in the centre,
// followed by a legend list that states each count and share in text (the chart
// is never the only carrier of the numbers).
export const SOURCE_COLOR: Record<SourceGroup, string> = {
  meta: 'var(--color-primary)',
  whatsapp: 'var(--color-success)',
  website: 'var(--color-solid-green)',
  manual: 'var(--color-warning)',
  other: 'var(--color-neutral-dot)',
}

/** Label by the slice's stable group key (`other` → `others`: see he/today.ts). */
const SOURCE_KEY: Record<SourceGroup, MessageKey> = {
  meta: 'today.analytics.source.meta',
  whatsapp: 'today.analytics.source.whatsapp',
  website: 'today.analytics.source.website',
  manual: 'today.analytics.source.manual',
  other: 'today.analytics.source.others',
}

export default function SourceDonut({ slices }: { slices: SourceSlice[] }) {
  const t = useT()
  const total = slices.reduce((a, s) => a + s.count, 0)
  const config: ChartConfig = Object.fromEntries(slices.map((s) => [s.key, { label: t(SOURCE_KEY[s.key]), color: SOURCE_COLOR[s.key] }]))
  const data = slices.map((s) => ({ key: s.key, count: s.count, fill: `var(--color-${s.key})` }))

  return (
    <div className='flex flex-col gap-5'>
      <ChartContainer config={config} dir='ltr' className='mx-auto aspect-square h-[200px]'>
        <PieChart accessibilityLayer={false}>
          <ChartTooltip cursor={false} content={<ChartTooltipContent dir={dirFor(t.locale)} hideLabel nameKey='key' />} />
          <Pie data={data} dataKey='count' nameKey='key' innerRadius={64} outerRadius={90} paddingAngle={2} cornerRadius={4} strokeWidth={0}>
            <Label
              content={({ viewBox }) => {
                if (!viewBox || !('cx' in viewBox) || viewBox.cx == null || viewBox.cy == null) return null
                return (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor='middle' dominantBaseline='middle'>
                    <tspan x={viewBox.cx} y={viewBox.cy - 6} className='fill-ink text-[28px] font-bold tabular-nums'>
                      {total.toLocaleString()}
                    </tspan>
                    <tspan x={viewBox.cx} y={viewBox.cy + 18} className='fill-gray-500 text-[13px]'>
                      {t('today.analytics.sourcesTotal')}
                    </tspan>
                  </text>
                )
              }}
            />
          </Pie>
        </PieChart>
      </ChartContainer>
      <ul className='flex flex-col gap-3'>
        {slices.map((s) => {
          const share = total ? Math.round((s.count / total) * 100) : 0
          return (
            <li key={s.key} className='flex flex-col gap-1.5'>
              <span className='flex items-center gap-2.5 text-sm'>
                <span aria-hidden className='size-2.5 shrink-0 rounded-[3px]' style={{ background: SOURCE_COLOR[s.key] }} />
                <span className='flex-1 truncate text-ink'>{t(SOURCE_KEY[s.key])}</span>
                <span className='text-gray-500 tabular-nums'>{s.count}</span>
                <span className='w-10 text-end font-semibold text-ink tabular-nums'>{share}%</span>
              </span>
              <span aria-hidden className='h-1.5 overflow-hidden rounded-full bg-neutral-bg'>
                <span className='block h-full rounded-full' style={{ width: `${share}%`, background: SOURCE_COLOR[s.key] }} />
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
