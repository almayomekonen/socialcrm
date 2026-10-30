import { LoadingStatus, Pulse } from './Pulse'

/** Mirrors MobileMoreView: section label + grouped list rows. */
export default function MoreSkeletonMobile() {
  return (
    <div className='flex flex-col gap-5 px-4 pb-8 pt-4' aria-busy='true' data-testid='more-skeleton-mobile'>
      <LoadingStatus />
      {[0, 1].map((s) => (
        <div key={s}>
          <Pulse className='mb-1.5 h-3.5 w-20 rounded' />
          <div className='overflow-hidden rounded-xl border border-gray-200 bg-white' aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className='flex min-h-11 items-center gap-3 border-b border-gray-100 px-3.5 py-2.5 last:border-b-0'>
                <Pulse className='size-9 shrink-0 rounded-lg' />
                <div className='min-w-0 flex-1 space-y-1.5'>
                  <Pulse className='h-4 w-28 rounded' />
                  <Pulse className='h-3 w-40 max-w-full rounded' />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
