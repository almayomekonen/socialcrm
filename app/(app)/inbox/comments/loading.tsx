import { isPhoneEntity } from '@/components/mobile/skeletons/isPhoneEntity'
import InboxListSkeletonMobile from '@/components/mobile/skeletons/InboxListSkeletonMobile'

/**
 * Content-shaped skeleton — mirrors the comment row layout (avatar, name line,
 * body, footer) so the shell stays put while the list loads.
 * `frontend-experience-guidelines.md` §3: skeletons shadow the destination
 * layout; they never invent one, and they respect reduced motion.
 *
 * Phone never receives the desktop `grid` fallback.
 */
export default async function Loading() {
  if (await isPhoneEntity()) return <InboxListSkeletonMobile />
  return (
    <div className='grid gap-3 p-3 sm:p-4' aria-busy='true' aria-live='polite'>
      <span className='sr-only'>טוען תגובות</span>
      <div className='h-6 w-40 rounded bg-gray-100 motion-safe:animate-pulse' />
      <ul className='divide-y divide-gray-100 rounded-md border border-gray-200 bg-white'>
        {[0, 1, 2, 3, 4].map((i) => (
          <li key={i} className='flex gap-2.5 px-3 py-2.5'>
            <div className='size-8 shrink-0 rounded-full bg-gray-100 motion-safe:animate-pulse' />
            <div className='min-w-0 flex-1 space-y-1.5'>
              <div className='h-3.5 w-32 rounded bg-gray-100 motion-safe:animate-pulse' />
              <div className='h-3 w-3/4 rounded bg-gray-100 motion-safe:animate-pulse' />
              <div className='h-2.5 w-20 rounded bg-gray-100 motion-safe:animate-pulse' />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
