'use client'

import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { Input, Checkbox } from '@/lib/form'
import { startCardSetup } from '@/actions/paymentMethod'
import { trackTrialStartClicked, trackTrialStartFailed } from '@/actions/trial'
import { CARD_TRIAL_CONSENT_LABEL, cardTrialDisclosureLines } from '@/lib/payments/cardTrial/terms'
import type { PaymentMethodPurpose } from '@/db/payments/paymentMethods'

/**
 * Card setup, before anything is granted.
 *
 * TWO CONSENTS, NEVER CONFLATED. The checkbox here is agreement to the
 * SUBSCRIPTION — automatic monthly billing after the trial — and it is recorded
 * with its terms version. Grow's own page separately asks the customer to
 * approve SAVING the card; that consent is Grow's and is not repeated here.
 *
 * Nothing on this screen starts a trial: the CTA opens Grow's payment page, and
 * only the verified callback activates anything. The submit button is disabled
 * while a setup is being opened, so one customer cannot leave two live setups.
 */

const ERRORS: Record<string, string> = {
  unauthorized: 'רק מנהל החשבון יכול להוסיף אמצעי תשלום',
  not_eligible: 'לא ניתן להפעיל את תקופת הניסיון עבור החשבון הזה',
  provider_unavailable: 'לא הצלחנו לפתוח את דף התשלום. נסו שוב בעוד רגע.',
  terms_required: 'יש לאשר את תנאי המנוי כדי להמשיך',
}

export type CardTrialSetupFormProps = {
  purpose: PaymentMethodPurpose
  defaultFullName?: string
  submitLabel: string
  /** Injected in tests; defaults to a real navigation to Grow's hosted page. */
  onRedirect?: (url: string) => void
}

export default function CardTrialSetupForm({ purpose, defaultFullName = '', submitLabel, onRedirect }: CardTrialSetupFormProps) {
  const [fullName, setFullName] = useState(defaultFullName)
  const [phone, setPhone] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<{ field: 'fullName' | 'phone' | null; message: string } | null>(null)

  async function submit() {
    if (pending) return
    setPending(true)
    setError(null)
    trackTrialStartClicked().catch(() => {})
    try {
      const res = await startCardSetup({ purpose, fullName, phone, acceptedTerms: accepted })
      if ('error' in res) {
        setError({
          field: res.error === 'invalid_holder' ? res.field : null,
          message: res.error === 'invalid_holder' ? res.message : (ERRORS[res.error] ?? 'אירעה שגיאה, נסו שוב'),
        })
        trackTrialStartFailed(res.error === 'unauthorized' ? 'unauthorized' : 'unknown').catch(() => {})
        setPending(false)
        return
      }
      // Leaving for Grow's page. `pending` stays true: this view is going away.
      if (onRedirect) onRedirect(res.url)
      else window.location.assign(res.url)
    } catch {
      setError({ field: null, message: 'אירעה שגיאה ברשת, נסו שוב' })
      trackTrialStartFailed('network').catch(() => {})
      setPending(false)
    }
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='grid grid-cols-2 gap-3 mobile:grid-cols-1'>
        <Input
          lbl='שם מלא כפי שמופיע בכרטיס'
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          autoComplete='cc-name'
          error={error?.field === 'fullName' ? error.message : undefined}
        />
        <Input
          lbl='טלפון נייד'
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode='tel'
          autoComplete='tel'
          error={error?.field === 'phone' ? error.message : undefined}
        />
      </div>

      <div className='rounded-lg border border-gray-200 bg-gray-50 p-3 flex flex-col gap-1.5'>
        {cardTrialDisclosureLines().map((line) => (
          <p key={line} className='text-sm text-gray-700 leading-snug'>
            {line}
          </p>
        ))}
      </div>

      <div className='flex flex-col gap-1.5'>
        <Checkbox lbl={CARD_TRIAL_CONSENT_LABEL} checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
        <a href='/terms' target='_blank' rel='noreferrer' className='text-xs text-gray-500 underline self-start'>
          תנאי השימוש
        </a>
      </div>

      {error && !error.field && (
        <p className='text-sm text-red-500' role='alert'>
          {error.message}
        </p>
      )}

      <Btn
        variant='solid'
        size='large'
        className='w-full justify-center'
        lbl={pending ? 'רק רגע...' : submitLabel}
        onClick={submit}
        disabled={pending}
      />
      <p className='text-xs text-gray-500 text-center -mt-1'>הזנת פרטי הכרטיס מתבצעת בעמוד המאובטח של Grow.</p>
    </div>
  )
}
