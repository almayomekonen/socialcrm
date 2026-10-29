'use client'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { useAction } from '@/lib/useAction'
import { useEmbeddedSignup } from '@/lib/facebook/useEmbeddedSignup'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import ConnectionNotice from '@/components/settings/ConnectionNotice'
import { whatsappHealthNoticeFor, whatsappNoticeFor } from '@/lib/connections/localizedNotices'
import { useT } from '@/lib/i18n/I18nProvider'
import { translatorFor } from '@/lib/i18n/translators'
import { whatsappLaunchNoticeCode } from '@/lib/connections/connectFailure'
import { useInAppWarning, type InAppBrowser } from '@/lib/connections/useInAppWarning'
import type { WhatsappHealthPrimary } from '@/lib/whatsapp/operationalStatus'
import WhatsappPhonePicker, { type Phone } from '@/components/settings/WhatsappPhonePicker'

type Connection = { phoneNumberId: string }

type Props = {
  connection: Connection | null
  pendingPhones: Phone[] | null
  appId: string
  configId: string
  graphVersion: string
  /** Truthful health primary. Never render a green claim unless 'operational'. */
  status: WhatsappHealthPrimary
  /**
   * MOBILE-ONLY copy overrides for the not-connected state (State A).
   *
   * The phone reaches this component through a bottom sheet the rep lands on by
   * tapping WhatsApp on a lead, so the copy there answers "why am I being asked
   * to connect?" rather than settings' "what does connecting get me?". Optional
   * and defaulted to the desktop strings: desktop passes neither, so its render
   * is unchanged. They affect State A only — States B and C own their own copy.
   */
  description?: string
  connectLabel?: string
  /** Server-detected Instagram/Facebook in-app browser (lib/device.ts). */
  inAppBrowser?: InAppBrowser
  /** Follow the interface language (the desktop settings page). Default Hebrew: the phone sheet is not translated yet. */
  translated?: boolean
}

const HEBREW = translatorFor('he')

