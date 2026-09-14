import EntityLoading from '@/components/mobile/skeletons/EntityLoading'
import InboxListSkeletonMobile from '@/components/mobile/skeletons/InboxListSkeletonMobile'

/** Content-shaped skeleton: the conversation list pane and an empty thread pane, shell unchanged. */
export default function Loading() {
  return (
    <EntityLoading
      phone={<InboxListSkeletonMobile />}
      desktop={
        <div className='flex h-[calc(100dvh-6rem)] min-h-0 gap-3' aria-busy='true' aria-live='polite'>
          <span className='sr-only'>טוען שיחות Messenger</span>
          <div className='w-80 shrink-0 rounded-lg border border-gray-200 bg-white'>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className='flex gap-2.5 border-b border-gray-100 px-3 py-2.5'>
                <div className='size-8 shrink-0 rounded-full bg-gray-100 motion-safe:animate-pulse' />
                <div className='min-w-0 flex-1 space-y-1.5'>
                  <div className='h-3.5 w-32 rounded bg-gray-100 motion-safe:animate-pulse' />
                  <div className='h-3 w-3/4 rounded bg-gray-100 motion-safe:animate-pulse' />
                </div>
              </div>
            ))}
          </div>
          <div className='min-w-0 flex-1 rounded-lg border border-gray-200 bg-white' />
        </div>
      }
    />
  )
}
