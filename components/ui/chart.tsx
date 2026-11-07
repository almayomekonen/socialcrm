'use client'

import * as React from 'react'
import * as RechartsPrimitive from 'recharts'
import { cn } from '@/lib/utils'

// shadcn/ui chart primitives (ChartContainer, ChartTooltip(Content),
// ChartLegend(Content)) adapted to this app:
// - Recharts 3: the tooltip/legend `content` props are typed locally instead of
//   through Recharts' v2 TooltipProps.
// - Series colours come from the brand tokens and are exposed as
//   `--color-<key>` on the container's style attribute (no injected <style>
//   element, so nothing new for the CSP to allow).
// - Chrome uses the app tokens (surface / border / ink / gray) — the shadcn
//   `background`/`muted` tokens are not defined in this theme.

export type ChartConfig = Record<string, { label?: React.ReactNode; color?: string }>

type ChartContextProps = { config: ChartConfig }

const ChartContext = React.createContext<ChartContextProps | null>(null)

function useChart() {
  const context = React.useContext(ChartContext)
  if (!context) throw new Error('useChart must be used within a <ChartContainer />')
  return context
}

function ChartContainer({
  config,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  config: ChartConfig
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children']
}) {
  const vars = Object.fromEntries(
    Object.entries(config)
      .filter(([, item]) => item.color)
      .map(([key, item]) => [`--color-${key}`, item.color]),
  ) as React.CSSProperties
  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot='chart'
        style={{ ...vars, ...style }}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-gray-500 [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-layer]:outline-hidden [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-neutral-bg [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-neutral-bg [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
          className,
        )}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

const ChartTooltip = RechartsPrimitive.Tooltip

type PayloadItem = {
  dataKey?: unknown
  name?: unknown
  value?: unknown
  color?: string
  fill?: string
  payload?: Record<string, unknown> & { fill?: string }
}

function itemConfig(config: ChartConfig, item: PayloadItem, key: string) {
  const fromPayload = item.payload && typeof item.payload[key] === 'string' ? (item.payload[key] as string) : undefined
  const fromItem = typeof (item as Record<string, unknown>)[key] === 'string' ? ((item as Record<string, unknown>)[key] as string) : undefined
  const k = fromPayload ?? fromItem ?? key
  return config[k] ?? config[key]
}

function ChartTooltipContent({
  active,
  payload,
  label,
  className,
  indicator = 'dot',
  hideLabel = false,
  labelFormatter,
  nameKey,
  dir,
}: {
  active?: boolean
  payload?: PayloadItem[]
  label?: React.ReactNode
  className?: string
  indicator?: 'line' | 'dot'
  hideLabel?: boolean
  labelFormatter?: (label: React.ReactNode, payload: PayloadItem[]) => React.ReactNode
  nameKey?: string
  /** Text direction of the tooltip (the plot itself stays LTR). */
  dir?: 'rtl' | 'ltr'
}) {
  const { config } = useChart()
  if (!active || !payload?.length) return null
  const heading = hideLabel ? null : labelFormatter ? labelFormatter(label, payload) : label

  return (
    <div
      dir={dir}
      className={cn('grid min-w-32 items-start gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-ink shadow-xl', className)}
    >
      {heading != null && heading !== '' && <div className='font-semibold'>{heading}</div>}
      <div className='grid gap-1.5'>
        {payload.map((item, i) => {
          const key = String(nameKey ?? item.name ?? item.dataKey ?? 'value')
          const cfg = itemConfig(config, item, key)
          const color = item.payload?.fill ?? item.color ?? item.fill
          return (
            <div key={i} className='flex w-full items-center gap-2'>
              <span
                aria-hidden
                className={cn('shrink-0 rounded-[2px]', indicator === 'dot' ? 'size-2.5' : 'h-2.5 w-1')}
                style={{ background: color }}
              />
              <span className='flex-1 text-gray-500'>{cfg?.label ?? String(item.name ?? '')}</span>
              <span className='font-mono font-medium text-ink tabular-nums'>
                {typeof item.value === 'number' ? item.value.toLocaleString() : String(item.value ?? '')}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const ChartLegend = RechartsPrimitive.Legend

function ChartLegendContent({
  className,
  payload,
  nameKey,
  dir,
}: {
  className?: string
  payload?: { value?: unknown; dataKey?: unknown; color?: string; payload?: Record<string, unknown> }[]
  nameKey?: string
  dir?: 'rtl' | 'ltr'
}) {
  const { config } = useChart()
  if (!payload?.length) return null
  return (
    <div dir={dir} className={cn('flex flex-wrap items-center justify-center gap-4 pt-3', className)}>
      {payload.map((item, i) => {
        const key = String(nameKey ? item.payload?.[nameKey] : item.dataKey ?? 'value')
        const cfg = config[key]
        return (
          <div key={i} className='flex items-center gap-1.5 text-gray-500'>
            <span aria-hidden className='size-2 shrink-0 rounded-[2px]' style={{ background: item.color }} />
            {cfg?.label}
          </div>
        )
      })}
    </div>
  )
}

export { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent }
