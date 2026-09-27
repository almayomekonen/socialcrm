'use client'

import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { Input, Checkbox } from '@/lib/form'
import { startCardSetup } from '@/actions/paymentMethod'
import { trackTrialStartClicked, trackTrialStartFailed } from '@/actions/trial'
import {
  entitledCardAddLines,
  CARD_TRIAL_CONSENT_LABEL,
  CARD_TRIAL_CONSENT_LINK_TEXT,
  CARD_STORAGE_CONSENT_LABEL,
  cardTrialDisclosureLines,
  CARD_TRIAL_AMOUNT,
} from '@/lib/payments/cardTrial/terms'
import { TRIAL_LENGTH_DAYS } from '@/lib/trial'
import type { PaymentMethodPurpose } from '@/db/payments/paymentMethods'

/**
 * Card setup, before anything is granted.
 *
 * TWO CONSENTS, NEVER CONFLATED, and both given HERE:
 *   1. agreement to the SUBSCRIPTION — automatic monthly billing after the
 *      trial — recorded with its terms version;
 *   2. permission to STORE the card with Grow and charge it later.
 *
 * The second used to be left to Grow's own page. Grow's integration guidance is
 * that it must be asked explicitly in our interface too, so it is a separate
 * checkbox: ticking one must never be read as agreeing to the other.
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
  card_storage_consent_required: 'יש לאשר את שמירת פרטי הכרטיס כדי להמשיך',
}

export type CardTrialSetupFormProps = {
  purpose: PaymentMethodPurpose
  /**
   * 'entitled' = an account that already has access adding a first card. It is
   * shown no trial and no ₪89, because it has neither, and it is asked only for
   * the card-storage consent.
   */
  mode?: 'subscription' | 'entitled'
  defaultFullName?: string
  /** Prefill from an abandoned attempt. Never a consent — those always start unticked. */
  defaultPhone?: string
  submitLabel: string
  /** Injected in tests; defaults to a real navigation to Grow's hosted page. */
  onRedirect?: (url: string) => void
}

/**
 * The subscription consent, with "תנאי השימוש והתקנון" as a link to /terms.
 *
 * The sentence is SLICED from CARD_TRIAL_CONSENT_LABEL rather than retyped, so
 * what the customer reads cannot drift from what is recorded against
 * CARD_TRIAL_TERMS_VERSION.
 *
 * Clicking the link does not tick the box. Per the HTML spec a label runs no
 * activation behaviour for events targeted at an interactive descendant, and an
 * <a href> is interactive content; stopPropagation is belt-and-braces for any
 * React handler added to the row later. Neither prevents the navigation.
 */
function SubscriptionConsentLabel() {
  const [before, after] = CARD_TRIAL_CONSENT_LABEL.split(CARD_TRIAL_CONSENT_LINK_TEXT)
  return (
    <>
      {before}
      <a
        href='/terms'
        target='_blank'
        rel='noreferrer'
        onClick={(e) => e.stopPropagation()}
        className='text-primary-text underline underline-offset-2'
      >
        {CARD_TRIAL_CONSENT_LINK_TEXT}
      </a>
      {after}
    </>
  )
}


/**
 * Bolds the trial length and the price WITHIN the approved disclosure lines.
 *
 * The text is not rewritten, shortened, reordered or hidden: this splits each
 * line on tokens that already occur in it and wraps them in <strong>. The
 * sentence a customer reads is still the sentence recorded against
 * CARD_TRIAL_TERMS_VERSION, character for character — the verification hold and
 * the cancellation line included, both rendered in full.
 */
function EmphasisedLine({ line }: { line: string }) {
  const tokens = [`${TRIAL_LENGTH_DAYS} ימים`, `₪${CARD_TRIAL_AMOUNT}`]
  const pattern = new RegExp(`(${tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`)
  return (
    <p className='text-sm leading-relaxed text-gray-700'>
      {line.split(pattern).map((part, i) =>
        tokens.includes(part) ? (
          <strong key={i} className='font-semibold text-gray-900'>
            {part}
          </strong>
        ) : (
          part
        ),
      )}
    </p>
  )
}

export default function CardTrialSetupForm({ purpose, mode = 'subscription', defaultFullName = '', defaultPhone = '', submitLabel, onRedirect }: CardTrialSetupFormProps) {
  const [fullName, setFullName] = useState(defaultFullName)
  const [phone, setPhone] = useState(defaultPhone)
  const [accepted, setAccepted] = useState(false)
  const [storageAccepted, setStorageAccepted] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<{ field: 'fullName' | 'phone' | null; message: string } | null>(null)

  async function submit() {
    if (pending) return
    setPending(true)
    setError(null)
    trackTrialStartClicked().catch(() => {})
    try {
      const res = await startCardSetup({ purpose, fullName, phone, acceptedTerms: accepted, acceptedCardStorage: storageAccepted })
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

      <div className='flex flex-col gap-2 rounded-xl bg-primary-tint/60 p-4 ring-1 ring-info-border/60'>
        {(mode === 'entitled' ? entitledCardAddLines() : cardTrialDisclosureLines()).map((line) => (
          <EmphasisedLine key={line} line={line} />
        ))}
      </div>

      <div className='flex flex-col gap-1.5'>
        {/* An entitled account is agreeing to nothing about a subscription,
            so it is not asked to. needsTerms() is false for this purpose. */}
        {mode === 'subscription' && (
          <Checkbox
            className='items-start rounded-none border-0 border-b border-gray-100 bg-transparent px-1 py-3 last:border-b-0 has-[:checked]:bg-transparent'
            lbl={<SubscriptionConsentLabel />}
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
          />
        )}
        <Checkbox
          className='items-start rounded-none border-0 border-b border-gray-100 bg-transparent px-1 py-3 last:border-b-0 has-[:checked]:bg-transparent'
          lbl={CARD_STORAGE_CONSENT_LABEL}
          checked={storageAccepted}
          onChange={(e) => setStorageAccepted(e.target.checked)}
        />
        {/*
          Grow's site review could not find a link to the תקנון on the payment
          screen. It was here, but at text-xs in grey under two full-width
          consent rows it read as a footnote. Same position, same route —
          legible now, and it names what it opens.

          No `required` attribute on the checkboxes above: this screen has no
          <form>, it submits through a click handler, so the attribute would be
          inert decoration. Both consents are enforced on the SERVER
          (terms_required / card_storage_consent_required) and refused there,
          which is the guarantee that actually holds.
        */}
        <a
          href='/terms'
          target='_blank'
          rel='noreferrer'
          className='tap-44 self-start text-sm font-medium text-primary-text underline underline-offset-2'
        >
          קריאת תנאי השימוש והתקנון
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
