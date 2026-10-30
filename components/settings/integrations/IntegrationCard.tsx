'use client'

import { useEffect, useState } from 'react'
import { twMerge } from 'tailwind-merge'
import Icon from '@/lib/Icon'
import { Btn } from '@/lib/btns/Btn'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { toast } from '@/lib/toast'
import type { IntegrationDescriptor } from './catalog'
import { useT } from '@/lib/i18n/I18nProvider'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'

const HEBREW = translatorFor('he')

/** Catalog wording of a descriptor's copy, by its id (the descriptor keeps the Hebrew source; brand names stay as they are). */
const COPY: Record<string, { description: MessageKey; connectLabel: MessageKey; disconnectedToast: MessageKey }> = {
  'google-drive': { description: 'settings.integrations.drive.description', connectLabel: 'settings.integrations.drive.connect', disconnectedToast: 'settings.integrations.drive.disconnected' },
}

type Status =
  | { state: 'loading' }
  | { state: 'disconnected' }
  | { state: 'connected'; email: string | null }


export default function IntegrationCard({
  integration,
  translated = false,
}: {
  integration: IntegrationDescriptor
  /** Follow the interface language (the desktop settings page). Default Hebrew: the phone screen is not translated yet. */
  translated?: boolean
}) {
  const ui = useT()
  const t = translated ? ui : HEBREW
  const copy = t.locale === 'he' ? undefined : COPY[integration.id]
  const description = copy ? t(copy.description) : integration.description
  const connectLabel = copy ? t(copy.connectLabel) : integration.connectLabel
  const disconnectedToast = copy ? t(copy.disconnectedToast) : integration.disconnectedToast
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
      toast('success', disconnectedToast)
      setConfirmOpen(false)
      setStatus({ state: 'disconnected' })
    } catch {
      toast('error', t('settings.integrations.card.disconnectFailed'))
    } finally {
      setDisconnecting(false)
    }
  }

  const connected = status.state === 'connected'

  return (
    // Structure mirrors CalendarConnect exactly — see the note there. The
    // action row is pinned with mt-auto so buttons line up across cards of
    // unequal content length.
    <div className='rounded-lg border border-gray-200 bg-white p-6 flex flex-col gap-4'>
      <div className='flex items-center gap-2.5'>
        {/* A real logo when the brand ships one, the mask icon otherwise — see
            `logoSrc` in ./catalog. Decorative: the title beside it is the name. */}
        {integration.logoSrc ? (
          <img src={integration.logoSrc} alt='' aria-hidden='true' className='size-7 shrink-0 object-contain' />
        ) : (
          <Icon name={integration.icon} className={twMerge('size-7 bg-gray-900', integration.iconClassName)} />
        )}
        {/* h3: the page owns h1, and "כלים מחוברים" owns the h2 above this card. */}
        <h3 className='text-lg font-bold text-dark'>{integration.name}</h3>
        {connected && <Icon name='check' type='reg' className='size-4 bg-green-600' aria-label={t('settings.integrations.card.connected')} />}
      </div>

      <p className='text-sm text-gray-600 leading-relaxed'>{description}</p>

      {status.state === 'loading' && (
        <div className='mt-auto h-9 flex items-center text-sm text-gray-400'>{t('settings.integrations.card.loading')}</div>
      )}

      {status.state === 'disconnected' && (
        <div className='mt-auto flex items-center justify-between gap-3'>
          <span className='text-sm text-gray-400'>{t('settings.integrations.card.notConnected')}</span>
          <Btn
            lbl={connectLabel}
            onClick={() => {
              const returnTo = encodeURIComponent(window.location.pathname + window.location.search)
              window.location.href = `${integration.connectPath}?returnTo=${returnTo}`
            }}
          />
        </div>
      )}

      {status.state === 'connected' && (
        <div className='mt-auto flex items-center justify-between gap-3'>
          <span className='min-w-0 truncate text-sm text-gray-600'>
            {status.email ? (
              <>
                {t('settings.integrations.card.connectedAs')} <span className='font-medium text-gray-800'>{status.email}</span>
              </>
            ) : (
              t('settings.integrations.card.connected')
            )}
          </span>
          <Btn lbl={t('settings.integrations.card.disconnect')} variant='outline' onClick={() => setConfirmOpen(true)} disabled={disconnecting} />
        </div>
      )}

      <ConfirmPop
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDisconnect}
        msg={t('settings.integrations.drive.disconnectConfirm', { name: integration.name })}
        confirmLbl={t('settings.integrations.card.disconnect')}
        destructive
        translated={translated}
      />
    </div>
  )
}
