'use client'

import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'

/**
 * The single CTA button for the activation flow. Reuses the product's existing
 * Btn loading idiom (spinner icon + animate-spin + disabled) so the user gets
 * immediate "action received" feedback and cannot double-tap. Used by every
 * action screen so the loading behaviour is identical everywhere.
 */
export default function ActivationCtaButton({
  label,
  loadingLabel,
  onClick,
  disabled = false,
}: {
  label: string
  loadingLabel: string
  onClick: () => void | Promise<void>
  disabled?: boolean
}) {
  const [busy, setBusy] = useState(false)

  async function handle() {
    if (busy || disabled) return
    setBusy(true)
    try {
      await onClick()
    } catch {
      setBusy(false) // navigation cases unload the page; only reset on a real failure
    }
  }

  return (
    <Btn
      lbl={busy ? loadingLabel : label}
      icon={busy ? 'spinner' : undefined}
      iconClassName={busy ? 'animate-spin' : undefined}
      disabled={busy || disabled}
      onClick={handle}
      className='w-full max-w-[320px] justify-center'
    />
  )
}
