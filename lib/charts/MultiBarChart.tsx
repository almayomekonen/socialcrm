'use client'
import { formatRoundCurrency } from '@/lib/funcs'
import { COLORS } from '../../types/colors'
import { useState } from 'react'
import { ToolTip } from '../Tooltip'
import { twMerge } from 'tailwind-merge'

export default function MultiBarChart({ data, lbl = '', info = null, split = false, className = '' }) {
  const [hoveredBar, setHoveredBar] = useState(null)
  const [hoveredLegend, setHoveredLegend] = useState(null) // { series, name? }
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })

  // Validate input
  if (!data || data.length === 0 || data.length > 4) {
    return (
      <div className={twMerge('bg-white p-6 rounded-lg', className)}>
        <p className='text-red-500'>Invalid number of bar charts (must be 1-4)</p>
      </div>
    )
  }

  const numBars = data.length

  // Calculate totals
  const totals = data.map((bar) => bar.data.reduce((sum, item) => sum + item.value, 0))

  // Check if all bars have the same keys
  const firstBarNames = new Set(data[0].data.map((item) => item.name))
  const allHaveSameKeys = data.every((bar) => {
    const barNames = new Set(bar.data.map((item) => item.name))
    return barNames.size === firstBarNames.size && [...barNames].every((name) => firstBarNames.has(name))
  })

  // Assign colors to each dataset
  const barColors = data.map((_, index) => COLORS[index % COLORS.length])

  const handleMouseMove = (e) => {
    setMousePosition({ x: e.clientX, y: e.clientY })
  }

  // Check if bar should have reduced opacity
  const shouldReduceOpacity = (seriesLabel, itemName) => {
    if (!hoveredLegend) return false

    // If hovering a specific series
    if (hoveredLegend.series === seriesLabel) {
      // If also hovering a specific name, check if it matches
      if (hoveredLegend.name) {
        return itemName !== hoveredLegend.name
      }
      // If just hovering series (in split mode), don't reduce
      return false
    }

    // All other bars should be reduced
    return true
  }

  // If single bar chart
  if (numBars === 1) {
    return (
      <div className={twMerge('bg-white py-5 px-6 rounded-lg', className)}>
        <h2 className='text-xl font-bold text-right'>{lbl}</h2>
        <div className='text-right mb-4'>
          <div className='text-l'>
            סה"כ: <span className='font-bold'>{formatRoundCurrency(totals[0])}</span>
          </div>
        </div>
        <div className='flex justify-center'>
          <SingleBarChart data={data[0].data} title={data[0].label} color={barColors[0]} />
        </div>
        {info && <div className='mt-4 pt-2 border-t text-xs'>{info}</div>}
      </div>
    )
  }

  // If keys don't match OR split is requested, show separate charts
  if (!allHaveSameKeys || split) {
    return (
      <div className={twMerge('bg-white py-5 px-6 rounded-lg', className)}>
        <h2 className='text-xl font-bold text-right'>{lbl}</h2>
        <div className='text-right mb-4'>
          {data.map((bar, index) => (
            <div key={index} className='text-l'>
              סה"כ {bar.label}: <span className='font-bold'>{formatRoundCurrency(totals[index])}</span>
            </div>
          ))}
        </div>
        <div className={`flex flex-col md:flex-row gap-8 ${numBars === 2 ? 'md:justify-around' : 'md:justify-between'}`}>
          {data.map((bar, index) => (
            <SingleBarChart key={index} data={bar.data} title={bar.label} color={barColors[index]} />
          ))}
        </div>
        {info && <div className='mt-4 pt-2 border-t text-xs'>{info}</div>}
      </div>
    )
  }

  // Combined chart with grouped bars
  const allNames = Array.from(firstBarNames)
  const combinedData = allNames.map((name) => {
    const values = data.map((bar) => {
      const item = bar.data.find((d) => d.name === name)
      return item ? item.value : 0
    })
    return { name, values }
  })

  const maxValue = Math.max(...combinedData.flatMap((d) => d.values), 1)

  // Calculate bar width based on number of bars per group
  const barWidth = numBars === 2 ? 'w-5' : numBars === 3 ? 'w-4' : 'w-3'
  const gapSize = numBars === 2 ? 'gap-1' : numBars === 3 ? 'gap-0.5' : 'gap-0.5'

  return (
    <div className={twMerge('bg-white py-5 px-6 rounded-lg', className)}>
      <h2 className='text-xl font-bold text-right'>{lbl}</h2>
      <div className='text-right mb-4'>
        {data.map((bar, index) => (
          <div key={index} className='text-l'>
            סה"כ {bar.label}: <span className='font-bold'>{formatRoundCurrency(totals[index])}</span>
          </div>
        ))}
      </div>

      <div className='flex flex-col lg:flex-row flex-nowrap justify-center gap-8 items-center'>
        <div className='flex-grow w-full max-w-4xl overflow-x-auto' onMouseMove={handleMouseMove}>
          <div className='min-w-max'>
            <div
              className='flex justify-between items-end h-80 border-b border-gray-300 px-2 sm:px-4'
              style={{ minWidth: `${combinedData.length * 60}px` }}
            >
              {combinedData.map((item, index) => (
                <div key={index} className='flex-1 flex items-end justify-center h-full' style={{ minWidth: '50px' }}>
                  <div className={`flex flex-row items-end h-full ${gapSize}`}>
                    {item.values.map((value, barIndex) => {
                      const isReducedOpacity = shouldReduceOpacity(data[barIndex].label, item.name)
                      return (
                        <div
                          key={barIndex}
                          className={`${barWidth} rounded-t hover:opacity-80 cursor-pointer transition-opacity`}
                          style={{
                            height: `${(value / maxValue) * 100 || 0}%`,
                            backgroundColor: barColors[barIndex],
                            minHeight: value > 0 ? '8px' : '0',
                            opacity: isReducedOpacity ? 0.3 : 1,
                          }}
                          onMouseEnter={() =>
                            setHoveredBar({
                              name: item.name,
                              value: value,
                              series: data[barIndex].label,
                              color: barColors[barIndex],
                            })
                          }
                          onMouseLeave={() => setHoveredBar(null)}
                        >
                          &nbsp;
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className='flex justify-between px-2 sm:px-4 mt-1' style={{ minWidth: `${combinedData.length * 60}px` }}>
              {combinedData.map((item: any, index) => (
                <div key={index} className='flex-1 text-center text-xs text-gray-600' style={{ minWidth: '50px' }}>
                  <ToolTip lbl={item.name}>
                    <span className='block sm:hidden'>{item.name.length > 8 ? `${item.name.substring(0, 8)}..` : item.name}</span>
                    <span className='hidden sm:block'>
                      {item.name.length > 12 ? `${item.name.substring(0, 12)}..` : item.name}
                    </span>
                  </ToolTip>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* The Legend */}
        <div className='text-xs min-w-[180px] shrink-0'>
          {data.map((bar, index) => (
            <div
              key={index}
              className='flex items-center my-2 cursor-pointer hover:opacity-70 transition-opacity px-2 py-1 rounded hover:bg-gray-50'
              onMouseEnter={() => setHoveredLegend({ series: bar.label })}
              onMouseLeave={() => setHoveredLegend(null)}
            >
              <span className='size-3 rounded-full' style={{ backgroundColor: barColors[index] }}></span>
              <span className='ml-2 font-bold'>{bar.label}</span>
            </div>
          ))}
          {info && <div className='mt-4 pt-2 border-t'>{info}</div>}
        </div>
      </div>

      {/* Tooltip - only for bar hover (not for legend hover) */}
      {hoveredBar && !hoveredLegend && (
        <div
          className='fixed z-[9999] shadow-2xl bg-gradient-to-br   from-white/90 to-white/50 backdrop-blur-sm text-black px-3 py-2 rounded-lg text-sm pointer-events-none'
          style={{
            left: mousePosition.x + 10,
            top: mousePosition.y - 10,
          }}
        >
          <div className='flex items-center gap-2 font-semibold'>
            <span className='size-2.5 rounded-full shrink-0' style={{ backgroundColor: hoveredBar.color }}></span>
            <span>{hoveredBar.name}</span>
          </div>
          <div>
            {hoveredBar.series}: {formatRoundCurrency(hoveredBar.value)}
          </div>
        </div>
      )}
    </div>
  )
}
const SingleBarChart = ({ data, title, color }) => {
  const [hoveredBar, setHoveredBar] = useState(null)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })

  if (!data || data.length === 0) {
    return (
      <div className='flex-1 min-w-[400px] max-w-2xl'>
        <h3 className='text-lg font-bold text-center'>{title}</h3>
        <div className='flex justify-center items-center h-64 text-gray-500'>אין נתונים להצגה</div>
      </div>
    )
  }

  const maxValue = Math.max(...data.map((d) => d.value), 1)

  const handleMouseMove = (e) => {
    setMousePosition({ x: e.clientX, y: e.clientY })
  }

  return (
    <div className='flex-1 max-w-5xl'>
      <div className='flex items-center justify-center gap-2 mb-2'>
        <span className='size-3 rounded-full' style={{ backgroundColor: color }}></span>
        <h3 className='text-lg font-bold text-center'>{title}</h3>
      </div>
      <div className='flex-grow mt-4' onMouseMove={handleMouseMove}>
        <div className='flex justify-between items-end h-64 border-b border-gray-300 px-4 gap-2'>
          {data.map((item, index) => (
            <div key={index} className='flex-1 flex flex-col justify-end items-center group relative h-full'>
              <div
                className='w-5 rounded-t hover:opacity-80 cursor-pointer transition-opacity'
                style={{
                  backgroundColor: color,
                  height: `${(item.value / maxValue) * 100 || 0}%`,
                  minHeight: item.value > 0 ? '8px' : '0',
                }}
                onMouseEnter={() => setHoveredBar({ name: item.name, value: item.value })}
                onMouseLeave={() => setHoveredBar(null)}
              >
                &nbsp;
              </div>
            </div>
          ))}
        </div>
        <div className='flex justify-between px-4 mt-1 gap-2'>
          {data.map((item, index) => (
            <div key={index} className='flex-1 text-center text-xs text-gray-600'>
              <ToolTip lbl={item.name}>
                <span>{item.name.length > 12 ? `${item.name.substring(0, 12)}..` : item.name}</span>
              </ToolTip>
            </div>
          ))}
        </div>
      </div>

      {hoveredBar && (
        <div
          className='fixed shadow-2xl z-[9999] bg-gradient-to-br  from-white/90 to-white/50 backdrop-blur-sm text-black px-3 py-2 rounded-lg text-sm pointer-events-none'
          style={{
            left: mousePosition.x + 10,
            top: mousePosition.y - 10,
          }}
        >
          <div className='flex items-center gap-2 font-semibold'>
            <span className='size-2.5 rounded-full shrink-0' style={{ backgroundColor: color }}></span>
            <span>{hoveredBar.name}</span>
          </div>
          <div>{formatRoundCurrency(hoveredBar.value)}</div>
        </div>
      )}
    </div>
  )
}
