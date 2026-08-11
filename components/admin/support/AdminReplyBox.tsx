'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { replyAsSupportAction } from '@/actions/support/admin'
import { Btn } from '@/lib/btns/Btn'

/**
 * The reply the customer will read as "צוות SocialCRM". The owner's identity is
 * recorded server-side for internal attribution and never rendered to them.
 */
export default function AdminReplyBox({ requestId }: { requestId: number }) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await replyAsSupportAction(requestId, body)
      if ('reason' in res) {
        setError(res.reason === 'invalid_body' ? 'צריך לכתוב תשובה' : 'הפעולה נכשלה. נסו שוב.')
        return
      }
      setBody('')
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} className='mt-6 rounded-2xl border border-gray-200 bg-white p-4'>
      <label htmlFor='admin-reply' className='block text-sm font-medium text-gray-900'>
        כתוב תשובה
      </label>
      <textarea
        id='admin-reply'
        rows={5}
        required
        maxLength={5000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder='כתוב תשובה...'
        className='mt-2 w-full resize-y rounded-xl border border-gray-200 p-3 text-sm leading-relaxed outline-none focus:border-primary'
      />
      {error && (
        <p role='alert' className='mt-2 text-sm font-medium text-error-text'>
          {error}
        </p>
      )}
      <Btn
        type='submit'
        lbl={pending ? 'שולח…' : 'שלח'}
        disabled={pending}
        className='mt-3 w-full desktop:w-auto'
      />
    </form>
  )
}
