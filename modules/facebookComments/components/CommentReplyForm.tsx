'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { useAction } from '@/lib/useAction'
import { toast } from '@/lib/toast'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { REPLY_MAX_CHARS, type ReplyFailureReason } from '@/lib/facebook/comments/thread'
import { replyToComment } from '../replyActions'

/**
 * Reply to one comment as the Page — the composer a card opens on "ענה לתגובה".
 *
 * Pending state is local to this form (frontend-experience §7). A second click
 * while the first send is in flight sends nothing: `loading` is state, so two
 * clicks in one frame would both pass it, and the ref closes that window.
 *
 * Success is confirmed only after Meta returned the new comment id; the card
 * then shows the reply at once (`onSent`) and the refresh reconciles it with
 * the stored thread. A failure keeps the draft and says what to do.
 */
const FAILURE_COPY: Record<ReplyFailureReason, string> = {
  not_enabled: 'התכונה אינה זמינה בחשבון הזה',
  not_found: 'התגובה לא נמצאה',
  deleted: 'התגובה נמחקה בפייסבוק, ולא ניתן להשיב לה',
  page_authored: 'אי אפשר להשיב לתגובה של הדף עצמו',
  empty: 'כתוב תשובה לפני הפרסום',
  too_long: 'התשובה ארוכה מדי',
  permission_missing: 'חסרה הרשאה להשבה לתגובות. אשר את ההרשאה בראש העמוד ונסה שוב.',
  reconnect_required: 'החיבור לדף הפייסבוק פג. חבר מחדש את הדף בהגדרות ונסה שוב.',
  comment_unavailable: 'התגובה כבר לא זמינה בפייסבוק. ייתכן שנמחקה או הוסתרה.',
  rate_limited: 'פייסבוק מגביל כרגע את קצב הפעולות. נסה שוב בעוד כמה דקות.',
  blocked: 'פייסבוק חסם זמנית פרסום תגובות מהדף. כדאי לבדוק את ההתראות בדף הפייסבוק.',
  meta_error: 'פייסבוק לא אישר את פרסום התשובה. נסה שוב.',
}
const THROWN_COPY = 'לא הצלחנו לפרסם את התשובה. בדוק את החיבור ונסה שוב.'

export default function CommentReplyForm({
  commentId,
  authorName,
  onSent,
  onCancel,
}: {
  commentId: string
  authorName: string | null
  /** The reply Meta accepted, so the card can show it without a reload. */
  onSent?: (reply: { replyId: string; message: string }) => void
  onCancel?: () => void
}) {
  const router = useRouter()
  const [draft, setDraft] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const inFlight = useRef(false)
  const { loading, run, error, accessDenied } = useAction()

  if (accessDenied) {
    return <SubscriptionExpiredState mode='inline' source='comment_reply' feature='חידוש המנוי מחזיר את ההשבה לתגובות' />
  }

  const empty = draft.trim().length === 0
  const shownFailure = failure ?? (error ? THROWN_COPY : null)

  const submit = () => {
    if (inFlight.current || empty) return
    inFlight.current = true
    run(async () => {
      setFailure(null)
      try {
        const message = draft.trim()
        const result = await replyToComment(commentId, message)
        if ('reason' in result) {
          setFailure(FAILURE_COPY[result.reason] ?? FAILURE_COPY.meta_error)
          return
        }
        setDraft('')
        toast('success', 'התשובה פורסמה בפייסבוק')
        onSent?.({ replyId: result.replyId, message })
        router.refresh()
      } finally {
        inFlight.current = false
      }
    })
  }

  const inputId = `reply-${commentId}`

  return (
    <div className='mt-3 grid gap-2'>
      <label htmlFor={inputId} className='sr-only'>
        {`תשובה בשם הדף ל${authorName ? `־${authorName}` : 'תגובה'}`}
      </label>
      <textarea
        id={inputId}
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, REPLY_MAX_CHARS))}
        rows={3}
        autoFocus
        disabled={loading}
        placeholder='כתוב תשובה בשם הדף...'
        aria-invalid={shownFailure ? true : undefined}
        aria-describedby={shownFailure ? `${inputId}-error` : undefined}
        className='w-full resize-none field-sizing-content rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50'
      />
      {shownFailure && (
        <p id={`${inputId}-error`} role='alert' className='text-xs text-error-text'>
          {shownFailure}
        </p>
      )}
      <div className='flex flex-wrap items-center gap-2'>
        <Btn
          lbl={loading ? 'מפרסם...' : 'פרסם תשובה'}
          icon={loading ? 'spinner' : undefined}
          iconClassName={loading ? 'animate-spin' : undefined}
          size='small'
          disabled={loading || empty}
          title={empty ? 'כתוב תשובה כדי לפרסם' : undefined}
          onClick={submit}
        />
        {onCancel && <Btn variant='ghost' size='small' lbl='ביטול' disabled={loading} onClick={onCancel} />}
      </div>
    </div>
  )
}
