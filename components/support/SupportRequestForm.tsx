'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createSupportRequestAction } from '@/actions/support/requests'
import { supportErrorMessage } from '@/lib/support/copy'
import type { SupportKind } from '@/lib/support/vocabulary'
import { Btn } from '@/lib/btns/Btn'
import { toast } from '@/lib/toast'

/**
 * ONE FIELD. That is the whole design.
 *
 * The customer is never asked for a subject, a category, a priority or a
 * severity — someone whose WhatsApp just stopped working should not have to
 * classify their own problem before they can tell us. The server derives
 * subject and category (lib/support/derive.ts).
 *
 * `bodyOptional` exists for the Phase 4 context flow: once SocialCRM resolves
 * "החיבור ל-WhatsApp נותק" on its own, the report is already complete and this
 * field becomes "anything you want to add" rather than a demand to retype it.
 * Nothing else about this component changes when that lands.
 */
export default function SupportRequestForm({
  kind,
  bodyOptional = false,
}: {
  kind: SupportKind
  /** True when the SERVER resolved a context. Phase 4 supplies it. */
  bodyOptional?: boolean
}) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await createSupportRequestAction({
        body,
        kind,
        clientRoute: window.location.pathname,
      })
      // `'reason' in res`, not `!res.ok` — strictNullChecks is off and a boolean
      // discriminant does not narrow. The house convention.
      if ('reason' in res) {
        setError(supportErrorMessage(res.reason))
        return
      }
      toast('success', 'הפנייה נשלחה. נחזור אליך בהקדם.')
      router.push(`/support/requests/${res.requestId}`)
    })
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor='support-body' className='block text-base font-medium text-ink'>
        מה קרה?
      </label>
      <p className='mt-1 text-sm text-gray-500'>
        {bodyOptional
          ? 'כבר יש לנו את הפרטים. אפשר להוסיף כל דבר שיעזור לנו.'
          : 'כמה מילים על מה שקרה ומתי. אין צורך בפרטים טכניים.'}
      </p>

      <textarea
        id='support-body'
        autoFocus
        rows={7}
        required={!bodyOptional}
        maxLength={5000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={bodyOptional ? 'רוצה להוסיף משהו? (לא חובה)' : 'לדוגמה: הודעות מוואטסאפ הפסיקו להיכנס מהבוקר'}
        className='mt-3 w-full resize-y rounded-xl border border-gray-200 p-3 text-sm leading-relaxed outline-none focus:border-primary'
      />

      {error && (
        <p role='alert' className='mt-2 text-sm font-medium text-error-text'>
          {error}
        </p>
      )}

      {/* Pending is local to this control — never a page overlay. */}
      <Btn
        type='submit'
        lbl={pending ? 'שולח…' : 'שליחת הפנייה'}
        disabled={pending}
        className='mt-4'
      />
    </form>
  )
}
