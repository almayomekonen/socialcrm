'use client'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { FormField } from '@/lib/form'
import { useAction } from '@/lib/useAction'
import { useEmbeddedSignup } from '@/lib/facebook/useEmbeddedSignup'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import ConnectionNotice from '@/components/settings/ConnectionNotice'
import { WHATSAPP_NOTICES, whatsappNotice } from '@/lib/connections/messages'
import type { WhatsappHealthPrimary } from '@/lib/whatsapp/operationalStatus'

type Phone = { id: string; displayPhone: string; verifiedName: string }
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
   * The connection is healthy, but the number is STILL live in the WhatsApp
   * Business app and has not been through Coexistence onboarding
   * (`onboarding_type = 'cloud_api'` while Graph reports `is_on_biz_app: true`).
   *
   * Without this, an operational connection offers no way to reach Embedded
   * Signup — `canReconnect` covers only the broken states — so a number that
   * qualifies for Coexistence has no path to it except disconnecting, which
   * destroys the stored token for no reason.
   *
   * Resolved on the SERVER, because `is_on_biz_app` is a Graph fact the browser
   * cannot see. Defaults to false, so every caller that does not pass it — the
   * mobile surfaces included — renders exactly as before.
   */
  coexistenceAvailable?: boolean
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
}

function noticeForHealth(status: WhatsappHealthPrimary) {
  if (status === 'registration_pending' || status === 'inbound_only') return WHATSAPP_NOTICES.not_ready
  if (status === 'restricted') return WHATSAPP_NOTICES.restricted
  if (status === 'token') return WHATSAPP_NOTICES.expired
  if (status === 'webhook') return WHATSAPP_NOTICES.webhook
  if (status === 'unknown') return WHATSAPP_NOTICES.needs_verification
  return null
}

export default function WhatsappConnect({
  connection,
  pendingPhones,
  appId,
  configId,
  graphVersion,
  status,
  coexistenceAvailable = false,
  description = 'חבר את מספר הוואטסאפ העסקי שלך כדי לקבל לידים אוטומטית.',
  connectLabel = 'חבר וואטסאפ עסקי',
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlError = searchParams.get('wa_error')

  const [selectedPhoneId, setSelectedPhoneId] = useState('')
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

  const startEmbeddedSignup = () =>
    run(async () => {
      setError(null)
      const result = await launch()
      if (result.ok) {
        router.refresh()
        return
      }

      if (result.error === 'cancelled') return
      setError(result.error ?? 'token')
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
    const notice = whatsappNotice(error) ?? noticeForHealth(status)
    const canReconnect = status === 'unknown' || status === 'token' || status === 'webhook'
    // A HEALTHY connection that still qualifies for Coexistence. Kept separate
    // from `canReconnect`: those are repair states, this one is not broken at
    // all. Both launch the SAME existing Embedded Signup flow — the server
    // decides `onboarding_type` from Graph, so nothing here can force it.
    const canStartCoexistence = status === 'operational' && coexistenceAvailable
    return (
      <div className='grid gap-4' data-edu={canReconnect ? undefined : 'whatsapp-connect'}>
        {status === 'operational' && (
          <p className='text-sm text-green-600'>החיבור תקין — לידים מגיעים אוטומטית</p>
        )}
        {notice && <ConnectionNotice notice={notice} />}
        {(canReconnect || canStartCoexistence) && (
          <div data-edu='whatsapp-connect' className='w-fit'>
          <Btn
            lbl={
              loading
                ? 'מתחבר...'
                : canReconnect
                  ? (notice?.action ?? 'לחבר מחדש ולאמת')
                  : 'סנכרן היסטוריית שיחות מהוואטסאפ'
            }
            icon={loading ? 'spinner' : 'whatsapp'}
            iconClassName={loading ? 'animate-spin' : undefined}
            size='small'
            disabled={loading}
            className='w-fit bg-green-600'
            onClick={startEmbeddedSignup}
          />
          </div>
        )}
        <Btn
          lbl={disconnecting ? 'מנתק...' : 'נתק וואטסאפ'}
          icon={disconnecting ? 'spinner' : undefined}
          iconClassName={disconnecting ? 'animate-spin' : undefined}
          variant='destructive'
          size='small'
          className='w-fit'
          disabled={disconnecting}
          onClick={() => setConfirmDisconnect(true)}
        />
        <ConfirmPop
          open={confirmDisconnect}
          destructive
          onClose={() => setConfirmDisconnect(false)}
          onConfirm={performDisconnect}
          msg='לנתק את חיבור הוואטסאפ?'
        />
      </div>
    )
  }

  // State B: OAuth done, phone not yet selected
  if (pendingPhones) {
    const selected = pendingPhones.find((p) => p.id === selectedPhoneId)
    const notice = whatsappNotice(error)

    return (
      <div className='grid gap-4'>
        {notice && <ConnectionNotice notice={notice} />}
        <p className='text-sm text-gray-600'>בחר את מספר הטלפון שברצונך לחבר:</p>
        <FormField lbl='מספר וואטסאפ עסקי'>
          <select
            className='h-10 w-full rounded-md border border-gray-200 bg-white px-3 focus:outline-2 focus:outline-offset-0 focus:outline-primary'
            value={selectedPhoneId}
            onChange={(e) => setSelectedPhoneId(e.target.value)}
          >
            <option value=''>בחר מספר...</option>
            {pendingPhones.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayPhone} — {p.verifiedName}
              </option>
            ))}
          </select>
        </FormField>
        <div data-edu='whatsapp-connect' className='w-fit'>
        <Btn
          lbl={loading ? 'מחבר...' : (notice?.action ?? 'חבר וואטסאפ')}
          icon={loading ? 'spinner' : 'comment-dots'}
          iconClassName={loading ? 'animate-spin' : undefined}
          size='medium'
          disabled={!selectedPhoneId || loading}
          className='w-fit'
          onClick={() => selected && connectPhone(selected)}
        />
        </div>
      </div>
    )
  }

  // State A: Not connected
  const notice = whatsappNotice(error ?? disconnectError ?? urlError)

  return (
    <div className='grid gap-4'>
      {notice && <ConnectionNotice notice={notice} />}
      <p className='text-sm text-gray-500'>{description}</p>
      <div data-edu='whatsapp-connect' className='w-fit'>
      <Btn
        lbl={loading ? 'מתחבר...' : (notice?.action ?? connectLabel)}
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
