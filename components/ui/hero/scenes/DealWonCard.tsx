import Icon from '@/lib/Icon'

export function DealWonCard() {
  return (
    <div
      dir='rtl'
      className='flex w-56 items-center gap-3 rounded-2xl bg-linear-to-br from-emerald-50 to-white p-4 ring-1 ring-emerald-300/60 shadow-[0_22px_55px_rgba(16,185,129,0.28)]'
    >
      <span className='flex size-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-emerald-500 to-emerald-600 shadow-sm'>
        <Icon name='circle-check' className='size-5 bg-white' />
      </span>
      <div className='min-w-0 flex-1'>
        <p className='truncate text-sm font-bold text-emerald-900'>עסקה נסגרה</p>
        <p className='truncate text-xs text-emerald-700/70'>דני לוי</p>
      </div>
    </div>
  )
}
