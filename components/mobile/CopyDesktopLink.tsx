'use client'

import { useEffect, useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { copyToClipboard } from '@/lib/clipboard'
import { DESKTOP_URL } from '@/lib/activation/mobileHandoffCopy'
import { useT } from '@/lib/i18n/I18nProvider'

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
 *
 * LANGUAGE (i18n Phase F1): the three labels are `mobileShell.desktopOnly.copy.*`,
 * whose Hebrew is `MOBILE_HANDOFF_COPY`'s, pinned equal by
 * `mobileShellCopyPin.test.ts`. The activation screens (`ContinueOnDesktop`,
 * outside the workspace, pre-trial) keep reading that module, unchanged.
 */

const CONFIRM_MS = 2400

type Status = 'idle' | 'copied' | 'failed'

export default function CopyDesktopLink() {
  const t = useT()
  const [status, setStatus] = useState<Status>('idle')

  useEffect(() => {
    if (status === 'idle') return
    const timer = setTimeout(() => setStatus('idle'), CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [status])

  async function copy() {
    setStatus((await copyToClipboard(DESKTOP_URL)) ? 'copied' : 'failed')
  }

  return (
    <div className='flex w-full max-w-[320px] flex-col items-center gap-2'>
      <Btn
        variant='solid'
        size='large'
        lbl={status === 'copied' ? t('mobileShell.desktopOnly.copy.copied') : t('mobileShell.desktopOnly.copy.label')}
        icon={status === 'copied' ? 'check' : undefined}
        onClick={copy}
        className='w-full justify-center'
      />

      {/* Outcome is announced, not merely shown: a screen reader that has already
          moved past the button never hears its label change. */}
      <p role='status' aria-live='polite' className='min-h-[1rem] text-center text-[12px] text-gray-500'>
        {status === 'copied'
          ? t('mobileShell.desktopOnly.copy.copied')
          : status === 'failed'
            ? t('mobileShell.desktopOnly.copy.failed')
            : ''}
      </p>
    </div>
  )
}
