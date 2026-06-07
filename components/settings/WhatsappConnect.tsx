'use client'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { FormField } from '@/lib/form'
import ConfirmPop from '@/lib/modals/ConfirmPop'

type Phone = { id: string; displayPhone: string; verifiedName: string; accessToken: string }
type Connection = { phoneNumberId: string }

type Props = {
  connection: Connection | null
  pendingPhones: Phone[] | null
}

const ERROR_MESSAGES: Record<string, string> = {
  denied: 'לא אושרו הרשאות וואטסאפ.',
  state: 'שגיאת אבטחה. אנא נסה שוב.',
  token: 'שגיאה בהתחברות לוואטסאפ. אנא נסה שוב.',
  no_accounts: 'לא נמצאו חשבונות וואטסאפ עסקיים. יש לוודא שיש לך גישת מנהל.',
  no_phones: 'לא נמצאו מספרי טלפון בחשבון. יש להוסיף מספר לחשבון וואטסאפ העסקי.',
}

export default function WhatsappConnect({ connection, pendingPhones }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlError = searchParams.get('wa_error')

  const [selectedPhoneId, setSelectedPhoneId] = useState('')
  const [loading, setLoading] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  async function performDisconnect() {
    setConfirmDisconnect(false)
    setLoading(true)
    await fetch('/api/auth/whatsapp/disconnect', { method: 'POST' })
    router.refresh()
  }

  // State C: Already connected
  if (connection) {
    return (
      <div className='grid gap-4'>
        <p className='text-sm text-green-600'>החיבור תקין — לידים מגיעים אוטומטית</p>
        <p className='text-sm text-gray-600'>
          מספר מזוהה: <strong>{connection.phoneNumberId}</strong>
        </p>
        <Btn
          lbl='נתק וואטסאפ'
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
        <FormField lbl='מספר וואטסאפ עסקי' error={connectError ?? undefined}>
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
          lbl='חבר וואטסאפ'
          icon='comment-dots'
          size='medium'
          disabled={!selectedPhoneId || loading}
          className='w-fit'
          onClick={async () => {
            if (!selected) return
            setLoading(true)
            setConnectError(null)
            const res = await fetch('/api/auth/whatsapp/connect', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                phoneNumberId: selected.id,
                accessToken: selected.accessToken,
              }),
            })
            if (res.ok) {
              router.refresh()
            } else {
              setConnectError('שגיאה בחיבור. אנא נסה שוב.')
              setLoading(false)
            }
          }}
        />
      </div>
    )
  }

  // State A: Not connected
  return (
    <div className='grid gap-4'>
      {urlError && (
        <p className='text-sm text-red-600'>{ERROR_MESSAGES[urlError] ?? 'שגיאה בהתחברות לוואטסאפ.'}</p>
      )}
      <p className='text-sm text-gray-500'>חבר את מספר הוואטסאפ העסקי שלך כדי לקבל לידים אוטומטית.</p>
      <Btn lbl='חבר וואטסאפ עסקי' icon='whatsapp' href='/api/auth/whatsapp' className='w-fit bg-green-600' />
    </div>
  )
}
