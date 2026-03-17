import { PieTheme } from '@/types/colors'

export type PieItem = { name: string; value: number }

export type PieData = PieItem & {
  groupedItems?: PieItem[]
  originalItems?: PieItem[]
}

export type ProcessedPieItem = PieData & {
  percentage: number
  color: string
  start: number
  end: number
}

export type ProcessedPie = {
  label: string
  total: number
  isEmpty: boolean
  chartData: ProcessedPieItem[]
  fullLegendData: (PieData & { percentage: number; color: string })[]
  radius: { outer: number; inner: number }
  tooltipInfo?: Record<string, PieItem[]>
}

export type LegendItem = {
  name: string
  color: string
  pies: {
    label: string
    value: number
    percentage: number
    groupedItems?: PieItem[]
    originalItems?: PieItem[]
  }[]
}

export type HideConfig = { hidePercentages?: boolean; hideTotal?: boolean }

export type MultiPieProps = {
  data: Array<{
    label: string
    data: PieData[]
    groups?: Array<{ name: string; names: string[] }>
    tooltipInfo?: Record<string, PieData[]>
  }>
  asPie?: boolean | null
  lbl?: string | null
  info?: React.ReactNode | null
  minPercentage?: number
  split?: boolean
  className?: string
  onClick?: Record<string, () => void>
  color?: PieTheme | null
  hideForPies?: Record<string, HideConfig>
  size?: number
  hideTooltip?: boolean
}
