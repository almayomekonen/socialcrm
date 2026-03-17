'use client'

import { formatCurrency } from '@/lib/funcs'
import { useState } from 'react'
import { twMerge } from 'tailwind-merge'
import { MultiPieProps } from './types'
import { PieChart } from './PieChart'
import { Legend } from './Legend'
import { Tooltip } from './Tooltip'
import { usePieData } from './usePieData'

export default function MultiPie({
  data,
  asPie,
  lbl,
  info,
  minPercentage = 0,
  split = false,
  className = '',
  onClick = {},
  color = null,
  hideForPies = {},
  hideTooltip = false,
  size,
}: MultiPieProps) {
  const processedData = usePieData({ data, minPercentage, color, asPie, split })

  const [hovered, setHovered] = useState<{ data?: any; legend?: any } | null>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  const handleHover = (item: any, e: any) => {
    setHovered(item ? (item.data ? { data: item } : { legend: item }) : null)
    if (e) setPos({ x: e.clientX, y: e.clientY })
  }

  if (!data?.length || data.length > 4) return <div className='p-5 border rounded text-red-500 bg-white'>Invalid pies (1-4)</div>

  const opacityFn = (name: string, label: string) => {
    if (!hovered?.legend) return false
    const { name: hName, pieLabel: hLabel } = hovered.legend
    if (name === hName) return hLabel ? label !== hLabel : false
    if (name === processedData.otherLabel) {
      // Check if name is inside "Other"
      const pie = processedData.processedPies?.find((p) => p.label === label)
      const isInside = pie?.chartData
        .find((d) => d.name === processedData.otherLabel)
        ?.originalItems?.some((i) => i.name === hName)
      if (isInside) return hLabel ? label !== hLabel : false
    }
    return true
  }

  const visiblePies = processedData.processedPies?.filter((p) => !hideForPies[p.label]?.hideTotal)

  return (
    <div className={twMerge('bg-white p-4 rounded-lg border', className)}>
      <div className='overflow-x-auto flex gap-6 text-sm'>
        <section>
          {lbl && <h2 className='text-xl font-bold text-right mb-1'>{lbl}</h2>}
          {visiblePies && visiblePies.length > 0 && (
            <div className='text-right mb-4 grid w-fit gap-1.5'>
              {visiblePies.map((p) => (
                <p key={p.label} className='bg-gray-100 p-1 px-2 rounded'>
                  סה"כ{processedData.numPies > 1 ? ` ${p.label}: ` : ':'} <b>{formatCurrency(p.total)}</b>
                </p>
              ))}
            </div>
          )}
          <PieChart
            pies={processedData.processedPies || []}
            isEmpty={processedData.isEmpty}
            onHover={handleHover}
            opacityFn={opacityFn}
            size={size}
          />
        </section>

        <div className='flex items-start flex-col lg:flex-row gap-4'>
          <Legend
            isCombined={processedData.isCombinedLegend}
            combinedData={processedData.combinedLegendData}
            pies={processedData.processedPies || []}
            split={split}
            numPies={processedData.numPies}
            onClick={onClick}
            onHover={handleHover}
            hideConfigs={hideForPies}
          />
        </div>
      </div>

      {!hideTooltip && (
        <Tooltip
          hovered={hovered || {}}
          pos={pos}
          otherLabel={processedData.otherLabel || ''}
          data={{
            pies: processedData.processedPies || [],
            combined: processedData.combinedLegendData,
            isCombined: processedData.isCombinedLegend,
            split,
            nameMap: processedData.nameToColorMap || {},
          }}
        />
      )}
    </div>
  )
}
