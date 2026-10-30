'use client'

import { useT } from '@/lib/i18n/I18nProvider'
import { regionAttrs } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { Pulse, Status } from './Pulse'

const HEBREW = translatorFor('he')

/** Mirrors ConversationListMobile: search + 64px rows with channel mark. */
export default function InboxListSkeletonMobile({ translated = false }: { translated?: boolean }) {
  // `translated`: every caller in the phone workspace — the phone inbox's own
  // loading boundaries and, since Phase F1, the shell-level MobileInnerSkeleton.
  // `inbox.page.loading` is the same "טוען…" in Hebrew.
  const ui = useT()
  const t = translated ? ui : HEBREW
  return (
    <div className='flex min-h-full flex-col' aria-busy='true' data-testid='inbox-skeleton-mobile' {...regionAttrs(t.locale)}>
      <Status>{t('inbox.page.loading')}</Status>
      <div className='sticky top-0 z-20 border-b border-gray-200 bg-white px-4 pb-2.5 pt-3' aria-hidden>
        <Pulse className='h-11 w-full rounded-lg' />
        <Pulse className='mt-2 h-3 w-16 rounded' />
      </div>
      <ul aria-hidden>
        {Array.from({ length: 7 }).map((_, i) => (
          <li key={i} className='flex min-h-16 items-center gap-3 border-b border-gray-100 bg-white px-4 py-3'>
            <Pulse className='size-10 shrink-0 rounded-full' />
            <div className='min-w-0 flex-1 space-y-1.5'>
              <div className='flex items-center gap-2'>
                <Pulse className='h-4 w-28 rounded' />
                <Pulse className='ms-auto h-3 w-14 rounded' />
              </div>
              <Pulse className='h-3 w-3/4 rounded' />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
