'use client'

import { useState, useTransition } from 'react'
import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import { Checkbox } from '@/lib/form'
import { CARD_STORAGE_CONSENT_LABEL } from '@/lib/payments/cardTrial/terms'
import { cancelRenewal, resumeRenewal } from '@/actions/subscription'
import { startCardSetup } from '@/actions/paymentMethod'
import { CARD_TRIAL_AMOUNT } from '@/lib/payments/cardTrial/terms'
import { useT } from '@/lib/i18n/I18nProvider'
import { untranslatedAttrs } from '@/lib/i18n/config'

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
  const t = useT()
  const he = t.locale === 'he'
  const [confirming, setConfirming] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [storageAccepted, setStorageAccepted] = useState(false)
  const [pending, startTransition] = useTransition()
  const [notice, setNotice] = useState<string | null>(chargeInProgress ? t('settings.payment.controls.inProgress') : null)
  const [error, setError] = useState<string | null>(null)

  const run = (action: () => Promise<{ ok: true; chargeInProgress?: true } | { error: string }>, onDone?: () => void) =>
    startTransition(async () => {
      setError(null)
      const res = await action().catch(() => ({ error: 'network' }) as const)
      if ('error' in res) {
        setError(
          res.error === 'reactivation_required'
            ? t('settings.payment.controls.reactivation')
            : res.error === 'no_subscription'
              ? t('settings.payment.controls.noSubscription')
              : t('settings.payment.controls.error'),
        )
        return
      }
      setNotice(res.chargeInProgress ? t('settings.payment.controls.cancelledInProgress') : null)
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
        setError(t('settings.payment.controls.openFailed'))
        return
      }
      if (onReplaceRedirect) onReplaceRedirect(res.url)
      else window.location.assign(res.url)
    })

  if (replacing) {
    return (
      <div className='flex flex-col gap-3'>
        <p className='text-sm text-gray-700'>{t('settings.payment.controls.replaceIntro')}</p>
        {/* The recorded card-storage consent stays Hebrew (lib/payments/cardTrial/terms.ts, versioned): a Hebrew region outside Hebrew. */}
        <Checkbox
          lbl={he ? CARD_STORAGE_CONSENT_LABEL : <span {...untranslatedAttrs(t.locale)}>{CARD_STORAGE_CONSENT_LABEL}</span>}
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
            lbl={pending ? t('settings.payment.controls.loading') : t('settings.payment.controls.replaceContinue')}
            disabled={pending || !storageAccepted}
            onClick={() => replaceCard(storageAccepted)}
          />
          <Btn variant='outline' lbl={t('settings.payment.controls.back')} disabled={pending} onClick={() => setReplacing(false)} />
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
          <Btn variant='outline' lbl={t('settings.payment.controls.replace')} disabled={pending} onClick={() => setReplacing(true)} />
        ) : cancelAtPeriodEnd ? (
          <Btn variant='solid' lbl={pending ? t('settings.payment.controls.loading') : t('settings.payment.controls.resume')} disabled={pending} onClick={() => run(resumeRenewal)} />
        ) : (
          <>
            <Btn variant='outline' lbl={t('settings.payment.controls.replace')} disabled={pending} onClick={() => setReplacing(true)} />
            <Btn variant='ghost' lbl={t('settings.payment.controls.cancelBefore')} disabled={pending} onClick={() => setConfirming(true)} />
          </>
        )}
      </div>

      <ModalPop open={confirming} onClose={() => !pending && setConfirming(false)} label={t('settings.payment.controls.cancelLabel')} pos='middle' className='w-[min(90vw,28rem)]' translated>
        <div dir={he ? 'rtl' : undefined} className='flex flex-col gap-4 p-1'>
          <h2 className='text-xl font-bold'>{t('settings.payment.controls.cancelTitle')}</h2>
          <p className='text-sm text-gray-700'>
            {chargeInProgress
              ? t('settings.payment.controls.cancelInProgress')
              : t('settings.payment.controls.cancelBody', { amount: `₪${CARD_TRIAL_AMOUNT}` })}
          </p>
          <div className='flex items-center gap-2'>
            <Btn variant='solid' lbl={pending ? t('settings.payment.controls.loading') : t('settings.payment.controls.cancelConfirm')} disabled={pending} onClick={() => run(cancelRenewal, () => setConfirming(false))} />
            <Btn variant='outline' lbl={t('settings.payment.controls.back')} disabled={pending} onClick={() => setConfirming(false)} />
          </div>
        </div>
      </ModalPop>
    </div>
  )
}
