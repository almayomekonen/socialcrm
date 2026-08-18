'use client'

import { useEffect, useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { copyToClipboard } from '@/lib/clipboard'
import { DESKTOP_URL, MOBILE_HANDOFF_COPY as COPY } from '@/lib/activation/mobileHandoffCopy'

/**
 * The desktop handoff action, inside the mobile workspace.
 *
 * SAME ACTION, SAME COPY, SAME CLIPBOARD HELPER as `ContinueOnDesktop` — and
 * deliberately NOT that component. `ContinueOnDesktop` is hard-styled for the
 * dark activation gradient (`text-white/45`) and carries the `mh-rise` entrance
 * class, whose keyframes are injected by `MobileHandoff` itself. Rendering it on
 * the mobile workspace's light background would produce white text on white and
 * an element pinned at `opacity: 0` — `.mh-rise` sets that as its starting state
 * and nothing would animate it away. This is the light-surface sibling, not a
 * fork of the behaviour: the URL, the labels and `copyToClipboard()` (with its
 * execCommand + iOS selection-range fallbacks) are all imported, not restated.
 *
 * ux-guidelines.md §3: the label names what the tap actually does. "פתח במחשב"
 * would be a button with no behaviour behind it — a phone cannot open a window
 * on another machine. Getting the address onto the other device is the real
 * action, and it is the one the product already ships.
 */

const CONFIRM_MS = 2400

type Status = 'idle' | 'copied' | 'failed'

export default function CopyDesktopLink() {
  const [status, setStatus] = useState<Status>('idle')

  useEffect(() => {
    if (status === 'idle') return
    const t = setTimeout(() => setStatus('idle'), CONFIRM_MS)
    return () => clearTimeout(t)
  }, [status])

  async function copy() {
    setStatus((await copyToClipboard(DESKTOP_URL)) ? 'copied' : 'failed')
  }

  return (
    <div className='flex w-full max-w-[320px] flex-col items-center gap-2'>
      <Btn
        variant='solid'
        size='large'
        lbl={status === 'copied' ? COPY.copiedLabel : COPY.copyLabel}
        icon={status === 'copied' ? 'check' : undefined}
        onClick={copy}
        className='w-full justify-center'
      />

      {/* Outcome is announced, not merely shown: a screen reader that has already
          moved past the button never hears its label change. */}
      <p role='status' aria-live='polite' className='min-h-[1rem] text-center text-[12px] text-gray-500'>
        {status === 'copied' ? COPY.copiedLabel : status === 'failed' ? COPY.copyFailedLabel : ''}
      </p>
    </div>
  )
}
