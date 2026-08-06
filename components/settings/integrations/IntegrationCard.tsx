'use client'

import { useEffect, useState } from 'react'
import Icon from '@/lib/Icon'
import { Btn } from '@/lib/btns/Btn'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { toast } from '@/lib/toast'
import type { IntegrationDescriptor } from './catalog'

type Status =
  | { state: 'loading' }
  | { state: 'disconnected' }
  | { state: 'connected'; email: string | null }


export default function IntegrationCard({ integration }: { integration: IntegrationDescriptor }) {
  const [status, setStatus] = useState<Status>({ state: 'loading' })
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(integration.statusPath)
      .then((r) => r.json())
      .then((d: { connected: boolean; email?: string }) => {
        if (cancelled) return
        setStatus(d.connected ? { state: 'connected', email: d.email ?? null } : { state: 'disconnected' })
      })
      .catch(() => {
        if (!cancelled) setStatus({ state: 'disconnected' })
      })
    return () => {
      cancelled = true
    }
  }, [integration.statusPath])

  async function handleDisconnect() {
    if (disconnecting) return
    setDisconnecting(true)
    try {
      const res = await fetch(integration.disconnectPath, { method: 'POST' })
      if (!res.ok) throw new Error(`status_${res.status}`)
      toast('success', integration.disconnectedToast)
      setConfirmOpen(false)
      setStatus({ state: 'disconnected' })
    } catch {
      toast('error', 'הניתוק נכשל. נסה שוב.')
    } finally {
      setDisconnecting(false)
    }
  }

  const connected = status.state === 'connected'

  return (
    <div className='rounded-lg border border-gray-200 bg-white p-6 grid gap-4 content-start'>
      <div className='flex items-center gap-2.5'>
        <Icon name={integration.icon} className='size-7 bg-gray-900' />
        {/* h3: the page owns h1, and "כלים מחוברים" owns the h2 above this card. */}
        <h3 className='text-lg font-bold text-dark'>{integration.name}</h3>
        {connected && <Icon name='check' type='reg' className='size-4 bg-green-600' aria-label='מחובר' />}
      </div>

      <p className='text-sm text-gray-600 leading-relaxed'>{integration.description}</p>

      {status.state === 'loading' && <div className='h-9 flex items-center text-sm text-gray-400'>טוען…</div>}

      {status.state === 'disconnected' && (
        <div className='flex items-center justify-between gap-3'>
          <span className='text-sm text-gray-400'>לא מחובר</span>
          <Btn
            lbl={integration.connectLabel}
            onClick={() => {
              const returnTo = encodeURIComponent(window.location.pathname + window.location.search)
              window.location.href = `${integration.connectPath}?returnTo=${returnTo}`
            }}
          />
        </div>
      )}

      {status.state === 'connected' && (
        <div className='flex items-center justify-between gap-3'>
          <span className='min-w-0 truncate text-sm text-gray-600'>
            {status.email ? (
              <>
                מחובר · <span className='font-medium text-gray-800'>{status.email}</span>
              </>
            ) : (
              'מחובר'
            )}
          </span>
          <Btn lbl='נתק' variant='outline' onClick={() => setConfirmOpen(true)} disabled={disconnecting} />
        </div>
      )}

      <ConfirmPop
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDisconnect}
        msg={`הקבצים הקיימים יישארו ב-CRM, אך ${integration.name} לא יהיה זמין עד לחיבור מחדש.`}
        confirmLbl='נתק'
        destructive
      />
    </div>
  )
}
