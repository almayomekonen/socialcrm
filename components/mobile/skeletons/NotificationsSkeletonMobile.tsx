import { LoadingStatus, Pulse } from './Pulse'

/** Mirrors notifications mobile: segmented control + grouped rows. */
export default function NotificationsSkeletonMobile() {
  return (
    <div className='flex flex-col gap-3 p-3' aria-busy='true' data-testid='notifications-skeleton-mobile'>
      <LoadingStatus />
      <div className='flex items-center gap-1 rounded-lg bg-gray-100 p-1' aria-hidden>
        {[0, 1, 2].map((i) => (
          <Pulse key={i} className='h-11 min-w-0 flex-1 rounded-md' />
        ))}
      </div>
      <div className='overflow-hidden rounded-xl border border-gray-200 bg-white' aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className='flex items-start gap-3 border-b border-gray-100 px-3.5 py-3 last:border-b-0'>
            <Pulse className='size-9 shrink-0 rounded-lg' />
            <div className='min-w-0 flex-1 space-y-1.5'>
              <Pulse className='h-4 w-3/4 rounded' />
              <Pulse className='h-3 w-24 rounded' />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
