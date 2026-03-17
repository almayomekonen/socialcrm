'use client'
import { formatRoundCurrency, formatCurrency } from '@/lib/funcs'
import { COLORS, getColorVariations, getThemeColors, PieTheme } from '../../types/colors'
import { useState } from 'react'
import { twMerge } from 'tailwind-merge'

export default function Pie({
  data,
  asPie = null,
  lbl = '',
  info = null,
  className = '',
  onClick = {},
  minPercentage = 0,
  color = null,
  tooltipInfo = null,
}: {
  data: any[]
  asPie?: boolean | null
  lbl?: string
  info?: React.ReactNode | null
  className?: string
  onClick?: Record<string, () => void>
  minPercentage?: number
  color?: PieTheme | null
  tooltipInfo?: Record<string, Array<{ name: string; value: number }>> | null
}) {
  const [hoveredSegment, setHoveredSegment] = useState(null)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const [hoveredLegend, setHoveredLegend] = useState(null) // { name, type, parentName? }
  const otherLabel = `קטנים מ ${minPercentage}%`

  const chartColors = getThemeColors(color)

  // Process data for small slices (for outer pie)
  const processData = (data, total) => {
    if (total === 0 || minPercentage === 0) return data
    const minSliceValue = (minPercentage / 100) * total
    const largeSlices = data.filter((d) => d.value >= minSliceValue)
    const smallSlices = data.filter((d) => d.value < minSliceValue)

    if (smallSlices.length > 1) {
      const otherValue = smallSlices.reduce((sum, item) => sum + item.value, 0)
      return [...largeSlices, { name: otherLabel, value: otherValue, originalItems: smallSlices }]
    }
    return data
  }

  const dataWithValues = data.map((item) => ({
    ...item,
    value: item.values.reduce((sum, val) => sum + val.value, 0),
  }))

  const totalValue = dataWithValues.reduce((sum, item) => sum + item.value, 0)
  const isEmpty = totalValue === 0

  // Process outer pie data with minPercentage support
  const processedOuterData = processData(dataWithValues, totalValue)

  // Calculate inner pie data for ALL values combined with matching colors
  const allValues = []
  const allValuesWithParentColors = []

  processedOuterData.forEach((item, itemIndex) => {
    const mainColor = chartColors[itemIndex % chartColors.length]
    const variations = getColorVariations(mainColor)

    // Handle grouped items (from minPercentage grouping)
    if (item.originalItems) {
      item.originalItems.forEach((originalItem) => {
        if (originalItem.values) {
          originalItem.values.forEach((val, valIndex) => {
            allValues.push(val)
            allValuesWithParentColors.push({
              ...val,
              parentColor: mainColor,
              variationColor: variations[valIndex % variations.length],
              parentName: item.name,
            })
          })
        }
      })
    } else if (item.values) {
      item.values.forEach((val, valIndex) => {
        allValues.push(val)
        allValuesWithParentColors.push({
          ...val,
          parentColor: mainColor,
          variationColor: variations[valIndex % variations.length],
          parentName: item.name,
        })
      })
    }
  })

  const allValuesTotal = allValues.reduce((sum, val) => sum + val.value, 0)

  let valuesCumulativePercentage = 0
  const allValuesData = allValuesWithParentColors.map((val, valIndex) => {
    const valPercentage = allValuesTotal === 0 ? 0 : (val.value / allValuesTotal) * 100

    const valStart = valuesCumulativePercentage
    const valEnd = (valuesCumulativePercentage += valPercentage)

    return {
      ...val,
      percentage: valPercentage,
      color: val.variationColor,
      start: valStart,
      end: valEnd,
    }
  })

  let cumulativePercentage = 0

  const chartData = processedOuterData.map((item, index) => {
    const percentage = totalValue === 0 ? 0 : (item.value / totalValue) * 100
    const color = item.name === otherLabel ? '#4f5a69' : chartColors[index % chartColors.length]

    const start = cumulativePercentage
    const end = (cumulativePercentage += percentage)

    return {
      ...item,
      value: formatRoundCurrency(item.value),
      percentage,
      color,
      start,
      end,
    }
  })

  // Full legend data (without minPercentage grouping)
  const fullLegendData = dataWithValues.map((item, index) => {
    const percentage = totalValue === 0 ? 0 : (item.value / totalValue) * 100
    return {
      ...item,
      percentage,
      color: chartColors[index % chartColors.length],
    }
  })

  const shouldReduceOpacity = (item, type) => {
    if (!hoveredLegend) return false

    if (hoveredLegend.type === 'outer') {
      if (type === 'outer') {
        return item.name !== hoveredLegend.name // Dim other outer slices
      }
      return true // Dim all inner slices
    }

    if (hoveredLegend.type === 'inner') {
      if (type === 'inner') {
        return item.name !== hoveredLegend.name || item.parentName !== hoveredLegend.parentName // Dim other inner slices
      }
      return true // Dim all outer slices
    }

    return false
  }

  const createPath = (startAngle, endAngle, outerRadius, innerRadius = 0) => {
    // Handle full circle case
    if (endAngle - startAngle >= 360) {
      if (innerRadius === 0) {
        // Full pie slice
        return `M 0 0 L 0 -${outerRadius} A ${outerRadius} ${outerRadius} 0 1 1 0 ${outerRadius} A ${outerRadius} ${outerRadius} 0 1 1 0 -${outerRadius} Z`
      } else {
        // Full donut
        return `M 0 -${outerRadius} A ${outerRadius} ${outerRadius} 0 1 1 0 ${outerRadius} A ${outerRadius} ${outerRadius} 0 1 1 0 -${outerRadius} Z M 0 -${innerRadius} A ${innerRadius} ${innerRadius} 0 1 0 0 ${innerRadius} A ${innerRadius} ${innerRadius} 0 1 0 0 -${innerRadius} Z`
      }
    }

    const start = polarToCartesian(0, 0, outerRadius, endAngle)
    const end = polarToCartesian(0, 0, outerRadius, startAngle)
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1'

    if (innerRadius === 0) {
      return ['M', 0, 0, 'L', start.x, start.y, 'A', outerRadius, outerRadius, 0, largeArcFlag, 0, end.x, end.y, 'Z'].join(' ')
    } else {
      const innerStart = polarToCartesian(0, 0, innerRadius, endAngle)
      const innerEnd = polarToCartesian(0, 0, innerRadius, startAngle)

      return [
        'M',
        start.x,
        start.y,
        'A',
        outerRadius,
        outerRadius,
        0,
        largeArcFlag,
        0,
        end.x,
        end.y,
        'L',
        innerEnd.x,
        innerEnd.y,
        'A',
        innerRadius,
        innerRadius,
        0,
        largeArcFlag,
        1,
        innerStart.x,
        innerStart.y,
        'Z',
      ].join(' ')
    }
  }

  const polarToCartesian = (centerX, centerY, radius, angleInDegrees) => {
    const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0
    // Round to 6 decimal places to ensure consistent server/client rendering
    const round = (num) => Math.round(num * 1000000) / 1000000
    return {
      x: round(centerX + radius * Math.cos(angleInRadians)),
      y: round(centerY + radius * Math.sin(angleInRadians)),
    }
  }

  const handleMouseMove = (e) => {
    setMousePosition({ x: e.clientX, y: e.clientY })
  }

  return (
    <div className={twMerge('bg-white px-6 py-4 rounded-lg border', className)}>
      {lbl && <h2 className='text-xl font-bold text-right mb-1'>{lbl}</h2>}
      <div className='text-right mb-4'>
        <div className='text-l text-sm bg-gray-100 p-1 px-2 rounded inline-block'>
          סה"כ: <span className='font-bold'>{formatRoundCurrency(totalValue)}</span>
        </div>
      </div>
      <div className='overflow-x-auto flex gap-8' onMouseMove={handleMouseMove}>
        <section className='self-start'>
          {/* The Pie Chart */}
          {asPie ? (
            <svg className='pie-svg shrink-0' width='160' height='160' viewBox='-96 -96 192 192'>
              {isEmpty ? (
                <>
                  <circle cx='0' cy='0' r='82' fill='#94a3b8' className='opacity-50' />
                  <circle cx='0' cy='0' r='51' stroke='white' strokeWidth='1' fill='none' />
                </>
              ) : (
                <>
                  {/* Outer pie segments */}
                  {chartData.map((item, index) => {
                    const startAngle = (item.start / 100) * 360
                    const endAngle = (item.end / 100) * 360
                    const isReducedOpacity = shouldReduceOpacity(item, 'outer')

                    return (
                      <path
                        key={`outer-${index}`}
                        d={createPath(startAngle, endAngle, 82, 51)}
                        fill={item.color}
                        onMouseEnter={() => setHoveredSegment({ type: 'outer', data: item })}
                        onMouseLeave={() => setHoveredSegment(null)}
                        className='hover:opacity-80 transition-opacity'
                        style={{ opacity: isReducedOpacity ? 0.3 : 1 }}
                      />
                    )
                  })}

                  {/* Inner pie segments */}
                  {allValuesData.map((val, index) => {
                    const startAngle = (val.start / 100) * 360
                    const endAngle = (val.end / 100) * 360
                    const isReducedOpacity = shouldReduceOpacity(val, 'inner')

                    return (
                      <path
                        key={`inner-${index}`}
                        d={createPath(startAngle, endAngle, 51)}
                        fill={val.color}
                        onMouseEnter={() => setHoveredSegment({ type: 'inner', data: val })}
                        onMouseLeave={() => setHoveredSegment(null)}
                        className='hover:opacity-80 transition-opacity'
                        style={{ opacity: isReducedOpacity ? 0.3 : 1 }}
                      />
                    )
                  })}
                </>
              )}
            </svg>
          ) : (
            <svg className='pie-svg shrink-0' width='160' height='160' viewBox='-96 -96 192 192'>
              {isEmpty ? (
                <>
                  <circle cx='0' cy='0' r='82' fill='#94a3b8' className='opacity-50' />
                  <circle cx='0' cy='0' r='68' fill='white' />
                  <circle cx='0' cy='0' r='51' fill='#94a3b8' className='opacity-50' />
                  <circle cx='0' cy='0' r='37' fill='white' />
                </>
              ) : (
                <>
                  {/* Outer donut segments */}
                  {chartData.map((item, index) => {
                    const startAngle = (item.start / 100) * 360
                    const endAngle = (item.end / 100) * 360
                    const isReducedOpacity = shouldReduceOpacity(item, 'outer')

                    return (
                      <path
                        key={`outer-${index}`}
                        d={createPath(startAngle, endAngle, 82, 68)}
                        fill={item.color}
                        onMouseEnter={() => setHoveredSegment({ type: 'outer', data: item })}
                        onMouseLeave={() => setHoveredSegment(null)}
                        className='hover:opacity-80 transition-opacity'
                        style={{ opacity: isReducedOpacity ? 0.3 : 1 }}
                      />
                    )
                  })}

                  {/* Inner donut segments */}
                  {allValuesData.map((val, index) => {
                    const startAngle = (val.start / 100) * 360
                    const endAngle = (val.end / 100) * 360
                    const isReducedOpacity = shouldReduceOpacity(val, 'inner')

                    return (
                      <path
                        key={`inner-${index}`}
                        d={createPath(startAngle, endAngle, 51, 37)}
                        fill={val.color}
                        onMouseEnter={() => setHoveredSegment({ type: 'inner', data: val })}
                        onMouseLeave={() => setHoveredSegment(null)}
                        className='hover:opacity-80 transition-opacity'
                        style={{ opacity: isReducedOpacity ? 0.3 : 1 }}
                      />
                    )
                  })}
                </>
              )}
            </svg>
          )}
        </section>

        <div className='flex flex-col lg:flex-row flex-nowrap justify-center gap-4 items-start inline-flex'>
          {/* The Legend */}
          <div className='text-sm min-w-68 w-auto'>
            {fullLegendData.map((item, i) => {
              return (
                <div
                  key={i}
                  className='flex justify-between items-center px-1 rounded transition-colors'
                  onMouseLeave={() => setHoveredLegend(null)}
                >
                  <div
                    className='flex items-center gap-2 p-1 rounded hover:bg-gray-50 cursor-pointer'
                    onMouseEnter={() => setHoveredLegend({ name: item.name, type: 'outer', noTooltip: true })}
                    onClick={() => {
                      if (onClick && onClick[item.name]) {
                        onClick[item.name]()
                      }
                    }}
                  >
                    <span className='size-3 rounded-full' style={{ backgroundColor: item.color }}></span>
                    <span className='font-bold'>{item.name.length > 15 ? `${item.name.substring(0, 15)}..` : item.name}</span>
                  </div>
                  <div
                    className='text-right p-1 rounded hover:bg-gray-50'
                    onMouseEnter={() => setHoveredLegend({ name: item.name, type: 'outer' })}
                  >
                    <span>
                      {formatRoundCurrency(item.value)} <span dir='ltr'>({item.percentage.toFixed(1)}%)</span>
                    </span>
                  </div>
                </div>
              )
            })}

            {/* Legend for inner pie values */}
            {allValuesData.length > 0 && (
              <>
                <div className='mt-4 pt-2 border-t'>
                  {allValuesData.map((val, i) => (
                    <div
                      key={i}
                      className='flex justify-between  items-center px-1 rounded transition-colors'
                      onMouseLeave={() => setHoveredLegend(null)}
                    >
                      <div
                        className='flex items-center gap-2 p-1 rounded hover:bg-gray-50 cursor-pointer'
                        onMouseEnter={() =>
                          setHoveredLegend({ name: val.name, type: 'inner', parentName: val.parentName, noTooltip: true })
                        }
                        onClick={() => {
                          if (onClick && onClick[val.name]) {
                            onClick[val.name]()
                          }
                        }}
                      >
                        <span className='size-2.5 rounded-full' style={{ backgroundColor: val.color }}></span>
                        <span className='font-bold'>{val.name.length > 15 ? `${val.name.substring(0, 15)}..` : val.name}</span>
                      </div>
                      <div
                        className='text-right p-1 rounded hover:bg-gray-50'
                        onMouseEnter={() => setHoveredLegend({ name: val.name, type: 'inner', parentName: val.parentName })}
                      >
                        <span>
                          {formatRoundCurrency(val.value)} <span dir='ltr'>({val.percentage.toFixed(1)}%)</span>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {info && <div className='mt-4 pt-2 border-t'>{info}</div>}
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {hoveredSegment && !hoveredLegend && (
        <div
          className='fixed z-[9999] shadow-2xl bg-gradient-to-br from-white/90 to-white/50 backdrop-blur-sm text-black px-3 py-2 rounded-lg text-sm pointer-events-none'
          style={{
            left: mousePosition.x - 10,
            top: mousePosition.y - 10,
            transform: 'translateX(-100%)',
          }}
        >
          <div className='flex items-center gap-2 font-semibold'>
            <span className='size-2.5 rounded-full shrink-0' style={{ backgroundColor: hoveredSegment.data.color }}></span>
            <span>{hoveredSegment.data.name}</span>
          </div>
          <div>
            {hoveredSegment.type === 'outer' ? hoveredSegment.data.value : formatRoundCurrency(hoveredSegment.data.value)}
          </div>
          <div className='text-sm opacity-75'>{hoveredSegment.data.percentage.toFixed(1)}%</div>
          {(() => {
            const items = hoveredSegment.data.groupedItems || hoveredSegment.data.originalItems
            if (!items) return null

            return (
              <div className='mt-2 pt-2 border-t border-gray-500 max-w-xs'>
                <div className='font-bold mb-1'>כולל:</div>
                {items.map((subItem) => {
                  const percentageOfTotal = totalValue > 0 ? (subItem.value / totalValue) * 100 : 0
                  return (
                    <div key={subItem.name} className='flex justify-between text-sm gap-4'>
                      <div className='flex gap-1.5'>
                        <span className='size-2 rounded-full shrink-0' style={{ backgroundColor: chartColors[0] }}></span>
                        <span>{subItem.name}</span>
                      </div>
                      <span>
                        {formatCurrency(subItem.value)} ({percentageOfTotal.toFixed(1)}%)
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </div>
      )}

      {hoveredLegend &&
        !hoveredLegend.noTooltip &&
        (() => {
          let itemData
          if (hoveredLegend.type === 'outer') {
            itemData = fullLegendData.find((item) => item.name === hoveredLegend.name)
          } else if (hoveredLegend.type === 'inner') {
            itemData = allValuesData.find((val) => val.name === hoveredLegend.name && val.parentName === hoveredLegend.parentName)
          }

          if (!itemData) return null

          const tooltipInfoItems = tooltipInfo?.[itemData.name]
          const items = itemData.groupedItems || (itemData.name === otherLabel ? itemData.originalItems : null)

          return (
            <div
              className='fixed z-[9999] shadow-2xl bg-gradient-to-br from-white/90 to-white/50 backdrop-blur-sm text-black px-3 py-2 rounded-lg text-sm pointer-events-none'
              style={{
                left: mousePosition.x - 10,
                top: mousePosition.y - 10,
                transform: 'translateX(-100%)',
              }}
            >
              <div className='flex items-center gap-2 font-semibold'>
                <span className='size-2.5 rounded-full shrink-0' style={{ backgroundColor: itemData.color }}></span>
                <span>{itemData.name}</span>
              </div>
              <div>{hoveredLegend.type === 'outer' ? itemData.value : formatRoundCurrency(itemData.value)}</div>
              <div className='text-sm opacity-75'>{itemData.percentage.toFixed(1)}%</div>

              {items && items.length > 0 && (
                <div className='mt-2 pt-2 border-t border-gray-500 max-w-xs'>
                  <div className='font-bold mb-1'>כולל:</div>
                  {items.map((subItem) => {
                    const percentageOfTotal = totalValue > 0 && subItem.value ? (subItem.value / totalValue) * 100 : 0
                    const subItemTooltipInfo = tooltipInfo?.[subItem.name]

                    return (
                      <div key={subItem.name}>
                        <div className='flex justify-between text-sm gap-4'>
                          <div className='flex gap-1.5'>
                            <span className='size-2 rounded-full shrink-0' style={{ backgroundColor: chartColors[0] }}></span>
                            <span>{subItem.name}</span>
                          </div>
                          {subItem.value !== undefined && (
                            <span>
                              {formatCurrency(subItem.value)} ({percentageOfTotal.toFixed(1)}%)
                            </span>
                          )}
                        </div>

                        {subItemTooltipInfo && (
                          <div className='pl-4 my-1'>
                            {subItemTooltipInfo.map((info) => {
                              const percentageOfTotalForInfo = totalValue > 0 && info.value ? (info.value / totalValue) * 100 : 0
                              return (
                                <div key={info.name} className='flex justify-between text-sm gap-2 text-gray-800'>
                                  <div className='flex gap-1.5'>
                                    <span className='size-1.5 rounded-full bg-gray-400'></span>
                                    <span>{info.name}</span>
                                  </div>
                                  <span className='text-right'>
                                    {formatCurrency(info.value)}{' '}
                                    <span className='opacity-70'>({percentageOfTotalForInfo.toFixed(1)}%)</span>
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {tooltipInfoItems && tooltipInfoItems.length > 0 && (
                <div className='mt-2 pt-2 border-t border-gray-500 max-w-xs'>
                  {items && items.length > 0 ? null : <div className='font-bold mb-1'>פירוט:</div>}
                  {tooltipInfoItems.map((subItem) => {
                    const percentageOfTotal = totalValue > 0 && subItem.value ? (subItem.value / totalValue) * 100 : 0
                    return (
                      <div key={subItem.name} className='flex justify-between text-sm gap-4'>
                        <div className='flex gap-1.5'>
                          <span className='size-1.5 rounded-full bg-gray-400'></span>
                          <span>{subItem.name}</span>
                        </div>
                        {subItem.value !== undefined && (
                          <span className='text-right'>
                            {formatCurrency(subItem.value)}{' '}
                            <span className='text-sm opacity-70'>({percentageOfTotal.toFixed(1)}%)</span>
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })()}
    </div>
  )
}
