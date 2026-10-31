'use client'

import { useEffect, useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { copyToClipboard } from '@/lib/clipboard'
import { DESKTOP_URL, DESKTOP_URL_LABEL } from '@/lib/activation/mobileHandoffCopy'
import { handoffCopyIn } from '@/lib/activation/localizedCopy'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * The one action available on a phone: get the workspace URL onto the other
 * device.
 *
 * Three affordances, deliberately ordered by reliability rather than by novelty:
 *   1. Copy to clipboard — universally available, and lib/clipboard.ts already
 *      carries the execCommand + iOS selection-range fallbacks.
 *   2. Native share sheet — strictly additive, and only where navigator.share
 *      actually exists. Resolved AFTER mount so the server and first client
 *      render agree; a capability check during render would be a hydration
 *      mismatch.
 *   3. The URL itself as selectable text — the floor. If scripting, clipboard
 *      permissions and the share sheet all fail, the address is still readable
 *      and can be typed or long-pressed.
 *
 * There is deliberately no QR code. The handoff direction here is phone →
 * computer, which would require the computer to scan the phone; a QR is the
 * right answer for the opposite direction. It would also need an encoder
 * dependency the project does not have.
 */

const CONFIRM_MS = 2400

type Status = 'idle' | 'copied' | 'failed'

export default function ContinueOnDesktop() {
  const COPY = handoffCopyIn(useT().locale)
  const [status, setStatus] = useState<Status>('idle')
  const [canShare, setCanShare] = useState(false)

  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function')
  }, [])

  useEffect(() => {
    if (status === 'idle') return
    const t = setTimeout(() => setStatus('idle'), CONFIRM_MS)
    return () => clearTimeout(t)
  }, [status])

  async function copy() {
    setStatus((await copyToClipboard(DESKTOP_URL)) ? 'copied' : 'failed')
  }

  async function share() {
    try {
      await navigator.share({ title: COPY.shareTitle, text: COPY.shareText, url: DESKTOP_URL })
    } catch {
      // Dismissing the share sheet rejects. That is not a failure and must not
      // be reported as one.
    }
  }

  return (
    <div className='mh-rise flex w-full flex-col items-center gap-3' style={{ animationDelay: '220ms' }}>
      <Btn
        variant='solid'
        size='large'
        lbl={status === 'copied' ? COPY.copiedLabel : COPY.copyLabel}
        icon={status === 'copied' ? 'check' : undefined}
        onClick={copy}
        className='w-full max-w-[320px] justify-center'
      />

      {canShare && (
        <button
          type='button'
          onClick={share}
          className='rounded-md px-3 py-2 text-[13px] text-white/60 underline underline-offset-4 hover:text-white/80'
        >
          {COPY.shareLabel}
        </button>
      )}

      {/* The floor: always present, always selectable. */}
      <p className='select-all text-center text-[13px] tracking-wide text-white/45' dir='ltr'>
        {DESKTOP_URL_LABEL}
      </p>

      {/* Outcome is announced, not just shown — the button label alone would not
          reach a screen reader that has already moved past it. */}
      <p role='status' aria-live='polite' className='min-h-[1rem] text-center text-[12px] text-white/55'>
        {status === 'copied' ? COPY.copiedLabel : status === 'failed' ? COPY.copyFailedLabel : ''}
      </p>
    </div>
  )
}
