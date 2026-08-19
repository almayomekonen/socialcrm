'use client'

import { useEffect, useState } from 'react'
import type { IntegrationDescriptor } from '@/components/settings/integrations/catalog'
import IntegrationCardMobile from './IntegrationCardMobile'

type DriveStatus =
  | { state: 'loading' }
  | { state: 'disconnected' }
  | { state: 'connected'; email: string | null }

/**
 * Google Drive landing card. Status is the same GET the desktop IntegrationCard
 * already uses — no second backend.
 */
export default function DriveCardMobile({
  integration,
  onManage,
}: {
  integration: IntegrationDescriptor
  onManage: () => void
}) {
  const [status, setStatus] = useState<DriveStatus>({ state: 'loading' })

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

  const loading = status.state === 'loading'
  const connected = status.state === 'connected'

  return (
    <IntegrationCardMobile
      title={integration.name}
      leading={
        integration.logoSrc ? (
          <img src={integration.logoSrc} alt='' aria-hidden='true' className='size-7 shrink-0 object-contain' />
        ) : (
          <span className='size-7' />
        )
      }
      statusLabel={loading ? 'טוען…' : connected ? 'מחובר' : 'לא מחובר'}
      explanation={
        connected && status.email ? `מחובר · ${status.email}` : integration.description
      }
      actionLabel={connected ? 'ניהול' : integration.connectLabel}
      role={loading ? 'neutral' : connected ? 'success' : 'neutral'}
      onAction={onManage}
    />
  )
}
