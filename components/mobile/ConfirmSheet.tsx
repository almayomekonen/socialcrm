'use client'

import { useState } from 'react'
import BottomSheet from '@/components/mobile/BottomSheet'

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
  confirmLbl = 'אישור',
  cancelLbl = 'ביטול',
  destructive = false,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  title: string
  msg: string
  confirmLbl?: string
  cancelLbl?: string
  destructive?: boolean
}) {
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
    <BottomSheet open={open} onClose={busy ? () => {} : onClose} title={title} dismissOnScrim={!busy}>
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
          {busy ? 'מבצע...' : confirmLbl}
        </button>
        <button
          type='button'
          disabled={busy}
          onClick={onClose}
          className='press flex min-h-11 w-full items-center justify-center rounded-md border border-gray-200 bg-white font-medium text-ink hover:bg-gray-50 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        >
          {cancelLbl}
        </button>
      </div>
    </BottomSheet>
  )
}
