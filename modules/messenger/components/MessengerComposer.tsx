'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Send } from 'lucide-react'
import { useAction } from '@/lib/useAction'
import { toast } from '@/lib/toast'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { MESSENGER_TEXT_MAX, type MessengerSendFailure } from '@/lib/facebook/messenger/rules'
import { sendMessengerReply } from '../actions'

const FAILURE_COPY: Record<MessengerSendFailure, string> = {
  not_enabled: 'Messenger אינו זמין בחשבון הזה',
  not_found: 'השיחה לא נמצאה',
  empty: 'כתוב הודעה לפני השליחה',
  too_long: 'ההודעה ארוכה מדי (עד 2,000 תווים)',
  window_closed: 'עברו יותר מ-24 שעות מההודעה האחרונה של הפונה, ולכן פייסבוק לא מאפשר לשלוח. אפשר להשיב כשהפונה יכתוב שוב.',
  permission_missing: 'חסרה הרשאה לשליחת הודעות Messenger. אשר את ההרשאה ונסה שוב.',
  reconnect_required: 'החיבור לדף הפייסבוק פג. חבר מחדש את הדף בהגדרות ונסה שוב.',
  recipient_unavailable: 'לא ניתן לשלוח לפונה הזה כרגע. ייתכן שחסם את הדף או שהחשבון אינו זמין.',
  rate_limited: 'פייסבוק מגביל כרגע את קצב השליחה. נסה שוב בעוד כמה דקות.',
  meta_error: 'פייסבוק לא אישר את שליחת ההודעה. נסה שוב.',
}

/**
 * Text reply inside the 24-hour window. The window decision is made on the
 * server (page render and again in the action) and passed in as `windowOpen`
 * and `windowHint`; this component never reads the clock.
 *
 * No optimistic bubble: a Messenger message exists only once Meta returned its
 * id, and the server records it before the refresh shows it.
 */
export default function MessengerComposer({
  conversationId,
  windowOpen,
  windowHint,
}: {
  conversationId: number
  windowOpen: boolean
  windowHint: string | null
}) {
  const router = useRouter()
  const [draft, setDraft] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const { loading, run, accessDenied } = useAction()

  if (accessDenied) {
    return <SubscriptionExpiredState mode='inline' source='messenger_reply' feature='חידוש המנוי מחזיר את שליחת ההודעות' />
  }

  if (!windowOpen) {
    return (
      <div role='status' className='rounded-md border border-amber-300 bg-amber-50 p-3'>
        <p className='text-sm font-medium text-amber-800'>חלון המענה נסגר</p>
        <p className='mt-1 text-sm text-amber-700'>
          פייסבוק מאפשר להשיב ב-Messenger עד 24 שעות מההודעה האחרונה של הפונה. כשהפונה יכתוב שוב, אפשר יהיה להשיב מכאן.
        </p>
      </div>
    )
  }

  const canSend = draft.trim().length > 0 && !loading
  const send = () =>
    run(async () => {
      if (!draft.trim()) return
      setFailure(null)
      const result = await sendMessengerReply(conversationId, draft)
      if ('reason' in result) {
        setFailure(FAILURE_COPY[result.reason] ?? FAILURE_COPY.meta_error)
        return
      }
      setDraft('')
      toast('success', 'ההודעה נשלחה ב-Messenger')
      router.refresh()
    })

  return (
    <div>
      <div className='flex items-end gap-1.5'>
        <label htmlFor='messenger-reply' className='sr-only'>
          תשובה ב-Messenger
        </label>
        <textarea
          id='messenger-reply'
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MESSENGER_TEXT_MAX))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (canSend) send()
            }
          }}
          rows={1}
          disabled={loading}
          placeholder='כתוב תשובה...'
          aria-invalid={failure ? true : undefined}
          aria-describedby={failure ? 'messenger-reply-error' : undefined}
          className='max-h-32 min-w-0 flex-1 resize-none field-sizing-content rounded-3xl border border-gray-200 bg-white px-4 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50'
        />
        <button
          type='button'
          onClick={send}
          disabled={!canSend}
          aria-label={loading ? 'שולח הודעה' : 'שלח הודעה'}
          title={draft.trim() ? 'שלח הודעה' : 'כתוב הודעה כדי לשלוח'}
          className='flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50'
        >
          <Send aria-hidden className='size-4 -scale-x-100' />
        </button>
      </div>
      {failure && (
        <p id='messenger-reply-error' role='alert' className='mt-1 text-xs text-error-text'>
          {failure}
        </p>
      )}
      {!failure && windowHint && <p className='mt-1 ps-2 text-[11px] text-gray-500'>{windowHint}</p>}
    </div>
  )
}
