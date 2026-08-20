'use client'

import { useState, useTransition } from 'react'
import { Switch } from '@/lib/form'
import { setAutoResponseMasterEnabled } from '@/actions/autoResponse/setMasterEnabled'

/**
 * The switch, and the one line that says what it currently means.
 *
 * The status line lives HERE rather than in the server component because it is
 * the same piece of state as the switch. Splitting them would let the phone show
 * "כבוי" next to a switch the user just turned on, until a refresh caught up —
 * the mismatch an optimistic update exists to avoid.
 *
 * OPTIMISTIC, WITH A REAL ROLLBACK. The switch moves on tap, the action runs,
 * and a failure puts it back where it was and says so in Hebrew. Nothing here
 * reloads the page or calls `router.refresh()`; the server owns the value on the
 * next load, and until then the local state is honest about what was requested.
 *
 * `tap-44` gives the 34x20 shared `Switch` a 44px hit area on touch without
 * changing how it is drawn — the existing utility for exactly this, so the
 * control looks identical to the one on the desktop settings page.
 */
export default function AutoResponseToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const toggle = (next: boolean) => {
    if (pending) return
    const previous = enabled
    setEnabled(next)
    setError(null)

    startTransition(async () => {
      const res = await setAutoResponseMasterEnabled(next)
      // Narrow on the literal, not on truthiness — the result is a
      // discriminated union and `reason` exists only on the failure arm.
      if (res.ok === false) {
        setEnabled(previous)
        setError(
          res.reason === 'forbidden'
            ? 'רק מנהל יכול לשנות את המענה האוטומטי.'
            : 'לא הצלחנו לעדכן את המענה האוטומטי. נסו שוב.',
        )
      }
    })
  }

  return (
    <div data-testid='auto-response-toggle'>
      <div className='flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-3'>
        <div className='min-w-0'>
          <h1 className='text-[15px] font-semibold leading-tight text-ink'>מענה אוטומטי</h1>
          <p className='mt-0.5 text-[13px] leading-snug text-gray-500'>
            {enabled ? 'פעיל · עונה אוטומטית בוואטסאפ' : 'כבוי · אין מענה אוטומטי'}
          </p>
        </div>

        <span className='tap-44 flex shrink-0 items-center'>
          <Switch
            aria-label='מענה אוטומטי בוואטסאפ'
            checked={enabled}
            disabled={pending}
            onChange={(e) => toggle(e.target.checked)}
          />
        </span>
      </div>

      {error && (
        <p role='alert' className='mt-2 rounded-md bg-error-bg px-3 py-2 text-[13px] leading-snug text-error-text'>
          {error}
        </p>
      )}
    </div>
  )
}
