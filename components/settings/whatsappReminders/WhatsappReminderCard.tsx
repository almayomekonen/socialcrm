'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { startWhatsappReminderActivation, turnOffWhatsappReminders } from '@/actions/whatsappReminders'
import { Btn } from '@/lib/btns/Btn'
import { Checkbox } from '@/lib/form'
import { toast } from '@/lib/toast'
import { OWNER_WA_CONSENT } from '@/lib/whatsapp/platform/consentText'
import type { OwnerReminderView } from '@/lib/whatsapp/platform/ownerReminderView'

/**
 * One card, four states: off / waiting for the code / active / stopped. The
 * code is shown once, right after it is issued; nothing is sent from here.
 */
export default function WhatsappReminderCard({ initial }: { initial: OwnerReminderView }) {
  const router = useRouter()
  const [consent, setConsent] = useState(false)
  const [issued, setIssued] = useState<{ code: string; waMeHref: string } | null>(null)
  const [busy, startTransition] = useTransition()

  function start() {
    startTransition(async () => {
      const res = await startWhatsappReminderActivation({ consent })
      if ('fail' in res) return toast('error', res.msg)
      setIssued({ code: res.code, waMeHref: res.waMeHref })
    })
  }

  function turnOff() {
    startTransition(async () => {
      const res = await turnOffWhatsappReminders()
      if ('fail' in res) return toast('error', res.msg)
      setIssued(null)
      setConsent(false)
      toast('success', 'התזכורות כובו')
      router.refresh()
    })
  }

  if (initial.state === 'active') {
    return (
      <div className='space-y-4'>
        <p className='text-sm'>
          התזכורות פעילות ונשלחות למספר <span dir='ltr'>{initial.maskedPhone}</span>
        </p>
        <p className='text-sm text-gray-600 leading-relaxed'>כדי להפסיק אפשר גם לשלוח &quot;הסר&quot; למספר של SocialCRM</p>
        <Btn type='button' variant='outline' lbl='כיבוי תזכורות' onClick={turnOff} disabled={busy} />
      </div>
    )
  }

  if (issued) {
    return (
      <div className='space-y-4'>
        <p className='text-sm'>כדי לאמת את המספר, שלחו את קוד ההפעלה מהטלפון שלכם בוואטסאפ:</p>
        <p dir='ltr' className='text-2xl font-semibold tracking-widest text-center'>
          {issued.code}
        </p>
        <p className='text-sm text-gray-600 leading-relaxed'>הקוד תקף ל-15 דקות. אחרי השליחה, בדקו כאן שהתזכורות פעילות.</p>
        <div className='flex flex-wrap gap-3'>
          <Btn
            type='button'
            lbl='שליחת הקוד בוואטסאפ'
            onClick={() => window.open(issued.waMeHref, '_blank', 'noopener,noreferrer')}
          />
          <Btn type='button' variant='outline' lbl='בדיקה אם התזכורות פעילות' onClick={() => router.refresh()} />
        </div>
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      {initial.state === 'opted_out' && <p className='text-sm'>התזכורות כבויות</p>}
      {initial.state === 'pending' && (
        <p className='text-sm text-gray-600 leading-relaxed'>
          נוצר קוד הפעלה שעדיין לא נשלח. הקוד מוצג פעם אחת בלבד, אפשר ליצור קוד חדש.
        </p>
      )}
      <Checkbox lbl={OWNER_WA_CONSENT.text} checked={consent} onChange={(e) => setConsent(e.target.checked)} />
      <Btn
        type='button'
        lbl={initial.state === 'pending' ? 'יצירת קוד הפעלה חדש' : 'הפעלת תזכורות בוואטסאפ'}
        onClick={start}
        disabled={!consent || busy}
        title={consent ? undefined : 'צריך לאשר קבלת תזכורות'}
      />
      {initial.state === 'pending' && (
        <Btn type='button' variant='outline' lbl='ביטול' onClick={turnOff} disabled={busy} />
      )}
    </div>
  )
}
