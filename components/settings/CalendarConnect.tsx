'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import Icon from '@/lib/Icon'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { toast } from '@/lib/toast'
import { useT } from '@/lib/i18n/I18nProvider'
import { translatorFor } from '@/lib/i18n/translators'

const HEBREW = translatorFor('he')

type State = 'not_connected' | 'connected' | 'reauth_required'

type Props = {
  state: State
  email: string | null
  lastError: string | null
  /** Follow the interface language (the desktop settings page). Default Hebrew: the phone screen is not translated yet. */
  translated?: boolean
}

export default function CalendarConnect({ state, email, lastError, translated = false }: Props) {
  const ui = useT()
  const t = translated ? ui : HEBREW
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [, startTransition] = useTransition()

  async function handleDisconnect() {
    try {
      const res = await fetch('/api/auth/google-calendar/disconnect', { method: 'POST' })
      if (!res.ok) throw new Error('failed')
      toast('success', t('settings.integrations.calendar.disconnected'))
      setConfirmOpen(false)
      startTransition(() => router.refresh())
    } catch {
      toast('error', t('settings.integrations.card.disconnectFailed'))
    }
  }

  return (
    /*
     * Card shape is deliberately identical to IntegrationCard (Google Drive):
     * same container, same header, one description paragraph, and a status +
     * action row pinned to the bottom with mt-auto. Two cards sitting side by
     * side under כלים מחוברים must not read as two different components — so
     * the structure is shared, not merely similar.
     */
    <div className='rounded-lg border border-gray-200 bg-white p-6 flex flex-col gap-4'>
      <div className='flex items-center gap-2.5'>
        {/* Authentic Google Calendar mark. Not `Icon` — that renders a CSS mask,
            which is single-colour and cannot carry Google's four. Decorative:
            the heading beside it is the accessible name. */}
        <img
          src='/media/social-icons/google-calendar-color.svg'
          alt=''
          aria-hidden='true'
          className='size-7 shrink-0 object-contain'
        />
        {/* h3: the page owns h1, and "כלים מחוברים" owns the h2 above this card. */}
        <h3 className='text-lg font-bold'>Google Calendar</h3>
        {state === 'connected' && (
          <Icon name='check' type='reg' className='size-4 bg-green-600' aria-label={t('settings.integrations.card.connected')} />
        )}
      </div>

      {/*
        Outside the state branches, so it stays visible once connected — the
        way IntegrationCard renders its description. Worded descriptively
        rather than as an instruction ("חבר את...") for the same reason: the
        sentence has to still read correctly after the account is connected.
      */}
      <p className='text-gray-600 text-sm leading-relaxed'>
        {t('settings.integrations.calendar.description')}
      </p>

      {state === 'not_connected' && (
        <div className='mt-auto flex items-center justify-between gap-3'>
          <span className='text-sm text-gray-400'>{t('settings.integrations.card.notConnected')}</span>
          <Btn
            lbl={t('settings.integrations.calendar.connect')}
            onClick={() => {
              const returnTo = encodeURIComponent(window.location.pathname + window.location.search)
              window.location.href = `/api/auth/google-calendar?returnTo=${returnTo}`
            }}
          />
        </div>
      )}

      {state === 'connected' && (
        <div className='mt-auto flex items-center justify-between gap-3'>
          <span className='min-w-0 truncate text-sm text-gray-600'>
            {t('settings.integrations.card.connectedAs')} <span className='font-medium text-gray-800'>{email}</span>
          </span>
          <Btn lbl={t('settings.integrations.card.disconnect')} variant='outline' onClick={() => setConfirmOpen(true)} />
        </div>
      )}

      {state === 'reauth_required' && (
        <>
          <div className='rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900'>
            <p className='font-medium'>{t('settings.integrations.calendar.expired')}</p>
            <p className='mt-0.5'>{t('settings.integrations.calendar.expiredHint')}</p>
            {lastError && <p className='mt-1 text-xs text-amber-700'>{t('settings.integrations.calendar.details', { error: lastError })}</p>}
          </div>
          <div className='mt-auto flex items-center justify-between gap-3'>
            <span className='text-sm text-gray-400'>{t('settings.integrations.calendar.needsReconnect')}</span>
            <Btn
              lbl={t('settings.integrations.calendar.reconnect')}
              onClick={() => {
                const returnTo = encodeURIComponent(window.location.pathname + window.location.search)
                window.location.href = `/api/auth/google-calendar?returnTo=${returnTo}`
              }}
            />
          </div>
        </>
      )}

      <ConfirmPop
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDisconnect}
        msg={t('settings.integrations.calendar.disconnectConfirm')}
        confirmLbl={t('settings.integrations.card.disconnect')}
        destructive
        translated={translated}
      />
    </div>
  )
}
