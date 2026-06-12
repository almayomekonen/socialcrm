'use client'

import { Btn } from '@/lib/btns/Btn'
import { PRICING, ANNUAL_MONTHLY_EQUIVALENT, ANNUAL_SAVINGS } from '@/lib/pricing'

/**
 * Rendered by the (app) layout INSTEAD of children when trial status is
 * TRIAL_EXPIRED. Deliberately non-punitive: the user's data is preserved and
 * the copy says so — "your system is waiting", never "you are blocked".
 */
export default function TrialExpiredScreen() {
  return (
    // div, not <main>: the root layout already provides the page's single
    // main landmark — nesting a second one is an a11y violation.
    <div className='flex h-dvh items-center justify-center bg-gray-50 p-4'>
      <div className='flex flex-col gap-5 w-full max-w-[420px] bg-white border border-gray-200 rounded-lg p-8 shadow-2xl'>
        <div>
          <h1 className='text-xl font-bold leading-snug'>המערכת שלך מחכה לך</h1>
          <p className='text-sm text-gray-600 mt-2'>
            הלידים והנתונים שלך נשמרו בדיוק כפי שהשארת אותם. כדי להמשיך לעבוד יש לשדרג.
          </p>
        </div>

        <div className='bg-gray-50 border border-gray-200 rounded-lg px-4 py-3'>
          <p className='text-base font-semibold'>Pro · ₪{PRICING.monthly} לחודש</p>
          <p className='text-xs text-gray-600 mt-0.5'>
            או ₪{PRICING.annual} לשנה (₪{ANNUAL_MONTHLY_EQUIVALENT} לחודש בלבד) — חיסכון ₪{ANNUAL_SAVINGS} בשנה
          </p>
          <p className='text-xs text-gray-600 mt-0.5'>לידים ללא הגבלה · כל הנתונים שלך שמורים</p>
        </div>

        <Btn
          variant='solid'
          size='large'
          lbl='שדרג עכשיו'
          onClick={() => {
            window.location.href = '/api/payments/upgrade?source=trial_expired_screen'
          }}
        />
      </div>
    </div>
  )
}
