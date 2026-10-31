'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createSupportRequestAction } from '@/actions/support/requests'
import { supportErrorText } from '@/lib/support/localizedCopy'
import { useT } from '@/lib/i18n/I18nProvider'
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
 * The page heading carries "מה קרה?" / "מה השאלה?". This component owns only
 * the textarea and the send control, so the screen never reads like a ticket
 * form with redundant labels.
 *
 * `bodyOptional` exists for the Phase 4 context flow: once SocialCRM resolves
 * "החיבור ל-WhatsApp נותק" on its own, the report is already complete and this
 * field becomes "anything you want to add" rather than a demand to retype it.
 * Nothing else about this component changes when that lands.
 */
export default function SupportRequestForm({
  kind,
  bodyOptional = false,
  fieldLabel,
}: {
  kind: SupportKind
  /** True when the SERVER resolved a context. Phase 4 supplies it. */
  bodyOptional?: boolean
  /** Accessible name for the textarea. The page h1 usually carries the same words. */
  fieldLabel?: string
}) {
  const router = useRouter()
  const t = useT()
  const label = fieldLabel ?? t('support.kind.problem.formTitle')
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
        setError(supportErrorText(res.reason, t.locale))
        return
      }
      toast('success', t('support.form.sent'))
      router.push(`/support/requests/${res.requestId}`)
    })
  }

  return (
    <form onSubmit={submit} className='mt-1'>
      {bodyOptional && (
        <label htmlFor='support-body' className='block text-base font-medium text-ink'>
          {t('support.form.addMore')}
        </label>
      )}

      <textarea
        id='support-body'
        autoFocus
        rows={8}
        required={!bodyOptional}
        maxLength={5000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-label={bodyOptional ? t('support.form.addMore') : label}
        placeholder={
          bodyOptional ? t('support.form.addMorePlaceholder') : t('support.form.placeholder')
        }
        className='mt-3 w-full resize-y rounded-2xl border border-gray-200 bg-white p-4 text-base leading-relaxed text-ink outline-none placeholder:text-gray-400 focus:border-primary'
      />

      {error && (
        <p role='alert' className='mt-2 text-sm font-medium text-error-text'>
          {error}
        </p>
      )}

      {/* Pending is local to this control — never a page overlay. */}
      <Btn
        type='submit'
        lbl={pending ? t('support.form.sending') : t('support.form.send')}
        disabled={pending}
        className='mt-5 w-full desktop:w-auto'
      />
    </form>
  )
}
