import { Pulse, Status } from './Pulse'

/** Mirrors ConversationThreadMobile: identity header, bubbles, composer. */
export default function InboxThreadSkeletonMobile() {
  return (
    <div className='flex min-h-full flex-col' aria-busy='true' data-testid='inbox-thread-skeleton-mobile'>
      <Status>טוען…</Status>
      <div className='flex items-center gap-1 border-b border-gray-200 bg-white px-1.5 py-1.5' aria-hidden>
        <Pulse className='size-11 shrink-0 rounded-full' />
        <Pulse className='size-9 shrink-0 rounded-full' />
        <div className='min-w-0 flex-1 space-y-1 ps-1'>
          <Pulse className='h-4 w-28 rounded' />
          <Pulse className='h-3 w-20 rounded' />
        </div>
        <Pulse className='size-11 shrink-0 rounded-full' />
      </div>
      <div className='min-h-0 flex-1 space-y-3 bg-bg p-4' aria-hidden>
        <Pulse className='ms-auto h-10 w-2/5 rounded-2xl' />
        <Pulse className='h-10 w-1/2 rounded-2xl' />
        <Pulse className='ms-auto h-10 w-1/3 rounded-2xl' />
        <Pulse className='h-10 w-2/5 rounded-2xl' />
      </div>
      <div className='border-t border-gray-200 bg-white p-3' aria-hidden>
        <Pulse className='h-11 w-full rounded-md' />
      </div>
    </div>
  )
}
