'use client'

import { useState } from 'react'
import { useActivationController } from '@/lib/activation/useActivationController'
import ActivationScreen from '@/components/activation/ActivationScreen'
import ActivationBrand, { ACTIVATION_BG } from '@/components/activation/ActivationBrand'
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
      className='fixed inset-0 z-9999 overflow-y-auto desktop:hidden'
      style={{ background: ACTIVATION_BG, overscrollBehavior: 'none' }}
    >
      {/* The brand header is mounted once, above the active screen, so it never
          re-mounts or re-animates between states — the flow feels continuous. */}
      <div className='flex min-h-full flex-col items-center justify-center gap-6 px-6 py-10'>
        <ActivationBrand />
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
