import { Pulse, Status } from './Pulse'

/** Mirrors LeadFilterBar + LeadCardMobile grouped list. */
export default function LeadsSkeletonMobile() {
  return (
    <div className='flex min-h-full flex-col' aria-busy='true' data-testid='leads-skeleton-mobile'>
      <Status>טוען…</Status>
      <div className='sticky top-0 z-20 border-b border-gray-200 bg-white px-3 pb-2 pt-2.5' aria-hidden>
        <Pulse className='h-11 w-full rounded-lg' />
        <div className='mt-2 flex items-center gap-2'>
          <Pulse className='size-11 shrink-0 rounded-lg' />
          <Pulse className='h-3 w-16 rounded' />
        </div>
      </div>
      <div className='mx-3 mt-3 overflow-hidden rounded-xl border border-gray-200 bg-white' aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className='flex items-center gap-2.5 border-b border-gray-100 px-3.5 py-2.5 last:border-b-0'>
            <div className='min-w-0 flex-1 space-y-1.5'>
              <div className='flex items-center gap-2'>
                <Pulse className='h-4 w-28 rounded' />
                <Pulse className='ms-auto h-3 w-8 rounded' />
              </div>
              <Pulse className='h-3 w-36 rounded' />
            </div>
            <Pulse className='size-11 shrink-0 rounded-full' />
            <Pulse className='size-11 shrink-0 rounded-full' />
          </div>
        ))}
      </div>
    </div>
  )
}
