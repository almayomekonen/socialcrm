'use client'

import { useState, useTransition } from 'react'
import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import { Checkbox } from '@/lib/form'
import { CARD_STORAGE_CONSENT_LABEL } from '@/lib/payments/cardTrial/terms'
import { cancelRenewal, resumeRenewal } from '@/actions/subscription'
import { startCardSetup } from '@/actions/paymentMethod'
import { CARD_TRIAL_AMOUNT } from '@/lib/payments/cardTrial/terms'

/**
 * Cancel / resume / replace card for a card-token subscription.
 *
 * HONEST ABOUT A CHARGE ALREADY SENT. Cancelling stops every charge that has
 * not been dispatched. If one is already with Grow the server says so, and this
 * says exactly that — it does not claim "no charge will be made", and it does
 * not promise a refund (owner decision D1 is open).
 *
 * A subscription whose access already ended cannot be resumed silently: the
 * server answers reactivation_required and the customer is sent to the
 * reactivation flow, where the terms are accepted again.
 */

type Props = {
  cancelAtPeriodEnd: boolean
  /** Pro from an explicit grant: no renewal to stop, no cancellation to make. */
  granted?: boolean
  /** True when a charge is already with Grow and cannot be stopped. */
  chargeInProgress?: boolean
  onReplaceRedirect?: (url: string) => void
}

export default function CardBillingControls({ cancelAtPeriodEnd, granted = false, chargeInProgress = false, onReplaceRedirect }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [storageAccepted, setStorageAccepted] = useState(false)
  const [pending, startTransition] = useTransition()
  const [notice, setNotice] = useState<string | null>(chargeInProgress ? 'החיוב כבר נשלח לעיבוד ואי אפשר לעצור אותו. נעדכן ברגע שתתקבל תשובה.' : null)
  const [error, setError] = useState<string | null>(null)

  const run = (action: () => Promise<{ ok: true; chargeInProgress?: true } | { error: string }>, onDone?: () => void) =>
    startTransition(async () => {
      setError(null)
      const res = await action().catch(() => ({ error: 'network' }) as const)
      if ('error' in res) {
        setError(
          res.error === 'reactivation_required'
            ? 'הגישה כבר הסתיימה. כדי לחדש יש לאשר אמצעי תשלום מחדש בעמוד הכניסה למערכת.'
            : res.error === 'no_subscription'
              ? 'לא נמצא מנוי פעיל'
              : 'אירעה שגיאה, נסו שוב',
        )
        return
      }
      setNotice(res.chargeInProgress ? 'הביטול נרשם. החיוב האחרון כבר נשלח לעיבוד ואי אפשר לעצור אותו — נעדכן ברגע שתתקבל תשובה.' : null)
      onDone?.()
      window.location.reload()
    })

  /**
   * Replacing a card puts a NEW card on file, so it needs the same explicit
   * storage consent as saving the first one. The button therefore opens the
   * consent step rather than calling straight through — a bare click cannot
   * stand in for a permission the customer has to give.
   */
  const replaceCard = (acceptedCardStorage: boolean) =>
    startTransition(async () => {
      setError(null)
      const res = await startCardSetup({ purpose: 'card_update', acceptedCardStorage }).catch(() => ({ error: 'network' }) as const)
      if ('error' in res) {
        setError('לא הצלחנו לפתוח את דף התשלום. נסו שוב בעוד רגע.')
        return
      }
      if (onReplaceRedirect) onReplaceRedirect(res.url)
      else window.location.assign(res.url)
    })

  if (replacing) {
    return (
      <div className='flex flex-col gap-3'>
        <p className='text-sm text-gray-700'>הכרטיס החדש יישמר במקום הקיים, והחיוב החודשי יימשך ממנו.</p>
        <Checkbox
          lbl={CARD_STORAGE_CONSENT_LABEL}
          checked={storageAccepted}
          onChange={(e) => setStorageAccepted(e.target.checked)}
        />
        {error && (
          <p className='text-sm text-red-500' role='alert'>
            {error}
          </p>
        )}
        <div className='flex gap-2'>
          <Btn
            variant='solid'
            lbl={pending ? 'טוען...' : 'המשך להחלפת הכרטיס'}
            disabled={pending || !storageAccepted}
            onClick={() => replaceCard(storageAccepted)}
          />
          <Btn variant='outline' lbl='חזרה' disabled={pending} onClick={() => setReplacing(false)} />
        </div>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-2'>
      {notice && (
        <p className='text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2' role='status'>
          {notice}
        </p>
      )}
      {error && (
        <p className='text-sm text-red-500' role='alert'>
          {error}
        </p>
      )}
      <div className='flex items-center gap-2 flex-wrap'>
        {granted ? (
          /* The card is real and replaceable; the subscription actions beside it
             are not — there is no renewal to resume and no charge to cancel
             before. Offering either would act on a subscription that does not
             exist. */
          <Btn variant='outline' lbl='החלפת כרטיס' disabled={pending} onClick={() => setReplacing(true)} />
        ) : cancelAtPeriodEnd ? (
          <Btn variant='solid' lbl={pending ? 'טוען...' : 'חידוש המנוי'} disabled={pending} onClick={() => run(resumeRenewal)} />
        ) : (
          <>
            <Btn variant='outline' lbl='החלפת כרטיס' disabled={pending} onClick={() => setReplacing(true)} />
            <Btn variant='ghost' lbl='ביטול לפני החיוב' disabled={pending} onClick={() => setConfirming(true)} />
          </>
        )}
      </div>

      <ModalPop open={confirming} onClose={() => !pending && setConfirming(false)} label='ביטול המנוי' pos='middle' className='w-[min(90vw,28rem)]'>
        <div dir='rtl' className='flex flex-col gap-4 p-1'>
          <h2 className='text-xl font-bold'>לבטל את המשך המנוי?</h2>
          <p className='text-sm text-gray-700'>
            {chargeInProgress
              ? `חיוב אחד כבר נשלח לעיבוד ואי אפשר לעצור אותו. מעבר לכך לא יבוצעו חיובים נוספים, והגישה נמשכת עד סוף התקופה ששולמה.`
              : `לא יבוצע חיוב של ₪${CARD_TRIAL_AMOUNT}. הגישה נמשכת עד סוף התקופה הנוכחית, והלידים והנתונים שלך יישמרו.`}
          </p>
          <div className='flex items-center gap-2'>
            <Btn variant='solid' lbl={pending ? 'טוען...' : 'ביטול המנוי'} disabled={pending} onClick={() => run(cancelRenewal, () => setConfirming(false))} />
            <Btn variant='outline' lbl='חזרה' disabled={pending} onClick={() => setConfirming(false)} />
          </div>
        </div>
      </ModalPop>
    </div>
  )
}
