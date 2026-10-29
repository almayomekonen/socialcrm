'use client'

import { useState } from 'react'
import BottomSheet from '@/components/mobile/BottomSheet'
import { useT } from '@/lib/i18n/I18nProvider'
import { translatorFor } from '@/lib/i18n/translators'

const HEBREW = translatorFor('he')

/**
 * Phone confirmation. Same job as `ConfirmPop` (explicit confirm, no `alert()`),
 * without the desktop dialog's `min-w-[320px]` which does not fit a 360px sheet.
 */

export default function ConfirmSheet({
  open,
  onClose,
  onConfirm,
  title,
  msg,
  confirmLbl,
  cancelLbl,
  destructive = false,
  translated = false,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  title: string
  msg: string
  confirmLbl?: string
  cancelLbl?: string
  destructive?: boolean
  /** The caller follows the interface language (the phone inbox); off keeps the Hebrew defaults. */
  translated?: boolean
}) {
  const ui = useT()
  const t = translated ? ui : HEBREW
  const [busy, setBusy] = useState(false)

  async function handleConfirm() {
    if (busy) return
    try {
      setBusy(true)
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={busy ? () => {} : onClose} title={title} dismissOnScrim={!busy} translated={translated}>
      <p className='text-sm leading-relaxed whitespace-pre-line text-gray-600'>{msg}</p>
      <div className='mt-4 flex flex-col gap-2'>
        <button
          type='button'
          disabled={busy}
          onClick={handleConfirm}
          className={
            destructive
              ? 'press flex min-h-11 w-full items-center justify-center rounded-md bg-red-600 font-medium text-white hover:bg-red-700 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
              : 'press flex min-h-11 w-full items-center justify-center rounded-md bg-solid font-medium text-white hover:bg-solid/85 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          }
        >
          {busy ? t('common.sheet.working') : (confirmLbl ?? t('common.dialog.confirm'))}
        </button>
        <button
          type='button'
          disabled={busy}
          onClick={onClose}
          className='press flex min-h-11 w-full items-center justify-center rounded-md border border-gray-200 bg-white font-medium text-ink hover:bg-gray-50 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        >
          {cancelLbl ?? t('common.dialog.cancel')}
        </button>
      </div>
    </BottomSheet>
  )
}
