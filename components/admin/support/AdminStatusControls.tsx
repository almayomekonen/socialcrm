'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setSupportStatusAction } from '@/actions/support/admin'
import { ADMIN_STATUS_COPY } from '@/lib/support/adminCopy'
import { SUPPORT_STATUSES, type SupportStatus } from '@/lib/support/vocabulary'

/**
 * The owner's explicit override. Replying already parks the request on the
 * customer automatically; these exist for the cases derivation cannot cover —
 * "I have started looking at this" and "this is done".
 *
 * Pending is local to the button that was clicked, never a page overlay.
 */
export default function AdminStatusControls({
  requestId,
  current,
}: {
  requestId: number
  current: SupportStatus
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function set(status: SupportStatus) {
    startTransition(async () => {
      await setSupportStatusAction(requestId, status)
      router.refresh()
    })
  }

  // Primary actions the owner reaches for most often, surfaced first.
  const preferred: SupportStatus[] = ['in_progress', 'resolved']
  const ordered = [
    ...preferred,
    ...SUPPORT_STATUSES.filter((s) => !preferred.includes(s)),
  ]

  return (
    <div className='mt-6 rounded-2xl border border-gray-200 bg-white p-4'>
      <p className='mb-3 text-sm font-medium text-gray-900'>סטטוס</p>
      <div className='flex flex-wrap gap-2'>
        {ordered.map((s) => {
          const isCurrent = s === current
          const isPrimary = preferred.includes(s)
          return (
            <button
              key={s}
              type='button'
              onClick={() => set(s)}
              disabled={pending || isCurrent}
              aria-pressed={isCurrent}
              className={`rounded-full border px-3.5 py-2 text-xs font-medium transition ${
                isCurrent
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : isPrimary
                    ? 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-50'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50'
              }`}
            >
              {ADMIN_STATUS_COPY[s].label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
