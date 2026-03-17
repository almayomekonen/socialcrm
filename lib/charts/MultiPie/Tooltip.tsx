import { formatCurrency } from '@/lib/funcs'
import { ProcessedPie, LegendItem } from './types'

type TooltipProps = {
  hovered: { data?: any; legend?: any }
  pos: { x: number; y: number }
  data: {
    pies: ProcessedPie[]
    combined: LegendItem[] | null
    isCombined: boolean
    split: boolean
    nameMap: Record<string, string>
  }
  otherLabel: string
}

export const Tooltip = ({ hovered, pos, data, otherLabel }: TooltipProps) => {
  if (!hovered.data && !hovered.legend) return null

  let info: any = null
  const { pies, combined, isCombined, split, nameMap } = data

  if (hovered.data) {
    const pie = pies.find((p: any) => p.label === hovered.data.pieLabel)
    if (pie)
      info = {
        label: pie.label,
        name: hovered.data.data.name,
        value: hovered.data.data.value,
        items: hovered.data.data.groupedItems || hovered.data.data.originalItems,
        pie,
      }
  } else if (hovered.legend) {
    const { name, pieLabel, noTooltip } = hovered.legend
    if (noTooltip) return null

    if (isCombined && !split) {
      const lItem = combined?.find((i: any) => i.name === name)
      const pData = lItem?.pies.find((p: any) => p.label === pieLabel)
      const pie = pies.find((p: any) => p.label === pieLabel)
      if (lItem && pData && pie)
        info = {
          label: pieLabel,
          name: lItem.name,
          value: pData.value,
          items: pData.groupedItems || pData.originalItems,
          pie,
          extraItems: pie.tooltipInfo?.[name],
        }
    } else {
      const pie = pies.find((p: any) => p.label === pieLabel)
      const item = pie?.fullLegendData.find((i: any) => i.name === name)
      if (pie && item)
        info = {
          label: pie.label,
          name: item.name,
          value: item.value,
          items: item.groupedItems || (item.name === otherLabel ? item.originalItems : undefined),
          pie,
          extraItems: pie.tooltipInfo?.[item.name],
        }
    }
  }

  if (!info) return null

  const pct = (v: number) => (info.pie.total > 0 ? (v / info.pie.total) * 100 : 0).toFixed(1) + '%'
  const Row = ({ name, val, className, hideDot }: any) => (
    <div className={`flex justify-between gap-8 w-full border-b border-gray-100 pb-1 last:border-b-0 last:pb-0 ${className}`}>
      <div className='flex gap-2'>
        {!hideDot && <span className='size-1.5 rounded-full bg-gray-500' />}
        <span>{name}</span>
      </div>
      <span className='text-right'>
        {formatCurrency(val)} <span className='opacity-70'>({pct(val)})</span>
      </span>
    </div>
  )

  return (
    <div
      className='fixed z-9999 shadow-16 bg-white text-black p-4 border rounded-lg text- pointer-events-none'
      style={{ left: pos.x - 10, top: pos.y + 10, transform: 'translateX(-100%)' }}
    >
      <div className='flex justify-between gap-4 font-bold mb-2'>
        <p>{info.name}</p>
        <span className='flex gap-1'>
          <p>{info.label}:</p>
          <p>{formatCurrency(info.value)}</p>
        </span>
      </div>
      {[...(info.items || []), ...(info.extraItems || [])].length > 0 && (
        <div className='border-t border-gray-500 pt-2 flex flex-col gap-1'>
          {info.items?.map((i: any) => [
            <Row key={i.name} name={i.name} val={i.value} c={nameMap[i.name]} hideDot className='font-semibold' />,
            (info.pie.tooltipInfo?.[i.name] || []).map((sub: any) => (
              <Row key={sub.name} name={sub.name} val={sub.value} className='ps-2 text-sm' />
            )),
          ])}
          {info.extraItems?.map((i: any) => (
            <Row key={i.name} name={i.name} val={i.value} />
          ))}
        </div>
      )}
    </div>
  )
}
Tooltip.displayName = 'Tooltip'
