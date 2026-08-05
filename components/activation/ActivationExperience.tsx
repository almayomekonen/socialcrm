'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useActivationController } from '@/lib/activation/useActivationController'
import ActivationScreen from '@/components/activation/ActivationScreen'
import ActivationHero from '@/components/activation/ActivationHero'
import ActivationVideoPanel from '@/components/activation/ActivationVideoPanel'
import Icon from '@/lib/Icon'
import { completeOnboarding } from '@/actions/activation'

const DESKTOP_QUERY = '(min-width: 1000px)'
const PANEL_LIGHT = 'linear-gradient(165deg, #ffffff 0%, #f7f5fc 55%, #f1edfb 100%)'

const KEYFRAMES = `
@keyframes act-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-12px) } }
@keyframes act-breathe { 0%,100% { opacity: .55; transform: scale(1) } 50% { opacity: 1; transform: scale(1.06) } }
`

/**
 * The desktop activation experience — one route, one controller, one FSM. A
 * cinematic split: a clean light activation surface (hero + CTA) beside a
 * full-bleed immersive product video, feathered together at the seam. No
 * progress indicator, no skip.
 *
 * Desktop only. Phones are routed to MobileHandoff by app/activate/page.tsx
 * before this component is ever reached, so there is no mobile branch here and
 * no mobile markup is shipped to any client (architecture-rules.md §9).
 */
export default function ActivationExperience() {
  const router = useRouter()
  const { machine, alreadyConnected, startOAuth, selectPage, retry, continueDesktop } = useActivationController()
  const navigatedRef = useRef(false)

  const done = machine.status === 'activationCompleted' || alreadyConnected === true

  useEffect(() => {
    if (!done || navigatedRef.current) return
    if (typeof window === 'undefined' || !window.matchMedia(DESKTOP_QUERY).matches) return
    navigatedRef.current = true
    ;(async () => {
      await completeOnboarding()
      setTimeout(() => router.push('/dashboard'), 1300)
    })()
  }, [done, router])

  // `alreadyConnected` resolves to `done` above, which renders DesktopComplete
  // instead of this — so the screen below is only ever the activation flow.
  const screen = (
    <ActivationScreen
      machine={machine}
      onCta={startOAuth}
      onSelect={selectPage}
      onRetry={retry}
      onContinue={continueDesktop}
    />
  )

  return (
    <div dir='rtl' role='dialog' aria-label='הפעלת SocialCRM' className='relative min-h-dvh w-full overflow-hidden'>
      <style>{KEYFRAMES}</style>

      {/* DESKTOP — light activation surface (leading/right in RTL) + full-bleed video (left).
          Phones never reach this component at all: app/activate/page.tsx picks
          MobileHandoff on the server. The desktop: breakpoint below is kept as a
          viewport backstop only (architecture-rules.md §9). */}
      <div className='hidden min-h-dvh desktop:flex'>
        <section
          className='relative z-10 flex basis-[48%] flex-col items-center justify-center gap-4 px-12 py-14'
          style={{
            background: PANEL_LIGHT,
            // Whisper-soft join: a barely-there feather at the edge meeting the
            // dark video, so the halves read as one composition. Almost invisible.
            boxShadow: 'inset 24px 0 64px -48px rgba(15,16,36,0.4)',
          }}
        >
          <ActivationHero />
          <div className='flex w-full max-w-[440px] flex-col items-center gap-7 text-center'>{done ? <DesktopComplete /> : screen}</div>
        </section>
        <section className='relative basis-[52%]'>
          <ActivationVideoPanel className='absolute inset-0 h-full w-full' />
        </section>
      </div>

    </div>
  )
}

function DesktopComplete() {
  return (
    <div className='flex flex-col items-center gap-5 text-center'>
      <Icon name='spinner' className='size-8 animate-spin bg-[#3f20f5]' />
      <h1 className='text-[24px] font-bold text-[#0f1024]'>סביבת העבודה שלך מוכנה 🎉</h1>
      <p className='max-w-[320px] text-[14px] leading-[1.7] text-gray-500'>
        חשבון ה-Meta שלך חובר בהצלחה.
        <br />
        אנחנו מעבירים אותך למערכת...
      </p>
    </div>
  )
}
