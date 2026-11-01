'use client' // Error boundaries must be Client Components

import { useEffect } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { useT } from '@/lib/i18n/I18nProvider'
import { regionAttrs } from '@/lib/i18n/config'

/**
 * Segment error boundary for the Comments Inbox. Mirrors `app/(app)/error.tsx`:
 * manual recovery only, Hebrew and actionable, and the raw error message is
 * never surfaced to the user (`frontend-experience-guidelines.md` §5).
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Follows the interface language on desktop and in the phone workspace alike.
  // Hebrew keeps its explicit `dir='rtl'`.
  const t = useT()
  const region = regionAttrs(t.locale)
  useEffect(() => {
    console.error('[facebook-comments-error]', error?.digest ?? '', error)
  }, [error])

  return (
    <div className='flex min-h-[40vh] w-full items-center justify-center p-6' dir={region.dir ?? 'rtl'} lang={region.lang} role='alert'>
      <div className='grid w-full max-w-md gap-3 rounded-xl border border-gray-200 bg-white p-7 text-center shadow-sm'>
        <h2 className='m-0 text-lg font-bold text-gray-900'>{t('inbox.comments.error.title')}</h2>
        <p className='m-0 text-sm leading-relaxed text-gray-600'>{t('inbox.comments.error.body')}</p>
        <div className='mt-2 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center'>
          <Btn variant='solid' size='large' lbl={t('inbox.messenger.error.retry')} onClick={() => reset()} type='button' />
          <Btn variant='outline' size='large' lbl={t('inbox.messenger.error.back')} href='/inbox' />
        </div>
      </div>
    </div>
  )
}
