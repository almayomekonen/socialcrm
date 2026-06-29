'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useActivationController } from '@/lib/activation/useActivationController'
import ActivationScreen from '@/components/activation/ActivationScreen'
import ActivationBrand, { ACTIVATION_BG } from '@/components/activation/ActivationBrand'
import ActivationVideoPanel from '@/components/activation/ActivationVideoPanel'
import { DESKTOP_HINT_COPY } from '@/lib/activation/activationCopy'
import { completeOnboarding } from '@/actions/activation'
import { copyToClipboard } from '@/lib/clipboard'

const LOGIN_URL = 'https://getsocialcrm.com'
const DESKTOP_QUERY = '(min-width: 1000px)'

/**
 * The single activation experience — one route, one controller, one FSM. Only
 * the layout adapts: desktop is a split (activation ~55% / video ~45%), mobile
 * is stacked (video on top, activation below). No progress indicator, no skip.
 */
export default function ActivationExperience() {
  const router = useRouter()
  const { machine, alreadyConnected, startOAuth, selectPage, retry, continueDesktop } = useActivationController()
  const navigatedRef = useRef(false)

  const done = machine.status === 'activationCompleted' || alreadyConnected === true

  // Desktop: the dashboard is the reward. Once onboarding is complete, ensure the
  // flag is set (idempotent — covers the rare already-connected case too) and then
  // navigate after a brief "system on" beat. Mobile keeps the continue-on-desktop
  // terminal because the CRM itself is desktop-only.
  useEffect(() => {
    if (!done || navigatedRef.current) return
    if (typeof window === 'undefined' || !window.matchMedia(DESKTOP_QUERY).matches) return
    navigatedRef.current = true
    ;(async () => {
      await completeOnboarding()
      setTimeout(() => router.push('/dashboard'), 1200)
    })()
  }, [done, router])

  return (
    <div
      dir='rtl'
      role='dialog'
      aria-label='הפעלת SocialCRM'
      className='min-h-dvh w-full'
      style={{ background: ACTIVATION_BG }}
    >
      <div className='flex min-h-dvh flex-col desktop:flex-row'>
        {/* Activation panel — leading (right) side in RTL on desktop; below the video on mobile */}
        <div className='order-2 flex items-center justify-center px-6 py-10 desktop:order-1 desktop:basis-[55%]'>
          <div className='flex w-full max-w-[460px] flex-col items-center gap-7 text-center'>
            <div className='desktop:hidden'>
              <ActivationBrand />
            </div>
            <div className='hidden desktop:block'>
              <ActivationBrand width={440} />
            </div>

            {alreadyConnected === true ? (
              <ActivatedHint onCopy={continueDesktop} />
            ) : (
              <ActivationScreen
                machine={machine}
                onCta={startOAuth}
                onSelect={selectPage}
                onRetry={retry}
                onContinue={continueDesktop}
              />
            )}
          </div>
        </div>

        {/* Video — left on desktop, stacked on top on mobile */}
        <ActivationVideoPanel className='order-1 h-[36vh] desktop:order-2 desktop:h-auto desktop:min-h-dvh desktop:basis-[45%]' />
      </div>
    </div>
  )
}

function ActivatedHint({ onCopy }: { onCopy: () => Promise<boolean> }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    const ok = await onCopy()
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }
  }
  return (
    <div className='flex flex-col items-center gap-5 text-center'>
      <h1 className='text-[24px] font-bold text-white'>{DESKTOP_HINT_COPY.heading}</h1>
      <p className='max-w-[300px] text-[14px] text-white/65'>{DESKTOP_HINT_COPY.body}</p>
      {/* Desktop auto-redirects to the dashboard; this is the mobile terminal. */}
      <button onClick={copy} className='text-[13px] text-white/70 underline'>
        {copied ? 'הקישור הועתק' : DESKTOP_HINT_COPY.ctaLabel}
      </button>
    </div>
  )
}
