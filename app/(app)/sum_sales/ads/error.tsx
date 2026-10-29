'use client' // Error boundaries must be Client Components

import { useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'

/**
 * Segment error boundary for ביצועי מודעות — for failures outside Meta's answers
 * (those render as notices in the page). Hebrew, actionable, no raw error. Retry
 * re-fetches the same selection; the ביצועים navigation above stays usable.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT()
  const region = useRegionAttrs()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    console.error('[ads-report-error]', error?.digest ?? '', error)
  }, [error])

  return (
    <div className='flex min-h-[40vh] w-full items-center justify-center p-6' dir='rtl' {...region} role='alert'>
      <div className='grid w-full max-w-md gap-3 rounded-xl border border-gray-200 bg-white p-7 text-center shadow-sm'>
        <h2 className='m-0 text-lg font-bold text-gray-900'>{t('performance.ads.error.title')}</h2>
        <p className='m-0 text-sm leading-relaxed text-gray-600'>{t('performance.ads.error.body')}</p>
        <div className='mt-2 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center'>
          <Btn
            variant='solid'
            size='large'
            lbl={pending ? t('performance.ads.error.reloading') : t('performance.ads.error.retry')}
            disabled={pending}
            type='button'
            onClick={() =>
              startTransition(() => {
                router.refresh()
                reset()
              })
            }
          />
          <Btn variant='outline' size='large' lbl={t('performance.ads.error.back')} href='/sum_sales' />
        </div>
      </div>
    </div>
  )
}
