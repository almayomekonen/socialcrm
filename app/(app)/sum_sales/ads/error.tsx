'use client' // Error boundaries must be Client Components

import { useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'

/**
 * Segment error boundary for ביצועי מודעות — for failures outside Meta's answers
 * (those render as notices in the page). Hebrew, actionable, no raw error. Retry
 * re-fetches the same selection; the ביצועים navigation above stays usable.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    console.error('[ads-report-error]', error?.digest ?? '', error)
  }, [error])

  return (
    <div className='flex min-h-[40vh] w-full items-center justify-center p-6' dir='rtl' role='alert'>
      <div className='grid w-full max-w-md gap-3 rounded-xl border border-gray-200 bg-white p-7 text-center shadow-sm'>
        <h2 className='m-0 text-lg font-bold text-gray-900'>לא ניתן לטעון את ביצועי המודעות</h2>
        <p className='m-0 text-sm leading-relaxed text-gray-600'>משהו השתבש בטעינת הדוח. הנתונים בפייסבוק לא השתנו. אפשר לנסות שוב.</p>
        <div className='mt-2 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center'>
          <Btn
            variant='solid'
            size='large'
            lbl={pending ? 'טוען מחדש…' : 'נסה שנית'}
            disabled={pending}
            type='button'
            onClick={() =>
              startTransition(() => {
                router.refresh()
                reset()
              })
            }
          />
          <Btn variant='outline' size='large' lbl='חזרה לביצועים' href='/sum_sales' />
        </div>
      </div>
    </div>
  )
}
