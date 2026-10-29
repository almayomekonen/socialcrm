'use client'

import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'

/**
 * Desktop loading state for `/inbox/comments` — mirrors the comment card layout
 * (avatar, name line, body, post image, actions) so the shell stays put while the
 * feed loads. Used only by the route's `loading.tsx` (desktop branch), so it
 * follows the interface language like the page does.
 */
export default function CommentsRouteSkeleton() {
  const t = useT()
  const region = useRegionAttrs()
  return (
    <div className='grid gap-3 p-3 sm:p-4' aria-busy='true' aria-live='polite' {...region}>
      <span className='sr-only'>{t('inbox.comments.page.loading')}</span>
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
  )
}
