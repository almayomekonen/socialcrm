'use client'

import { JSX, useState } from 'react'
import ModalPop from './ModalPop'
import { Btn } from '@/lib/btns/Btn'

type Props = {
  open: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  msg: string
  confirmLbl?: string
  cancelLbl?: string
  destructive?: boolean
}

export default function ConfirmPop({
  open,
  onClose,
  onConfirm,
  msg,
  confirmLbl = 'אישור',
  cancelLbl = 'ביטול',
  destructive = false,
}: Props): JSX.Element {
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
    <ModalPop open={open} pos='middle' onClose={safeClose}>
      <div className='flex flex-col gap-6 min-w-[320px] pt-4'>
        <p className='font-semibold whitespace-pre-line pe-6'>{msg}</p>
        <div className='flex justify-end gap-2'>
          <Btn variant='outline' lbl={cancelLbl} onClick={safeClose} disabled={busy} />
          <Btn
            variant={destructive ? 'destructive' : 'solid'}
            lbl={confirmLbl}
            onClick={handleConfirm}
            disabled={busy}
          />
        </div>
      </div>
    </ModalPop>
  )
}
