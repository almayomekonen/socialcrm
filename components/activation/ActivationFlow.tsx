'use client'

import { useState } from 'react'
import { useActivationController } from '@/lib/activation/useActivationController'
import ActivationScreen from '@/components/activation/ActivationScreen'
import { DESKTOP_HINT_COPY } from '@/lib/activation/activationCopy'
import { copyToClipboard } from '@/lib/clipboard'
import type { FacebookPage } from '@/lib/activation/activationState'

const LOGIN_URL = 'https://getsocialcrm.com'

export default function ActivationFlow({
  initialPages,
  alreadyConnected,
}: {
  initialPages: FacebookPage[]
  alreadyConnected: boolean
}) {
  const { machine, startOAuth, selectPage, retry, continueDesktop } = useActivationController({
    initialPages,
    alreadyConnected,
  })

  return (
    <div
      dir='rtl'
      role='dialog'
      aria-label='הפעלת SocialCRM'
      className='fixed inset-0 z-9999 flex items-center justify-center overflow-hidden px-6 desktop:hidden'
      style={{
        background: 'radial-gradient(ellipse 120% 80% at 50% 0%, #0c0a1f 0%, #06081a 50%, #04050f 100%)',
        touchAction: 'none',
        overscrollBehavior: 'none',
      }}
    >
      {alreadyConnected ? (
        <ActivatedDesktopHint />
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
  )
}

function ActivatedDesktopHint() {
  const [copied, setCopied] = useState(false)
  async function copy() {
    const ok = await copyToClipboard(LOGIN_URL)
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
