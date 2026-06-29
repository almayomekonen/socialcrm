'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useActivationController } from '@/lib/activation/useActivationController'
import ActivationScreen from '@/components/activation/ActivationScreen'
import ActivationBrand, { ACTIVATION_BG } from '@/components/activation/ActivationBrand'
import ActivationHero from '@/components/activation/ActivationHero'
import ActivationVideoPanel from '@/components/activation/ActivationVideoPanel'
import { DESKTOP_HINT_COPY } from '@/lib/activation/activationCopy'
import { completeOnboarding } from '@/actions/activation'
import { copyToClipboard } from '@/lib/clipboard'

const DESKTOP_QUERY = '(min-width: 1000px)'

// Ambient motion for the whole experience — injected once.
const KEYFRAMES = `
@keyframes act-drift { 0%,100% { transform: translate(0,0) } 50% { transform: translate(26px,-22px) } }
@keyframes act-drift2 { 0%,100% { transform: translate(0,0) } 50% { transform: translate(-22px,18px) } }
@keyframes act-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-12px) } }
@keyframes act-breathe { 0%,100% { opacity: .55; transform: scale(1) } 50% { opacity: 1; transform: scale(1.07) } }
@keyframes act-shimmer { 0% { background-position: 120% 0 } 100% { background-position: -120% 0 } }
`

/**
 * The single activation experience — one route, one controller, one FSM. Desktop
 * is a cinematic, lit split (activation hero + embedded product video); mobile is
 * the stacked brand flow. No progress indicator, no skip.
 */
export default function ActivationExperience() {
  const router = useRouter()
  const { machine, alreadyConnected, startOAuth, selectPage, retry, continueDesktop } = useActivationController()
  const navigatedRef = useRef(false)

  const done = machine.status === 'activationCompleted' || alreadyConnected === true

  // Desktop: the dashboard is the reward. Ensure the onboarding flag is set
  // (idempotent), then enter after a brief "system on" beat. Mobile keeps the
  // continue-on-desktop terminal (the CRM itself is desktop-only).
  useEffect(() => {
    if (!done || navigatedRef.current) return
    if (typeof window === 'undefined' || !window.matchMedia(DESKTOP_QUERY).matches) return
    navigatedRef.current = true
    ;(async () => {
      await completeOnboarding()
      setTimeout(() => router.push('/dashboard'), 1300)
    })()
  }, [done, router])

  const screen =
    alreadyConnected === true ? (
      <ActivatedHint onCopy={continueDesktop} />
    ) : (
      <ActivationScreen
        machine={machine}
        onCta={startOAuth}
        onSelect={selectPage}
        onRetry={retry}
        onContinue={continueDesktop}
      />
    )

  return (
    <div
      dir='rtl'
      role='dialog'
      aria-label='הפעלת SocialCRM'
      className='relative min-h-dvh w-full overflow-hidden'
      style={{ background: ACTIVATION_BG }}
    >
      <style>{KEYFRAMES}</style>

      {/* Layered ambient lighting — what makes the page feel alive and premium. */}
      <div
        className='pointer-events-none absolute -right-40 -top-40 size-[760px] rounded-full'
        style={{
          background: 'radial-gradient(circle, rgba(252,191,73,0.22) 0%, rgba(251,146,60,0.08) 42%, transparent 70%)',
          filter: 'blur(120px)',
          animation: 'act-drift 16s ease-in-out infinite',
        }}
      />
      <div
        className='pointer-events-none absolute -bottom-48 -left-40 size-[680px] rounded-full'
        style={{
          background: 'radial-gradient(circle, rgba(63,32,245,0.26) 0%, rgba(79,91,213,0.10) 45%, transparent 72%)',
          filter: 'blur(120px)',
          animation: 'act-drift2 20s ease-in-out infinite',
        }}
      />
      <div
        className='pointer-events-none absolute inset-0'
        style={{
          background:
            'radial-gradient(ellipse 90% 70% at 50% 50%, transparent 40%, rgba(0,0,0,0.35) 80%, rgba(0,0,0,0.6) 100%)',
        }}
      />

      {/* DESKTOP — cinematic split */}
      <div className='relative z-10 hidden min-h-dvh desktop:flex'>
        {/* Activation (leading/right in RTL) */}
        <div className='flex basis-[52%] flex-col items-center justify-center gap-9 px-14 py-12'>
          <ActivationHero />
          <div className='flex w-full max-w-[440px] flex-col items-center gap-7 text-center'>{screen}</div>
        </div>
        {/* Embedded product video (left in RTL) */}
        <div className='flex basis-[48%] items-center justify-center p-12'>
          <ActivationVideoPanel className='h-full w-full' />
        </div>
      </div>

      {/* MOBILE — stacked */}
      <div className='relative z-10 flex min-h-dvh flex-col items-center justify-center gap-6 px-6 py-10 desktop:hidden'>
        <ActivationBrand />
        {screen}
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
      <button onClick={copy} className='text-[13px] text-white/70 underline'>
        {copied ? 'הקישור הועתק' : DESKTOP_HINT_COPY.ctaLabel}
      </button>
    </div>
  )
}
