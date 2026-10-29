'use client'

import { useState } from 'react'
import { PieChart } from '@/lib/charts/MultiPie/PieChart'
import { RADIUS_MAPS, getScaledRadius } from '@/lib/charts/MultiPie/utils'
import type { ProcessedPie } from '@/lib/charts/MultiPie/types'
import type { SourceGroup, SourceSlice } from '@/lib/dashboard/stats'
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey } from '@/lib/i18n/translate'

// Lead sources for the period, drawn with the app's existing pie renderer
// (lib/charts/MultiPie). Hovering a ring segment or a legend row highlights it.
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
  const [hovered, setHovered] = useState<string | null>(null)
  const total = slices.reduce((a, s) => a + s.count, 0)
  let cum = 0
  const chartData = slices.map((s) => {
    const percentage = (s.count / total) * 100
    const item = { name: t(SOURCE_KEY[s.key]), value: s.count, percentage, color: SOURCE_COLOR[s.key], start: cum, end: cum + percentage }
    cum += percentage
    return item
  })
  const pie: ProcessedPie = {
    label: 'sources',
    total,
    isEmpty: total === 0,
    chartData,
    fullLegendData: chartData,
    radius: getScaledRadius(RADIUS_MAPS.donut[0])[0],
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='relative mx-auto flex size-[180px] items-center justify-center'>
        <PieChart
          pies={[pie]}
          isEmpty={pie.isEmpty}
          size={180 / 1.6}
          onHover={(d) => setHovered(d?.data?.name ?? null)}
          opacityFn={(name) => hovered != null && hovered !== name}
        />
        <div className='pointer-events-none absolute text-center'>
          <div className='text-[28px] leading-none font-extrabold text-ink tabular-nums'>{total}</div>
          <div className='mt-1 text-[13px] text-gray-500'>{t('today.analytics.sourcesTotal')}</div>
        </div>
      </div>
      <ul className='flex flex-col gap-2'>
        {chartData.map((s) => (
          <li
            key={s.name}
            onMouseEnter={() => setHovered(s.name)}
            onMouseLeave={() => setHovered(null)}
            className={`flex items-center gap-2.5 text-sm transition-opacity ${hovered && hovered !== s.name ? 'opacity-40' : ''}`}
          >
            <span aria-hidden className='size-2.5 shrink-0 rounded-[3px]' style={{ background: s.color }} />
            <span className='flex-1 truncate text-ink'>{s.name}</span>
            <span className='text-gray-500 tabular-nums'>{s.value}</span>
            <span className='w-10 text-left font-semibold text-ink tabular-nums'>{Math.round(s.percentage)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
