import Icon from '@/lib/Icon'

type Mode = 'no-lead' | 'hydrating' | 'empty'

export function EmptyTimelineState({ mode }: { mode: Mode }) {
  if (mode === 'no-lead') {
    return (
      <div className='h-full flex flex-col items-center justify-center gap-3 select-none px-6 text-center'>
        <Icon name='sparkles' type='reg' className='size-6 bg-gray-300' />
        <p className='text-sm text-gray-500'>בחר ליד כדי להתחיל</p>
      </div>
    )
  }
  if (mode === 'hydrating') {
    return (
      <div className='h-full flex items-center justify-center select-none'>
        <p className='text-xs text-gray-400'>טוען היסטוריה…</p>
      </div>
    )
  }
  return (
    <div className='h-full flex flex-col items-center justify-center gap-1.5 text-center px-6 select-none'>
      <p className='text-[13px] text-gray-500'>חיפוש מידע על הליד</p>
      <p className='text-[11px] text-gray-400'>שאל שאלה או בחר פעולה</p>
    </div>
  )
}
