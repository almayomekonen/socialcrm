'use client'

import { useEffect, useState } from 'react'
import Icon from '@/lib/Icon'
import { Btn } from '@/lib/btns/Btn'
import ModalPop from '@/lib/modals/ModalPop'
import { toast } from '@/lib/toast'

type DriveStatus = { state: 'loading' } | { state: 'disconnected' } | { state: 'connected'; email: string }

export function GoogleDriveConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [status, setStatus] = useState<DriveStatus>({ state: 'loading' })
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setStatus({ state: 'loading' })
    setConfirmingDisconnect(false)
    fetch('/api/auth/google-drive/status')
      .then((r) => r.json())
      .then((d: { connected: boolean; email?: string }) => {
        if (cancelled) return
        if (d.connected && d.email) setStatus({ state: 'connected', email: d.email })
        else setStatus({ state: 'disconnected' })
      })
      .catch(() => {
        if (cancelled) return
        setStatus({ state: 'disconnected' })
      })
    return () => {
      cancelled = true
    }
  }, [open])

  async function handleConfirmDisconnect() {
    if (disconnecting) return
    setDisconnecting(true)
    try {
      const res = await fetch('/api/auth/google-drive/disconnect', { method: 'POST' })
      if (!res.ok) throw new Error(`status_${res.status}`)
      toast('success', 'Google Drive נותק')
      setConfirmingDisconnect(false)
      onClose()
    } catch (err) {
      console.warn('[GoogleDrive] Disconnect failed', err)
      toast('error', 'הניתוק נכשל. נסה שוב.')
    } finally {
      setDisconnecting(false)
    }
  }

  // Lock outer-modal close while disconnect is in flight.
  const outerClose = disconnecting ? () => {} : onClose

  return (
    <>
      <ModalPop open={open} pos='middle' onClose={outerClose} label='Google Drive' className='w-[440px] max-w-[92vw]'>
        <div className='pt-2 grid gap-5'>
          <header className='grid gap-2'>
            <div className='flex items-center gap-2.5'>
              <Icon name='google-drive' className='size-7 bg-gray-900' />
              <h2 className='text-xl font-bold text-dark'>Google Drive</h2>
              {status.state === 'connected' && (
                <Icon name='check' type='reg' className='size-4 bg-green-600' aria-label='מחובר' />
              )}
            </div>
            {status.state === 'disconnected' && (
              <div className='grid gap-2 text-sm text-gray-600 leading-relaxed'>
                <p>חבר את Google Drive כדי לאפשר לעוזר החכם:</p>
                <ul className='grid gap-1 list-disc ps-5 marker:text-gray-400'>
                  <li>למצוא מסמכים</li>
                  <li>לסכם קבצים</li>
                  <li>לנתח חוזים ו-PDF</li>
                  <li>לעבוד עם התוכן שלך</li>
                </ul>
              </div>
            )}
            {status.state === 'connected' && (
              <p className='text-sm text-gray-600 leading-relaxed'>
                מחובר ל-<span className='font-medium text-gray-800'>{status.email}</span>
              </p>
            )}
            {status.state === 'loading' && <div className='h-12 flex items-center text-sm text-gray-500'>טוען…</div>}
          </header>
          <div className='flex justify-end gap-2'>
            {status.state === 'disconnected' && (
              <Btn lbl='חבר את Google Drive' onClick={() => (window.location.href = '/api/auth/google-drive')} />
            )}
            {status.state === 'connected' && (
              <>
                <Btn
                  lbl='נתק חשבון'
                  variant='outline'
                  onClick={() => setConfirmingDisconnect(true)}
                  disabled={disconnecting}
                />
                <Btn
                  lbl='עבור ל-Google Drive'
                  onClick={() => window.open('https://drive.google.com', '_blank', 'noopener,noreferrer')}
                />
              </>
            )}
          </div>
        </div>
      </ModalPop>

      <DisconnectConfirmModal
        open={confirmingDisconnect}
        busy={disconnecting}
        onCancel={() => setConfirmingDisconnect(false)}
        onConfirm={handleConfirmDisconnect}
      />
    </>
  )
}

function DisconnectConfirmModal({
  open,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const safeCancel = busy ? () => {} : onCancel
  return (
    <ModalPop open={open} pos='middle' onClose={safeCancel} label='ניתוק Google Drive' className='w-[420px] max-w-[92vw]'>
      <div className='pt-2 grid gap-6'>
        <div className='grid gap-2.5'>
          <h2 className='text-xl font-bold text-dark'>לנתק את Google Drive?</h2>
          <p className='text-sm text-gray-600 leading-relaxed'>
            העוזר החכם יאבד גישה למסמכים ולחיפוש קבצים מהחשבון המחובר
          </p>
        </div>
        <div className='flex justify-end gap-2'>
          <Btn variant='outline' lbl='ביטול' onClick={safeCancel} disabled={busy} />
          <Btn variant='destructive' lbl={busy ? 'מנתק…' : 'נתק'} onClick={onConfirm} disabled={busy} />
        </div>
      </div>
    </ModalPop>
  )
}
