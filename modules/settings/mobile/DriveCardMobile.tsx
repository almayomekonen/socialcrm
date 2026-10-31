'use client'

import { useEffect, useState } from 'react'
import type { IntegrationDescriptor } from '@/components/settings/integrations/catalog'
import IntegrationCardMobile from './IntegrationCardMobile'
import { driveReturnCopy } from './oauthReturn'
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey } from '@/lib/i18n/translate'

/** The catalog descriptor's own copy in the interface language (same keys as the desktop `IntegrationCard`). */
const COPY: Record<string, { description: MessageKey; connectLabel: MessageKey }> = {
  'google-drive': { description: 'settings.integrations.drive.description', connectLabel: 'settings.integrations.drive.connect' },
}

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
  returnConnected = false,
  returnError = null,
}: {
  integration: IntegrationDescriptor
  onManage: () => void
  returnConnected?: boolean
  returnError?: string | null
}) {
  const t = useT()
  const copy = t.locale === 'he' ? undefined : COPY[integration.id]
  const description = copy ? t(copy.description) : integration.description
  const connectLabel = copy ? t(copy.connectLabel) : integration.connectLabel
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
  const overlay = driveReturnCopy(
    {
      connected,
      error: returnError,
      connecting: returnConnected && loading,
    },
    t.locale,
  )

  const statusLabel = overlay?.statusLabel ?? (loading ? t('settings.integrations.card.loading') : connected ? t('settings.integrations.card.connected') : t('settings.integrations.card.notConnected'))
  const explanation =
    overlay?.explanation ?? (connected && status.email ? t('settings.mobile.status.connectedAs', { email: status.email }) : description)
  const actionLabel = overlay?.actionLabel ?? (connected ? t('settings.mobile.landing.manage') : connectLabel)
  const role = overlay?.role ?? (loading ? 'neutral' : connected ? 'success' : 'neutral')

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
      statusLabel={statusLabel}
      explanation={explanation}
      actionLabel={actionLabel}
      role={role}
      actionDisabled={loading && returnConnected}
      onAction={onManage}
    />
  )
}
