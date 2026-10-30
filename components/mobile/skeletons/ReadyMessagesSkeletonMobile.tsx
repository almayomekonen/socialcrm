import { LoadingStatus, Pulse } from './Pulse'

/** Mirrors ReadyMessagesWorkspace: back, title, CTA, grouped rows. */
export default function ReadyMessagesSkeletonMobile() {
  return (
    <div className='px-4 pb-8 pt-4' aria-busy='true' data-testid='ready-messages-skeleton-mobile'>
      <LoadingStatus />
      <Pulse className='h-11 w-36 rounded' />
      <Pulse className='mt-3 h-7 w-44 rounded' />
      <Pulse className='mt-2 h-4 w-56 max-w-full rounded' />
      <Pulse className='mt-4 h-11 w-full rounded-md' />
      <div className='mt-3 overflow-hidden rounded-xl border border-gray-200 bg-white' aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className='border-b border-gray-100 px-3.5 py-2.5 last:border-b-0'>
            <Pulse className='h-4 w-32 rounded' />
            <Pulse className='mt-1.5 h-3 w-full rounded' />
          </div>
        ))}
      </div>
    </div>
  )
}
