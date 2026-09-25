'use client'

import { useEffect, useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { getCardSetupStatus } from '@/actions/paymentMethod'
import type { CardSetupState } from '@/lib/payments/cardTrial/setupStatus'
import { formatBillingDate } from '@/lib/payments/cardTrial/firstCharge'
import { CARD_TRIAL_AMOUNT } from '@/lib/payments/cardTrial/terms'

/**
 * What the customer sees after Grow's page sends them back.
 *
 * LANDING HERE PROVES NOTHING. This screen never activates anything and never
 * claims success: it asks the SERVER, which only moves out of "verifying" when
 * the Grow callback has been verified. Polling is bounded — when the answer has
 * not arrived in time the customer gets a real next step instead of a spinner
 * that never ends (which is exactly what happens while provider verification is
 * still disabled).
 */

const POLL_INTERVAL_MS = 2_000
const MAX_WAIT_MS = 30_000

type Props = {
  purpose: 'card_trial' | 'card_update' | 'reactivate'
  /** Injected in tests. */
  poll?: () => Promise<CardSetupState>
}

const HEADLINE: Record<Props['purpose'], string> = {
  card_trial: 'תקופת הניסיון הופעלה',
  card_update: 'הכרטיס עודכן',
  reactivate: 'המנוי חודש',
}

export default function CardSetupVerifier({ purpose, poll = getCardSetupStatus }: Props) {
  const [status, setStatus] = useState<CardSetupState>({ state: 'verifying', callbackReceived: false, firstChargeAt: null, chargesEnabled: false, sandbox: false })
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    let active = true
    const startedAt = Date.now()
    let timer: ReturnType<typeof setTimeout>

    const tick = async () => {
      const next = await poll().catch(() => null)
      if (!active) return
      if (next) setStatus(next)
      if (next && next.state !== 'verifying') return
      if (Date.now() - startedAt >= MAX_WAIT_MS) {
        setTimedOut(true)
        return
      }
      timer = setTimeout(tick, POLL_INTERVAL_MS)
    }
    tick()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [poll])

  const chargeDate = formatBillingDate(status.firstChargeAt)

  return (
    <div dir='rtl' className='w-full max-w-md bg-white rounded-lg border border-gray-200 p-6 flex flex-col gap-4 text-center'>
      {status.state === 'confirmed' ? (
        <>
          <h1 className='text-xl font-bold'>{HEADLINE[purpose]}</h1>
          {status.sandbox && (
            <p className='text-sm font-semibold text-amber-800' role='status'>
              בדיקת סליקה בסביבת Sandbox — לא בוצעה עסקה אמיתית ולא נשמר כרטיס אמיתי.
            </p>
          )}
          {purpose === 'card_trial' && chargeDate && (
            <p className='text-sm text-gray-600'>
              {status.chargesEnabled
                ? `הכרטיס נשמר. החיוב הראשון, ₪${CARD_TRIAL_AMOUNT}, יתבצע ב־${chargeDate}. אפשר לבטל לפני כן בעמוד המנוי.`
                : `הכרטיס נשמר. תקופת הניסיון מסתיימת ב־${chargeDate}; חיוב אוטומטי אינו פעיל כרגע, ולכן לא ייגבה תשלום במועד הזה.`}
            </p>
          )}
          {purpose !== 'card_trial' && <p className='text-sm text-gray-600'>הפרטים נשמרו. אפשר להמשיך לעבוד.</p>}
          <Btn variant='solid' size='large' lbl='כניסה למערכת' className='w-full justify-center' onClick={() => window.location.assign('/dashboard')} />
        </>
      ) : status.state === 'failed' ? (
        <>
          <h1 className='text-xl font-bold'>לא הצלחנו לאמת את הכרטיס</h1>
          <p className='text-sm text-gray-600'>לא בוצע חיוב. אפשר לנסות שוב עם אותו כרטיס או עם כרטיס אחר.</p>
          <Btn
            variant='solid'
            size='large'
            lbl='לעמוד המנוי'
            className='w-full justify-center'
            onClick={() => window.location.assign('/settings/update_payment')}
          />
        </>
      ) : timedOut ? (
        <>
          <h1 className='text-xl font-bold'>האישור עדיין בבדיקה</h1>
          <p className='text-sm text-gray-600'>
            {status.callbackReceived
              ? 'קיבלנו את פרטי הכרטיס ואנחנו מאמתים אותם מול Grow. עדיין לא בוצע חיוב.'
              : 'טרם קיבלנו אישור מחברת הסליקה. עדיין לא בוצע חיוב.'}
          </p>
          <p className='text-sm text-gray-600'>אין צורך להמתין כאן — נעדכן במייל ברגע שהאימות יסתיים, והסטטוס מופיע תמיד בעמוד המנוי.</p>
          <div className='flex flex-col gap-2'>
            <Btn variant='solid' size='large' lbl='לעמוד המנוי' className='w-full justify-center' onClick={() => window.location.assign('/settings/update_payment')} />
            <Btn variant='outline' size='large' lbl='חזרה למערכת' className='w-full justify-center' onClick={() => window.location.assign('/dashboard')} />
          </div>
        </>
      ) : (
        <>
          <h1 className='text-xl font-bold'>רק רגע, מאמתים מול חברת הסליקה</h1>
          <p className='text-sm text-gray-600' role='status'>
            הכרטיס נשמר בצד של Grow ואנחנו מאשרים אותו. לא מבוצע חיוב עבור המנוי בשלב הזה; תיתכן הקפאה זמנית של ₪1 לאימות; לפי Grow היא משתחררת בתוך עד 10 ימים.
          </p>
        </>
      )}
    </div>
  )
}
