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
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlError = searchParams.get('wa_error')

  const [selectedPhoneId, setSelectedPhoneId] = useState('')
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const { loading, error, setError, run } = useAction()
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
    run(async () => {
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
    const notice = noticeForHealth(status)
    const canReconnect = status === 'unknown' || status === 'token' || status === 'webhook'
    return (
      <div className='grid gap-4' data-edu={canReconnect ? undefined : 'whatsapp-connect'}>
        {status === 'operational' && (
          <p className='text-sm text-green-600'>החיבור תקין — לידים מגיעים אוטומטית</p>
        )}
        {notice && <ConnectionNotice notice={notice} />}
        {canReconnect && (
          <div data-edu='whatsapp-connect' className='w-fit'>
          <Btn
            lbl={loading ? 'מתחבר...' : (notice?.action ?? 'לחבר מחדש ולאמת')}
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
          lbl={loading ? 'מנתק...' : 'נתק וואטסאפ'}
          icon={loading ? 'spinner' : undefined}
          iconClassName={loading ? 'animate-spin' : undefined}
          variant='destructive'
          size='small'
          className='w-fit'
          disabled={loading}
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
  const notice = whatsappNotice(error ?? urlError)

  return (
    <div className='grid gap-4'>
      {notice && <ConnectionNotice notice={notice} />}
      <p className='text-sm text-gray-500'>חבר את מספר הוואטסאפ העסקי שלך כדי לקבל לידים אוטומטית.</p>
      <div data-edu='whatsapp-connect' className='w-fit'>
      <Btn
        lbl={loading ? 'מתחבר...' : (notice?.action ?? 'חבר וואטסאפ עסקי')}
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
