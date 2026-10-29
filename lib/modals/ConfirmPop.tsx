'use client'

import { JSX, useState } from 'react'
import ModalPop from './ModalPop'
import { Btn } from '@/lib/btns/Btn'
import { useT } from '@/lib/i18n/I18nProvider'

type Props = {
  open: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  msg: string
  confirmLbl?: string
  cancelLbl?: string
  destructive?: boolean
  hideCancel?: boolean
  /** See ModalPop `translated`. */
  translated?: boolean
}

export default function ConfirmPop({
  open,
  onClose,
  onConfirm,
  msg,
  confirmLbl,
  cancelLbl,
  destructive = false,
  hideCancel = false,
  translated = false,
}: Props): JSX.Element {
  const t = useT()
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

  const safeClose = busy ? () => {} : onClose

  return (
    <ModalPop open={open} pos='middle' onClose={safeClose} label={msg} translated={translated}>
      <div className='flex flex-col gap-6 min-w-[320px] pt-4'>
        <p className='font-semibold whitespace-pre-line pe-6'>{msg}</p>
        <div className='flex justify-end gap-2'>
          {!hideCancel && <Btn variant='outline' lbl={cancelLbl ?? t('common.dialog.cancel')} onClick={safeClose} disabled={busy} />}
          <Btn
            variant={destructive ? 'destructive' : 'solid'}
            lbl={confirmLbl ?? t('common.dialog.confirm')}
            onClick={handleConfirm}
            disabled={busy}
          />
        </div>
      </div>
    </ModalPop>
  )
}
