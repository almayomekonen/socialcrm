import { formatCurrency } from '@/lib/funcs'
import { ProcessedPie, HideConfig, LegendItem } from './types'

type LegendProps = {
  isCombined: boolean
  combinedData: LegendItem[] | null
  pies: ProcessedPie[]
  split: boolean
  onClick: Record<string, () => void>
  onHover: (data: any, e?: any) => void
  hideConfigs: Record<string, HideConfig>
  numPies: number
}

export const Legend = ({ isCombined, combinedData, pies, split, onClick, onHover, hideConfigs, numPies }: LegendProps) => {
  const trunc = (s: string) => (s.length > 17 ? s.substring(0, 17) + '..' : s)

  const ItemRow = ({ name, color, children, onEnter, isClickable }: any) => (
    <div className='flex flex-nowrap mb-1 last:mb-0' onMouseLeave={() => onHover(null)}>
      <div
        className={`w-36 flex flex-nowrap gap-2 mb-1 last:mb-0 ${isClickable ? 'cursor-pointer hover:bg-gray-100' : ''}`}
        onMouseEnter={(e) => onEnter?.(e)}
        onClick={() => isClickable && onClick[name]?.()}
      >
        <span className='size-3 rounded-full shrink-0' style={{ backgroundColor: color }} />
        <div className='font-bold whitespace-nowrap'>{trunc(name)}</div>
      </div>
      <div className='flex flex-nowrap gap-8'>{children}</div>
    </div>
  )

  if (isCombined && combinedData && !split) {
    return (
      <div>
        {numPies > 1 && (
          <div className='mb-2 pb-1 border-b flex'>
            <div className='w-36' />
            <div className='flex gap-8'>
              {pies.map((p) => (
                <div key={p.label} className='w-34 font-bold'>
                  {p.label}
                </div>
              ))}
            </div>
          </div>
        )}
        {combinedData.map((item: any) => (
          <ItemRow
            key={item.name}
            name={item.name}
            color={item.color}
            isClickable={!!onClick[item.name]}
            onEnter={(e: any) => onHover({ name: item.name }, e)}
          >
            {item.pies.map((p: any) => (
              <div
                key={p.label}
                className='w-34 flex gap-1 hover:bg-gray-100'
                onMouseEnter={(e) => onHover({ name: item.name, pieLabel: p.label }, e)}
              >
                <div className='font-semibold'>
                  {formatCurrency(p.value)}
                  {!hideConfigs?.[p.label]?.hidePercentages && <span className='mr-1'>({p.percentage.toFixed(1)}%)</span>}
                </div>
              </div>
            ))}
          </ItemRow>
        ))}
      </div>
    )
  }

  return (
    <>
      {pies.map((pie: ProcessedPie) => (
        <div key={pie.label}>
          {pie.fullLegendData.map((item: any) => (
            <div key={item.name} className='flex px-1 rounded' onMouseLeave={() => onHover(null)}>
              <div
                className='flex w-32 gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded'
                onMouseEnter={(e) => onHover({ name: item.name, pieLabel: pie.label, noTooltip: true }, e)}
                onClick={() => onClick[item.name]?.()}
              >
                <span className='size-3 rounded-full' style={{ backgroundColor: item.color }} />
                <span className='font-bold'>{trunc(item.name)}</span>
              </div>
              <div
                className='hover:bg-gray-50 p-1 rounded text-right'
                onMouseEnter={(e) => onHover({ name: item.name, pieLabel: pie.label }, e)}
              >
                {formatCurrency(item.value)}
                {!hideConfigs?.[pie.label]?.hidePercentages && <span className='mr-1'>({item.percentage.toFixed(1)}%)</span>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  )
}
Legend.displayName = 'Legend'
