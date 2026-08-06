'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import Icon from '@/lib/Icon'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { toast } from '@/lib/toast'

type State = 'not_connected' | 'connected' | 'reauth_required'

type Props = {
  state: State
  email: string | null
  lastError: string | null
}

export default function CalendarConnect({ state, email, lastError }: Props) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [, startTransition] = useTransition()

  async function handleDisconnect() {
    try {
      const res = await fetch('/api/auth/google-calendar/disconnect', { method: 'POST' })
      if (!res.ok) throw new Error('failed')
      toast('success', 'Google Calendar נותק')
      setConfirmOpen(false)
      startTransition(() => router.refresh())
    } catch {
      toast('error', 'הניתוק נכשל. נסה שוב.')
    }
  }

  return (
    <div className='rounded-lg border border-gray-200 bg-white p-6 grid gap-4'>
      <div className='flex items-center gap-2.5'>
        <Icon name='calendar' className='size-7 bg-gray-900' />
        {/* h3: the page owns h1, and "כלים מחוברים" owns the h2 above this card. */}
        <h3 className='text-lg font-bold'>Google Calendar</h3>
        {state === 'connected' && (
          <Icon name='check' type='reg' className='size-4 bg-green-600' />
        )}
      </div>

      {state === 'not_connected' && (
        <>
          <p className='text-gray-600 text-sm leading-relaxed'>
            חבר את חשבון Google שלך כדי לתזמן פגישות עם לידים ולקבל קישורי Google Meet אוטומטית.
          </p>
          <ul className='text-gray-600 text-sm grid gap-1.5 pe-4 list-disc'>
            <li>סינכרון אוטומטי של פגישות ליומן Google</li>
            <li>יצירת קישור Meet אוטומטית לכל פגישה</li>
            <li>ניהול לוח הזמנים בתוך ה-CRM</li>
          </ul>
          <div>
            <Btn
              lbl='חבר את Google Calendar'
              onClick={() => {
                const returnTo = encodeURIComponent(window.location.pathname + window.location.search)
                window.location.href = `/api/auth/google-calendar?returnTo=${returnTo}`
              }}
            />
          </div>
        </>
      )}

      {state === 'connected' && (
        <>
          <p className='text-gray-600 text-sm'>
            מחובר כ-<span className='font-medium text-black'>{email}</span>
          </p>
          <div>
            <Btn lbl='נתק חשבון' variant='outline' onClick={() => setConfirmOpen(true)} />
          </div>
        </>
      )}

      {state === 'reauth_required' && (
        <>
          <div className='rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900'>
            <p className='font-medium'>החיבור ליומן פג.</p>
            <p className='mt-0.5'>יש להתחבר מחדש כדי לסנכרן פגישות חדשות.</p>
            {lastError && <p className='mt-1 text-xs text-amber-700'>פרטים: {lastError}</p>}
          </div>
          <div>
            <Btn
              lbl='חבר מחדש'
              onClick={() => {
                const returnTo = encodeURIComponent(window.location.pathname + window.location.search)
                window.location.href = `/api/auth/google-calendar?returnTo=${returnTo}`
              }}
            />
          </div>
        </>
      )}

      <ConfirmPop
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDisconnect}
        msg={'פגישות קיימות יישארו ב-CRM אך לא יסונכרנו עוד.\nניתן להתחבר שוב בכל עת.'}
        confirmLbl='נתק חשבון'
        destructive
      />
    </div>
  )
}
