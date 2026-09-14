'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { useAction } from '@/lib/useAction'
import { toast } from '@/lib/toast'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { REPLY_MAX_CHARS, type ReplyFailureReason } from '@/lib/facebook/comments/thread'
import { replyToComment } from '../replyActions'

/**
 * Reply to one comment as the Page. Pending state is local to this form
 * (frontend-experience §7); the rest of the list stays usable.
 *
 * Success is confirmed only after Meta returned the new comment id — the
 * server has already recorded it, so the refreshed thread shows the reply
 * rather than an optimistic bubble that might not exist on Facebook.
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

export default function CommentReplyForm({ commentId, authorName }: { commentId: string; authorName: string | null }) {
  const router = useRouter()
  const [draft, setDraft] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const { loading, run, accessDenied } = useAction()

  if (accessDenied) {
    return <SubscriptionExpiredState mode='inline' source='comment_reply' feature='חידוש המנוי מחזיר את ההשבה לתגובות' />
  }

  const submit = () =>
    run(async () => {
      setFailure(null)
      const result = await replyToComment(commentId, draft)
      if ('reason' in result) {
        setFailure(FAILURE_COPY[result.reason] ?? FAILURE_COPY.meta_error)
        return
      }
      setDraft('')
      toast('success', 'התשובה פורסמה בפייסבוק')
      router.refresh()
    })

  const inputId = `reply-${commentId}`

  return (
    <div className='mt-2 grid gap-1.5'>
      <label htmlFor={inputId} className='sr-only'>
        {`תשובה בשם הדף ל${authorName ? `־${authorName}` : 'תגובה'}`}
      </label>
      <textarea
        id={inputId}
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, REPLY_MAX_CHARS))}
        rows={2}
        disabled={loading}
        placeholder='כתוב תשובה בשם הדף...'
        aria-invalid={failure ? true : undefined}
        aria-describedby={failure ? `${inputId}-error` : undefined}
        className='w-full resize-none field-sizing-content rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50'
      />
      {failure && (
        <p id={`${inputId}-error`} role='alert' className='text-xs text-error-text'>
          {failure}
        </p>
      )}
      <Btn
        lbl={loading ? 'מפרסם...' : 'פרסם תשובה'}
        icon={loading ? 'spinner' : undefined}
        iconClassName={loading ? 'animate-spin' : undefined}
        variant='outline'
        size='small'
        className='w-fit'
        disabled={loading || draft.trim().length === 0}
        title={draft.trim().length === 0 ? 'כתוב תשובה כדי לפרסם' : undefined}
        onClick={submit}
      />
    </div>
  )
}
