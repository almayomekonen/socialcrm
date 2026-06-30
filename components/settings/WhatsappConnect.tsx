'use client'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { FormField } from '@/lib/form'
import { useAction } from '@/lib/useAction'
import { useEmbeddedSignup } from '@/lib/facebook/useEmbeddedSignup'
import ConfirmPop from '@/lib/modals/ConfirmPop'

type Phone = { id: string; displayPhone: string; verifiedName: string }
type Connection = { phoneNumberId: string }

type Props = {
  connection: Connection | null
  pendingPhones: Phone[] | null
  appId: string
  configId: string
  graphVersion: string
  messagingReady: boolean
}

const ERROR_MESSAGES: Record<string, string> = {
  denied: 'לא אושרו הרשאות וואטסאפ.',
  state: 'שגיאת אבטחה. אנא נסה שוב.',
  token: 'שגיאה בהתחברות לוואטסאפ. אנא נסה שוב.',
  no_accounts: 'לא נמצאו חשבונות וואטסאפ עסקיים. יש לוודא שיש לך גישת מנהל.',
  no_phones: 'לא נמצאו מספרי טלפון בחשבון. יש להוסיף מספר לחשבון וואטסאפ העסקי.',
  sdk: 'טעינת ההתחברות נכשלה. רענן את העמוד ונסה שוב.',
  config: 'תצורת ההתחברות חסרה. פנה לתמיכה.',
  server: 'שגיאה בהתחברות לוואטסאפ. אנא נסה שוב.',
  network: 'בעיית רשת. אנא נסה שוב.',
}

export default function WhatsappConnect({
  connection,
  pendingPhones,
  appId,
  configId,
  graphVersion,
  messagingReady,
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
      setError(ERROR_MESSAGES[result.error ?? ''] ?? 'שגיאה בהתחברות לוואטסאפ. אנא נסה שוב.')
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
        setError('שגיאה בחיבור. אנא נסה שוב.')
        return
      }
      router.refresh()
    })
  }

  // State C: Already connected
  if (connection) {
    return (
      <div className='grid gap-4'>
        {messagingReady ? (
          <p className='text-sm text-green-600'>החיבור תקין — לידים מגיעים אוטומטית</p>
        ) : (
          <div className='rounded-md border border-amber-300 bg-amber-50 p-3'>
            <p className='text-sm font-medium text-amber-800'>המספר חובר אך עדיין לא פעיל לקבלת הודעות</p>
            <p className='mt-1 text-sm text-amber-700'>
              יש להשלים את רישום המספר בוואטסאפ העסקי (אימות מספר והגדרת אימות דו-שלבי). עד להשלמה, הודעות לא יתקבלו.
            </p>
          </div>
        )}
        <p className='text-sm text-gray-600'>
          מספר מזוהה: <strong>{connection.phoneNumberId}</strong>
        </p>
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

    return (
      <div className='grid gap-4'>
        <p className='text-sm text-gray-600'>בחר את מספר הטלפון שברצונך לחבר:</p>
        <FormField lbl='מספר וואטסאפ עסקי' error={error ?? undefined}>
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
        <Btn
          lbl={loading ? 'מחבר...' : 'חבר וואטסאפ'}
          icon={loading ? 'spinner' : 'comment-dots'}
          iconClassName={loading ? 'animate-spin' : undefined}
          size='medium'
          disabled={!selectedPhoneId || loading}
          className='w-fit'
          onClick={() => selected && connectPhone(selected)}
        />
      </div>
    )
  }

  // State A: Not connected
  return (
    <div className='grid gap-4'>
      {(error || urlError) && (
        <p className='text-sm text-red-600'>{error ?? ERROR_MESSAGES[urlError!] ?? 'שגיאה בהתחברות לוואטסאפ.'}</p>
      )}
      <p className='text-sm text-gray-500'>חבר את מספר הוואטסאפ העסקי שלך כדי לקבל לידים אוטומטית.</p>
      <Btn
        lbl={loading ? 'מתחבר...' : 'חבר וואטסאפ עסקי'}
        icon={loading ? 'spinner' : 'whatsapp'}
        iconClassName={loading ? 'animate-spin' : undefined}
        disabled={loading}
        className='w-fit bg-green-600'
        onClick={startEmbeddedSignup}
      />
    </div>
  )
}
