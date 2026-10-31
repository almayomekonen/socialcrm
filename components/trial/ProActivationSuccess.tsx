'use client'

import { useEffect, useState } from 'react'
import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import Icon, { type IconNames } from '@/lib/Icon'
import { useActivationCelebration } from './ActivationCelebrationContext'
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey } from '@/lib/i18n/translate'

// Distinct existing icons only — mirrors WelcomeTrialModal's benefit iconography.
const BENEFITS: { icon: IconNames; label: MessageKey }[] = [
  { icon: 'brain', label: 'trial.celebration.benefits.ai' },
  { icon: 'comment-dots', label: 'trial.celebration.benefits.leads' },
  { icon: 'calendar', label: 'trial.celebration.benefits.tools' },
]

/**
 * One-time Pro activation success surface, shown OVER the real TRIAL_ACTIVE
 * workspace. Rendered by the (app) layout only when trialStatus === 'TRIAL_ACTIVE';
 * additionally self-gates on justActivated so it appears only right after a real
 * activation (never on refresh/re-login/navigation). Dismissible — this is NOT
 * an authorization gate: CTA, close control, and Escape all clear the signal.
 */
export default function ProActivationSuccess() {
  const { justActivated, dismiss } = useActivationCelebration()
  const t = useT()

  // Reduced-motion-safe entrance accent: the medallion scales/fades in only for
  // users who allow motion (motion-safe:*). Reduced-motion users get it instantly.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!justActivated) return
    const raf = requestAnimationFrame(() => setShown(true))
    return () => {
      cancelAnimationFrame(raf)
      setShown(false)
    }
  }, [justActivated])

  function close() {
    dismiss()
    // Land the user in the workspace content rather than <body>. Runs after
    // ModalPop's own focus-restore (which targets whatever was focused on open).
    requestAnimationFrame(() => {
      const main = document.getElementById('main-content')
      main?.focus()
    })
  }

  if (!justActivated) return null

  return (
    <ModalPop
      open
      pos='middle'
      onClose={close}
      labelledBy='pro-active-title'
      describedBy='pro-active-sub'
      className='w-[min(90vw,460px)]'
      translated
    >
      <div className='flex flex-col items-center text-center gap-5'>
        <span className='inline-block rounded-full bg-dark text-white text-[10px] font-bold tracking-[0.12em] px-2.5 py-1 select-none'>
          SOCIALCRM PRO
        </span>

        <span
          className={`flex size-14 items-center justify-center rounded-full bg-primary-tint motion-safe:transition motion-safe:duration-500 ease-out ${
            shown ? 'opacity-100 scale-100' : 'opacity-0 scale-90'
          }`}
        >
          <Icon name='circle-check' type='reg' className='size-7 bg-primary' />
        </span>

        <div className='flex flex-col gap-2'>
          <h2 id='pro-active-title' className='text-2xl font-bold leading-snug'>
            {t('trial.celebration.title')}
          </h2>
          <p id='pro-active-sub' className='text-sm text-gray-600'>
            {t('trial.celebration.sub')}
          </p>
        </div>

        <ul className='w-full flex flex-col gap-2.5'>
          {BENEFITS.map((b) => (
            <li
              key={b.label}
              className='flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-start'
            >
              <span className='flex size-8 items-center justify-center rounded-lg flex-none bg-primary-tint'>
                <Icon name={b.icon} type='reg' className='size-4 bg-primary' />
              </span>
              <p className='text-sm font-semibold text-gray-900'>{t(b.label)}</p>
            </li>
          ))}
        </ul>

        <Btn
          variant='solid'
          size='large'
          className='w-full justify-center'
          lbl={t('trial.celebration.cta')}
          onClick={close}
        />
      </div>
    </ModalPop>
  )
}
