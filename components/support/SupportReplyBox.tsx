'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { replyToSupportRequestAction } from '@/actions/support/requests'
import { supportErrorText } from '@/lib/support/localizedCopy'
import { useT } from '@/lib/i18n/I18nProvider'
import { Btn } from '@/lib/btns/Btn'

/**
 * Always available, including on a closed request.
 *
 * Replying reopens it, and the copy says so — rather than hiding a separate
 * "reopen" control the customer would have to find. If they still have the
 * problem, saying so IS the reopen.
 */
export default function SupportReplyBox({
  requestId,
  isResolved,
}: {
  requestId: number
  isResolved: boolean
}) {
  const router = useRouter()
  const t = useT()
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await replyToSupportRequestAction(requestId, body)
      if ('reason' in res) {
        setError(supportErrorText(res.reason, t.locale))
        return
      }
      setBody('')
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} className='mt-6 border-t border-gray-100 pt-5'>
      <label htmlFor='support-reply' className='block text-sm font-medium text-ink'>
        {t('support.reply.label')}
      </label>
      {isResolved && (
        <p className='mt-1 text-xs text-gray-500'>{t('support.reply.reopens')}</p>
      )}
      <textarea
        id='support-reply'
        rows={4}
        required
        maxLength={5000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t('support.reply.placeholder')}
        className='mt-2 w-full resize-y rounded-2xl border border-gray-200 p-3 text-sm leading-relaxed outline-none focus:border-primary'
      />
      {error && (
        <p role='alert' className='mt-2 text-sm font-medium text-error-text'>
          {error}
        </p>
      )}
      <Btn
        type='submit'
        lbl={pending ? t('support.form.sending') : t('support.reply.send')}
        disabled={pending}
        className='mt-3 w-full desktop:w-auto'
      />
    </form>
  )
}
