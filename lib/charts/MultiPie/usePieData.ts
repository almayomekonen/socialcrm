import { getThemeColors, PieTheme } from '@/types/colors'
import { ProcessedPie, PieData } from './types'
import { RADIUS_MAPS, getScaledRadius, OTHER_COLOR } from './utils'

type UsePieDataProps = {
  data: Array<{
    label: string
    data: PieData[]
    groups?: Array<{ name: string; names: string[] }>
    tooltipInfo?: Record<string, PieData[]>
  }>
  minPercentage: number
  color?: PieTheme | null
  asPie?: boolean | null
  split: boolean
}

export function usePieData({ data, minPercentage, color, asPie, split }: UsePieDataProps) {
  if (!data?.length) return { processedPies: [], isEmpty: true, numPies: 0 }

  const otherLabel = `קטנים מ ${minPercentage}%`
  const colors = getThemeColors(color)
  const groups = data.find((p) => p.groups)?.groups

  // Group & Colors
  const grouped = data.map((pie) => {
    if (!groups?.length) return pie
    const groupMap = new Map()
    const namesToGroup = new Set(groups.flatMap((g) => g.names))
    groups.forEach((g) => groupMap.set(g.name, { ...g, value: 0, groupedItems: [] }))

    const newData = pie.data.filter((item) => {
      if (!namesToGroup.has(item.name)) return true
      const gName = groups.find((g) => g.names.includes(item.name))?.name
      const g = groupMap.get(gName)
      if (g) {
        g.value += item.value
        g.groupedItems.push(item)
      }
      return false
    })
    return { ...pie, data: [...newData, ...groupMap.values()] }
  })

  const allNames = Array.from(new Set(grouped.flatMap((p) => p.data.map((i) => i.name))))
  const nameMap = Object.fromEntries(allNames.map((n, i) => [n, colors[i % colors.length]]))

  const radiusMapKey = asPie ? 'pie' : 'donut'
  const radiusConfig = RADIUS_MAPS[radiusMapKey][data.length - 1] || []
  const radiusCfg = getScaledRadius(radiusConfig)

  const processedPies = grouped.map((pie, idx) => {
    const total = pie.data.reduce((s, i) => s + i.value, 0)
    const threshold = (minPercentage / 100) * total

    // Process "Other"
    let finalData = pie.data.filter((i) => i.value >= threshold)
    const small = pie.data.filter((i) => i.value < threshold)
    if (small.length >= 2) {
      finalData.push({ name: otherLabel, value: small.reduce((s, i) => s + i.value, 0), originalItems: small })
    } else {
      finalData = pie.data // Keep all if not enough small items
    }

    // Chart Segments
    let angle = 0
    const chartData = finalData.map((item) => {
      const pct = total ? (item.value / total) * 100 : 0
      const seg = {
        ...item,
        percentage: pct,
        start: angle,
        end: angle + pct,
        color: item.name === otherLabel ? OTHER_COLOR : nameMap[item.name],
      }
      angle += pct
      return seg
    })

    return {
      label: pie.label,
      total,
      isEmpty: total === 0,
      chartData,
      fullLegendData: pie.data.map((i) => ({ ...i, percentage: total ? (i.value / total) * 100 : 0, color: nameMap[i.name] })),
      radius: radiusCfg[idx],
      tooltipInfo: pie.tooltipInfo,
    }
  }) as ProcessedPie[]

  // Combined Legend
  const firstNames = new Set(grouped[0].data.map((i) => i.name))
  const canCombine =
    !split && grouped.every((p) => p.data.length === firstNames.size && p.data.every((i) => firstNames.has(i.name)))
  const combinedLegendData = canCombine
    ? Array.from(firstNames).map((name) => ({
        name,
        color: nameMap[name],
        pies: processedPies.map((p) => {
          const i = p.fullLegendData.find((x) => x.name === name)
          return {
            label: p.label,
            value: i?.value || 0,
            percentage: i?.percentage || 0,
            groupedItems: i?.groupedItems,
            originalItems: i?.originalItems,
          }
        }),
      }))
    : null

  return {
    processedPies,
    combinedLegendData,
    isCombinedLegend: !!combinedLegendData,
    numPies: data.length,
    isEmpty: processedPies.every((p) => p.isEmpty),
    nameToColorMap: nameMap,
    otherLabel,
  }
}
