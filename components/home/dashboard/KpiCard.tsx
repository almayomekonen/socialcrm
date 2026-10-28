import Sparkline from './Sparkline'

// One KPI tile (RSC). The delta chip compares with the previous equal period and
// is omitted when there is no baseline — never a fake "0%".
type Props = {
  label: string
  value: string
  sub: string
  delta: number | null
  /** true when a rise is good (leads, revenue); false when a fall is good (response time). */
  upIsGood?: boolean
  spark: (number | null)[]
  color: string
}

export default function KpiCard({ label, value, sub, delta, upIsGood = true, spark, color }: Props) {
  const good = delta == null || delta === 0 ? null : delta > 0 === upIsGood
  const tone = good == null ? 'bg-neutral-bg text-neutral-text' : good ? 'bg-success-bg text-success-text' : 'bg-error-bg text-error-text'
  return (
    <div className='flex flex-col gap-2.5 rounded-[14px] border border-border bg-surface px-5 py-[18px]'>
      <div className='flex items-center justify-between gap-2'>
        <span className='text-sm font-medium text-gray-600'>{label}</span>
        {delta != null && (
          <span dir='ltr' className={`rounded-lg px-[7px] py-0.5 text-xs font-bold whitespace-nowrap tabular-nums ${tone}`}>
            {`${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta)}%`}
            <span className='sr-only'> לעומת התקופה הקודמת</span>
          </span>
        )}
      </div>
      <div className='flex items-end justify-between gap-2.5'>
        <div className='min-w-0'>
          <div className='text-[30px] leading-none font-extrabold tracking-[-0.5px] text-ink tabular-nums'>{value}</div>
          <div className='mt-1.5 text-[13px] text-gray-500'>{sub}</div>
        </div>
        <Sparkline values={spark} color={color} />
      </div>
    </div>
  )
}