export default function WhatsappConnect({
  connection,
  pendingPhones,
  appId,
  configId,
  graphVersion,
  status,
  description,
  connectLabel,
  inAppBrowser,
  translated = false,
}: Props) {
  const ui = useT()
  const t = translated ? ui : HEBREW
  const locale = t.locale
  const reasonsLabel = t('settings.integrations.reasonsLabel')
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlError = searchParams.get('wa_error')

  // Meta's own words when its window showed an error; rendered by `meta_error`.
  const [metaMessage, setMetaMessage] = useState<string | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const { loading, error, setError, run } = useAction()
  /**
   * Disconnect owns its OWN action state.
   *
   * With one shared `useAction`, starting a connect flipped `loading` and the
   * red disconnect button rendered "מתנתק..." and went disabled — as if a
   * disconnect were underway. On a stuck Embedded Signup that is genuinely
   * alarming: the destructive control appears to be running when nothing was
   * clicked. Two independent states make each button describe only its own
   * action. ConfirmPop still guards the disconnect itself; nothing about that
   * protection changes.
   */
  const { loading: disconnecting, error: disconnectError, run: runDisconnect } = useAction()
  const { launch } = useEmbeddedSignup(appId, configId, graphVersion)
  const { intercept } = useInAppWarning(inAppBrowser)

  const startEmbeddedSignup = () =>
    run(async () => {
      setError(null)
      if (intercept()) return setError('in_app_browser')
      const result = await launch()
      if (result.ok) {
        router.refresh()
        return
      }
      setMetaMessage(result.cancel?.errorMessage ?? null)
      setError(whatsappLaunchNoticeCode(result, !!connection))
    })

  const performDisconnect = () => {
    setConfirmDisconnect(false)
    runDisconnect(async () => {
      await fetch('/api/auth/whatsapp/disconnect', { method: 'POST' })
      router.refresh()
    })
  }

  const connectPhone = (phone: Phone) => {
    setError(null)
    run(async () => {
      const res = await fetch('/api/auth/whatsapp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumberId: phone.id }),
      })
      if (!res.ok) {
        setError('token')
        return
      }
      router.refresh()
    })
  }

  // State C: A connection row exists — but "row exists" is NOT "operational".
  // Only 'operational' earns the green, leads-arrive claim. Restricted / token /
  // webhook never render as green. Reconnect is not the default for restricted.
  if (connection) {
    // A failed launch must outrank the health notice. Previously State C read
    // ONLY the health status, so `setError` from a failed Embedded Signup
    // updated state that nothing rendered: the button reverted to the health
    // action and the operator saw no reason at all. An SDK failure has to say
    // "חלון ההתחברות לא נפתח", not silently look like a fresh reconnect prompt.
    // `whatsappNotice` returns null for cancelled/denied, so dismissing Meta's
    // popup correctly leaves the health notice in place.
    const notice = whatsappNoticeFor(error, metaMessage, locale) ?? whatsappHealthNoticeFor(status, locale)
    const canReconnect = status === 'unknown' || status === 'token' || status === 'webhook'
    // NO history control lives here, by design.
    //
    // History synchronisation is not a SocialCRM action: it belongs to Meta's
    // Coexistence Embedded Signup, where Meta itself collects the customer's
    // consent to share their WhatsApp Business app history. A separate CTA here
    // would imply the rep can trigger an import on demand, which is not a
    // capability we have — and the previous attempt at one was worse still: a
    // button reading "סנכרן היסטוריית שיחות מהוואטסאפ" whose onClick was
    // `startEmbeddedSignup`, promising an import and opening an onboarding
    // dialog.
    //
    // `startEmbeddedSignup` therefore stays bound to connect and reconnect only.
    // The importer, webhooks, worker and `syncSmbAppData` all remain in place
    // for the real Coexistence flow to drive.
    return (
      <div className='grid gap-4' data-edu={canReconnect ? undefined : 'whatsapp-connect'}>
        {status === 'operational' && (
          <p className='text-sm text-green-600'>{t('settings.integrations.whatsapp.healthy')}</p>
        )}
        {notice && <ConnectionNotice notice={notice} reasonsLabel={reasonsLabel} />}

        <div className='flex flex-wrap items-center gap-3'>
          {canReconnect && (
            <div data-edu='whatsapp-connect' className='w-fit'>
              <Btn
                lbl={loading ? t('settings.integrations.whatsapp.connecting') : (notice?.action ?? t('settings.integrations.whatsapp.reconnectVerify'))}
                icon={loading ? 'spinner' : 'whatsapp'}
                iconClassName={loading ? 'animate-spin' : undefined}
                disabled={loading}
                // `hover:bg-green-700` is required, not cosmetic: the solid
                // variant ships `hover:bg-solid/85`, which twMerge keeps because
                // `hover:bg-*` is a different key from `bg-*`.
                className='w-fit bg-green-600 hover:bg-green-700'
                onClick={startEmbeddedSignup}
              />
            </div>
          )}
          <Btn
            lbl={disconnecting ? t('settings.integrations.whatsapp.disconnecting') : t('settings.integrations.whatsapp.disconnect')}
            icon={disconnecting ? 'spinner' : undefined}
            iconClassName={disconnecting ? 'animate-spin' : undefined}
            variant='outline'
            size='small'
            className='w-fit border-red-200 text-red-600 hover:bg-red-50'
            disabled={disconnecting}
            onClick={() => setConfirmDisconnect(true)}
          />
        </div>
        <ConfirmPop
          open={confirmDisconnect}
          destructive
          onClose={() => setConfirmDisconnect(false)}
          onConfirm={performDisconnect}
          msg={t('settings.integrations.whatsapp.disconnectConfirm')}
          translated={translated}
        />
      </div>
    )
  }

  // State B: OAuth done, phone not yet selected
  if (pendingPhones) {
    return <WhatsappPhonePicker pendingPhones={pendingPhones} notice={whatsappNoticeFor(error, null, locale)} loading={loading} onConnect={connectPhone} translated={translated} />
  }

  // State A: Not connected
  const notice = whatsappNoticeFor(error ?? disconnectError ?? urlError, metaMessage, locale)

  return (
    <div className='grid gap-4'>
      {notice && <ConnectionNotice notice={notice} reasonsLabel={reasonsLabel} />}
      <p className='text-sm text-gray-500'>{description ?? t('settings.integrations.whatsapp.intro')}</p>
      <div data-edu='whatsapp-connect' className='w-fit'>
      <Btn
        lbl={loading ? t('settings.integrations.whatsapp.connecting') : (notice?.action ?? connectLabel ?? t('settings.integrations.whatsapp.connect'))}
        icon={loading ? 'spinner' : 'whatsapp'}
        iconClassName={loading ? 'animate-spin' : undefined}
        disabled={loading}
        className='w-fit bg-green-600'
        onClick={startEmbeddedSignup}
      />
      </div>
    </div>
  )
}
