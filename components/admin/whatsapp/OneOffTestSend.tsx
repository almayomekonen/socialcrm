'use client'

import { useState, useTransition } from 'react'
import { sendOwnerWaOneOffTestAction, type OwnerWaOneOffActionResult } from '@/actions/admin/ownerWaOneOff'
import { Btn } from '@/lib/btns/Btn'

/**
 * ONE test owner reminder to the configured, consented agency-103 recipient
 * (rendered only when OWNER_WA_ONE_OFF_RECIPIENT_ID is set). The owner names a
 * real conversation, confirms it, and the action runs once. After any answer
 * the control stays disabled: an `unknown` outcome must never be retried.
 * Pending is local to the button.
 */

const REFUSAL_COPY: Record<string, string> = {
  already_used: 'בדיקת השליחה כבר נוצלה. אי אפשר לשלוח שוב.',
  conversation_not_eligible: 'השיחה לא עומדת בתנאים: היא צריכה להיות פתוחה, מועברת לנציג, בלי מענה אנושי ובת פחות מ-24 שעות.',
  recipient_not_active: 'מקבל התזכורת אינו פעיל או לא אישר קבלת הודעות.',
  recipient_not_selected: 'מקבל התזכורת אינו מתאים לשיחה הזו (למשל, אושר אחרי ההעברה לנציג).',
  already_reminded: 'כבר נשלחה תזכורת על ההעברה הזו.',
  quiet_hours: 'עכשיו שעות שקטות של החשבון. אפשר לנסות אחריהן.',
  agency_not_allowlisted: 'החשבון אינו ברשימת ההיתר של התזכורות.',
  agency_no_access: 'לחשבון אין כרגע גישה פעילה למוצר.',
  platform_not_configured: 'מספר הוואטסאפ של המערכת אינו מוגדר.',
  not_configured: 'בדיקת השליחה אינה מופעלת.',
}

function describe(r: OwnerWaOneOffActionResult): { tone: 'ok' | 'bad'; text: string } {
  switch (r.outcome) {
    case 'sent':
      return { tone: 'ok', text: `Meta קיבלה את ההודעה (מזהה ${r.wamid}). המסירה תאושר רק כשהיא תופיע בטלפון או בסטטוס המסירה.` }
    case 'unknown':
      return { tone: 'bad', text: 'התוצאה לא ודאית: ייתכן שההודעה נשלחה. לא לנסות שוב.' }
    case 'failed':
      return { tone: 'bad', text: `Meta דחתה את השליחה${r.code ? ` (קוד ${r.code})` : ''}. לא נשלחה הודעה.` }
    case 'cancelled':
      return { tone: 'bad', text: 'השליחה בוטלה לפני ששלחנו: התנאים השתנו ברגע האחרון. לא נשלחה הודעה.' }
    case 'refused':
      return { tone: 'bad', text: REFUSAL_COPY[r.reason] ?? 'השליחה נדחתה. לא נשלחה הודעה.' }
    case 'invalid':
      return { tone: 'bad', text: 'מזהה השיחה אינו תקין.' }
    case 'forbidden':
      return { tone: 'bad', text: 'אין הרשאה לפעולה הזו.' }
    default:
      return { tone: 'bad', text: 'הפעולה נכשלה. לא לנסות שוב לפני בדיקה.' }
  }
}

export default function OneOffTestSend() {
  const [raw, setRaw] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<OwnerWaOneOffActionResult | null>(null)
  const [pending, startTransition] = useTransition()
  const conversationId = /^\d{1,15}$/.test(raw.trim()) ? Number(raw.trim()) : null
  const done = result !== null && result.outcome !== 'invalid'

  function send() {
    if (!conversationId) return
    startTransition(async () => {
      setResult(await sendOwnerWaOneOffTestAction(conversationId))
      setConfirming(false)
    })
  }

  const shown = result ? describe(result) : null

  return (
    <section aria-labelledby='one-off-test-send' className='mt-8 rounded-2xl border border-gray-200 bg-white p-4'>
      <h2 id='one-off-test-send' className='text-sm font-semibold text-gray-900'>
        שליחת תזכורת בדיקה אחת
      </h2>
      <p className='mt-1 text-sm text-gray-500'>
        שולח פעם אחת בלבד את התבנית המאושרת למקבל שאישר, על שיחה אמיתית של החשבון. אי אפשר לשלוח שוב אחרי הניסיון.
      </p>
      <label htmlFor='one-off-conversation-id' className='mt-4 block text-sm font-medium text-gray-900'>
        מזהה השיחה
      </label>
      <input
        id='one-off-conversation-id'
        inputMode='numeric'
        autoComplete='off'
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value)
          setConfirming(false)
        }}
        disabled={pending || done}
        className='mt-2 w-full rounded-xl border border-gray-200 p-3 text-sm outline-none focus:border-primary desktop:w-64'
      />
      {!confirming ? (
        <Btn
          type='button'
          lbl='שליחת תזכורת בדיקה אחת'
          onClick={() => setConfirming(true)}
          disabled={!conversationId || pending || done}
          className='mt-3 w-full desktop:w-auto'
        />
      ) : (
        <div className='mt-3 flex flex-wrap gap-2'>
          <Btn
            type='button'
            lbl={pending ? 'שולח…' : `לאשר שליחה על שיחה ${conversationId}`}
            onClick={send}
            disabled={pending || done}
            className='w-full desktop:w-auto'
          />
          <Btn type='button' lbl='ביטול' variant='outline' onClick={() => setConfirming(false)} disabled={pending} className='w-full desktop:w-auto' />
        </div>
      )}
      {shown && (
        <p role={shown.tone === 'ok' ? 'status' : 'alert'} className={`mt-3 text-sm font-medium ${shown.tone === 'ok' ? 'text-green-800' : 'text-error-text'}`}>
          {shown.text}
        </p>
      )}
    </section>
  )
}
