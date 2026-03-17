import { ProcessedPie } from './types'
import { createPath, PIE_SIZE } from './utils'

type PieChartProps = {
  pies: ProcessedPie[]
  isEmpty: boolean
  onHover: (data: any, e: any) => void
  opacityFn: (name: string, label: string) => boolean
  size?: number
}

export const PieChart = ({ pies, isEmpty, onHover, opacityFn, size: customSize }: PieChartProps) => {
  const size = customSize * PIE_SIZE || 100 * PIE_SIZE
  const viewBox = `${-48 * PIE_SIZE} ${-48 * PIE_SIZE} ${96 * PIE_SIZE} ${96 * PIE_SIZE}`

  return (
    <svg className='shrink-0' width={size} height={size} viewBox={viewBox}>
      {pies.map((pie: ProcessedPie, i: number) => {
        const nullPath = (
          <path key={i} d={createPath(0, 360, pie.radius.outer, pie.radius.inner)} fill='#94a3b8' className='opacity-50' />
        )
        if (isEmpty || pie.isEmpty) return nullPath
        return pie.chartData.map((d, j) => (
          <path
            key={`${i}-${j}`}
            d={createPath((d.start / 100) * 360, (d.end / 100) * 360, pie.radius.outer, pie.radius.inner)}
            fill={d.color}
            onMouseEnter={(e) => onHover({ data: d, pieLabel: pie.label, pieRadius: pie.radius }, e)}
            onMouseLeave={() => onHover(null, null)}
            className='hover:opacity-80 transition-opacity'
            style={{ opacity: opacityFn(d.name, pie.label) ? 0.3 : 1 }}
          />
        ))
      })}
    </svg>
  )
}
PieChart.displayName = 'PieChart'
