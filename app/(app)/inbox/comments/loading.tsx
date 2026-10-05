import EntityLoading from '@/components/mobile/skeletons/EntityLoading'
import InboxListSkeletonMobile from '@/components/mobile/skeletons/InboxListSkeletonMobile'

/**
 * Content-shaped skeleton — mirrors the comment row layout (avatar, name line,
 * body, footer) so the shell stays put while the list loads.
 * `frontend-experience-guidelines.md` §3: skeletons shadow the destination
 * layout; they never invent one, and they respect reduced motion.
 *
 * Phone never receives the desktop `grid` fallback in the committed tree.
 */
export default function Loading() {
  return (
    <EntityLoading
      phone={<InboxListSkeletonMobile />}
      desktop={
        <div className='grid gap-3 p-3 sm:p-4' aria-busy='true' aria-live='polite'>
          <span className='sr-only'>טוען תגובות</span>
          <div className='h-6 w-40 rounded bg-gray-100 motion-safe:animate-pulse' />
          {/* The status filter row. */}
          <div className='h-6 w-52 rounded-full bg-gray-100 motion-safe:animate-pulse' />
          {/* Comment cards in the feed's grid: avatar + name/meta, text, post image + excerpt, actions. */}
          <div className='@container/feed w-full'>
            <ul className='grid grid-cols-1 gap-3 @4xl/feed:grid-cols-2'>
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className='rounded-lg border border-gray-200 bg-white p-4'>
                  <div className='flex items-start gap-3'>
                    <div className='size-10 shrink-0 rounded-full bg-gray-100 motion-safe:animate-pulse' />
                    <div className='min-w-0 flex-1 space-y-1.5'>
                      <div className='h-3.5 w-32 rounded bg-gray-100 motion-safe:animate-pulse' />
                      <div className='h-2.5 w-24 rounded bg-gray-100 motion-safe:animate-pulse' />
                    </div>
                  </div>
                  <div className='mt-3 h-3.5 w-3/4 rounded bg-gray-100 motion-safe:animate-pulse' />
                  <div className='mt-3 h-44 rounded-md bg-gray-50 motion-safe:animate-pulse' />
                  <div className='mt-3 flex gap-2 border-t border-gray-100 pt-3'>
                    <div className='h-9 w-24 rounded-md bg-gray-100 motion-safe:animate-pulse' />
                    <div className='h-9 w-24 rounded-md bg-gray-100 motion-safe:animate-pulse' />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      }
    />
  )
}
