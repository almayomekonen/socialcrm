import Icon from '@/lib/Icon'

// A follow-up the system is holding for the user. Presentational only.
export function ReminderCard() {
  return (
    <div
      dir='rtl'
      className='flex w-52 items-center gap-3 rounded-2xl border border-black/5 bg-white p-3 shadow-[0_8px_30px_rgba(23,20,36,0.12)]'
    >
      <span className='flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#3f20f5]/10'>
        <Icon name='bell' className='size-4 bg-[#3f20f5]' />
      </span>
      <div className='min-w-0 flex-1'>
        <p className='truncate text-sm font-medium text-gray-900'>תזכורת: להתקשר לדני</p>
        <p className='text-xs text-gray-400'>היום 14:00</p>
      </div>
    </div>
  )
}
