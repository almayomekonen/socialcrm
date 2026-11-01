'use client' // Error boundaries must be Client Components

import { useEffect } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { useT } from '@/lib/i18n/I18nProvider'
import { regionAttrs } from '@/lib/i18n/config'

/**
 * Segment error boundary for (app). Manual recovery only — ChunkReloader owns
 * automatic chunk-load reloads. Do not auto-reload here (avoids dual reload loops).
 * Never surface raw error.message to the UI.
 *
 * Follows the interface language (Phase E6): it sits inside `<main>`, which
 * re-declares Hebrew, so it declares its own region. Hebrew keeps its
 * explicit `dir='rtl'`.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useT()
  const region = regionAttrs(t.locale)
  useEffect(() => {
    console.error('[app-error]', error?.digest ?? '', error)
  }, [error])

  return (
    <div
      className='flex min-h-[50vh] w-full items-center justify-center p-6'
      dir={region.dir ?? 'rtl'}
      lang={region.lang}
      role='alert'
    >
      <div className='grid w-full max-w-md gap-3 rounded-xl border border-gray-200 bg-white p-7 text-center shadow-sm'>
        <h2 className='m-0 text-xl font-bold text-gray-900'>{t('common.appError.title')}</h2>
        <p className='m-0 text-sm leading-relaxed text-gray-600'>{t('common.appError.body')}</p>
        <div className='mt-2 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center'>
          <Btn variant='solid' size='large' lbl={t('common.appError.retry')} onClick={() => reset()} type='button' />
          <Btn variant='outline' size='large' lbl={t('common.appError.back')} href='/leads' />
        </div>
      </div>
    </div>
  )
}
