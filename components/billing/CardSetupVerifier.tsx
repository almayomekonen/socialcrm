'use client'

import { useEffect, useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { getCardSetupStatus } from '@/actions/paymentMethod'
import type { CardSetupState } from '@/lib/payments/cardTrial/setupStatus'
import { formatBillingDate } from '@/lib/payments/cardTrial/firstCharge'
import { CARD_TRIAL_AMOUNT } from '@/lib/payments/cardTrial/terms'
import type { UiLocale } from '@/lib/i18n/config'
import { rtlOrRegionAttrs } from '@/lib/i18n/preLoginLocale'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'

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
  /** Where this setup was started from; every exit returns there. A fixed path, never from the query string. */
  returnTo?: string
  navigate?: (url: string) => void
  /**
   * Display language (i18n Phase F5) — the page's `ui_locale` hint. Words only:
   * the polling, its bounds and every navigation are the same in every language.
   */
  locale?: UiLocale
}

const HEADLINE: Record<Props['purpose'], MessageKey> = {
  card_trial: 'trial.verifier.headline.card_trial',
  card_update: 'trial.verifier.headline.card_update',
  reactivate: 'trial.verifier.headline.reactivate',
}

const assignLocation = (url: string) => window.location.assign(url)

export default function CardSetupVerifier({ purpose, poll = getCardSetupStatus, locale = 'he', returnTo, navigate = assignLocation }: Props) {
  const homeHref = returnTo ?? '/dashboard'
  const billingHref = returnTo ?? '/settings/update_payment'
  const t = translatorFor(locale)
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
      if (next?.state === 'confirmed' && returnTo) navigate(returnTo)
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
  }, [poll, returnTo, navigate])

  const chargeDate = formatBillingDate(status.firstChargeAt)
  const amount = String(CARD_TRIAL_AMOUNT)

  return (
    <div {...rtlOrRegionAttrs(locale)} className='w-full max-w-md bg-white rounded-lg border border-gray-200 p-6 flex flex-col gap-4 text-center'>
      {status.state === 'confirmed' ? (
        <>
          <h1 className='text-xl font-bold'>{t(HEADLINE[purpose])}</h1>
          {status.sandbox && (
            <p className='text-sm font-semibold text-amber-800' role='status'>
              {t('trial.verifier.sandbox')}
            </p>
          )}
          {purpose === 'card_trial' && chargeDate && (
            <p className='text-sm text-gray-600'>
              {status.chargesEnabled
                ? t('trial.verifier.chargeOn', { amount, date: chargeDate })
                : t('trial.verifier.chargeOff', { date: chargeDate })}
            </p>
          )}
          {purpose !== 'card_trial' && <p className='text-sm text-gray-600'>{t('trial.verifier.saved')}</p>}
          <Btn variant='solid' size='large' lbl={t('trial.verifier.enter')} className='w-full justify-center' onClick={() => window.location.assign(homeHref)} />
        </>
      ) : status.state === 'failed' ? (
        <>
          <h1 className='text-xl font-bold'>{t('trial.verifier.failedTitle')}</h1>
          <p className='text-sm text-gray-600'>{t('trial.verifier.failedBody')}</p>
          <Btn
            variant='solid'
            size='large'
            lbl={t('trial.verifier.toBilling')}
            className='w-full justify-center'
            onClick={() => window.location.assign(billingHref)}
          />
        </>
      ) : timedOut ? (
        <>
          <h1 className='text-xl font-bold'>{t('trial.verifier.timedOutTitle')}</h1>
          <p className='text-sm text-gray-600'>
            {status.callbackReceived
              ? t('trial.verifier.timedOutCallback')
              : t('trial.verifier.timedOutNoCallback')}
          </p>
          <p className='text-sm text-gray-600'>{t('trial.verifier.timedOutNote')}</p>
          <div className='flex flex-col gap-2'>
            <Btn variant='solid' size='large' lbl={t('trial.verifier.toBilling')} className='w-full justify-center' onClick={() => window.location.assign(billingHref)} />
            <Btn variant='outline' size='large' lbl={t('trial.verifier.back')} className='w-full justify-center' onClick={() => window.location.assign(homeHref)} />
          </div>
        </>
      ) : (
        <>
          <h1 className='text-xl font-bold'>{t('trial.verifier.verifyingTitle')}</h1>
          <p className='text-sm text-gray-600' role='status'>
            {t('trial.verifier.verifyingBody')}
          </p>
        </>
      )}
    </div>
  )
}
