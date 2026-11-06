'use client'

import { Label, PolarGrid, PolarRadiusAxis, RadialBar, RadialBarChart } from 'recharts'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'

// Today's progress as a shadcn radial chart (handled share of today's brief).
// Decorative: the wrapping progressbar in BriefHero carries the value for
// assistive tech, so the drawing itself is hidden from it.
const config = { handled: { label: 'handled', color: 'var(--color-primary)' } } satisfies ChartConfig

export default function HeroProgressRing({ pct, caption }: { pct: number; caption: string }) {
  const data = [{ key: 'handled', value: pct, fill: 'var(--color-handled)' }]
  return (
    <ChartContainer aria-hidden config={config} dir='ltr' className='aspect-square h-[148px] shrink-0'>
      <RadialBarChart
        data={data}
        startAngle={90}
        endAngle={90 - pct * 3.6}
        innerRadius={58}
        outerRadius={78}
        accessibilityLayer={false}
      >
        <PolarGrid gridType='circle' radialLines={false} stroke='none' className='first:fill-primary-tint last:fill-surface' polarRadius={[61, 55]} />
        <RadialBar dataKey='value' background cornerRadius={10} />
        <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
          <Label
            content={({ viewBox }) => {
              if (!viewBox || !('cx' in viewBox) || viewBox.cx == null || viewBox.cy == null) return null
              return (
                <text x={viewBox.cx} y={viewBox.cy} textAnchor='middle' dominantBaseline='middle'>
                  <tspan x={viewBox.cx} y={viewBox.cy - 6} className='fill-ink text-[26px] font-bold tabular-nums'>
                    {pct}%
                  </tspan>
                  <tspan x={viewBox.cx} y={viewBox.cy + 16} className='fill-gray-500 text-[12px]'>
                    {caption}
                  </tspan>
                </text>
              )
            }}
          />
        </PolarRadiusAxis>
      </RadialBarChart>
    </ChartContainer>
  )
}
