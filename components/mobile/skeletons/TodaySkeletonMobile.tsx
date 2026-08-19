import { Pulse, Status } from './Pulse'

/** Mirrors MobileToday: hero card + compact grouped rows. */
export default function TodaySkeletonMobile() {
  return (
    <div className='flex flex-col gap-2 px-4 pb-5 pt-2' aria-busy='true' data-testid='today-skeleton-mobile'>
      <Status>טוען…</Status>
      <div className='rounded-xl border border-gray-200 bg-white p-4' aria-hidden>
        <Pulse className='h-3.5 w-28 rounded' />
        <Pulse className='mt-2 h-7 w-40 rounded' />
        <Pulse className='mt-2 h-3.5 w-32 rounded' />
        <Pulse className='mt-1.5 h-3.5 w-44 rounded' />
        <div className='mt-3 flex gap-2'>
          <Pulse className='h-11 min-w-0 flex-1 rounded-md' />
          <Pulse className='h-11 min-w-0 flex-1 rounded-md' />
          <Pulse className='h-11 w-16 shrink-0 rounded-md' />
        </div>
      </div>
      <Pulse className='ms-1 h-3.5 w-16 rounded' />
      <div className='overflow-hidden rounded-xl border border-gray-200 bg-white' aria-hidden>
        {[0, 1].map((i) => (
          <div key={i} className='flex items-center gap-2.5 border-b border-gray-100 px-3.5 py-2 last:border-b-0'>
            <div className='min-w-0 flex-1 space-y-1.5'>
              <Pulse className='h-4 w-28 rounded' />
              <Pulse className='h-3 w-24 rounded' />
            </div>
            <Pulse className='size-11 shrink-0 rounded-full' />
            <Pulse className='size-11 shrink-0 rounded-full' />
          </div>
        ))}
      </div>
    </div>
  )
}
