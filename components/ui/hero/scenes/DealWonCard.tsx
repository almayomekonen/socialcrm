import Icon from '@/lib/Icon'

// The payoff object: a closed deal. Emphasized above the supporting cards via a
// subtle success-gradient surface and a deeper shadow — premium, not flashy.
// Presentational only.
export function DealWonCard() {
  return (
    <div
      dir='rtl'
      className='flex w-52 items-center gap-3 rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50 to-white p-3.5 shadow-[0_14px_40px_rgba(16,185,129,0.18)]'
    >
      <span className='flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500'>
        <Icon name='circle-check' className='size-5 bg-white' />
      </span>
      <div className='min-w-0 flex-1'>
        <p className='truncate text-sm font-bold text-emerald-900'>עסקה נסגרה</p>
        <p className='truncate text-xs text-emerald-700/70'>דני לוי</p>
      </div>
    </div>
  )
}
