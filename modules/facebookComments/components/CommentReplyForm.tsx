'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { useAction } from '@/lib/useAction'
import { toast } from '@/lib/toast'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { REPLY_MAX_CHARS, type ReplyFailureReason } from '@/lib/facebook/comments/thread'
import { replyToComment } from '../replyActions'
import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

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
const FAILURE_KEYS: Record<ReplyFailureReason, MessageKey> = {
  not_enabled: 'inbox.comments.reply.failure.not_enabled',
  not_found: 'inbox.comments.reply.failure.not_found',
  deleted: 'inbox.comments.reply.failure.deleted',
  page_authored: 'inbox.comments.reply.failure.page_authored',
  empty: 'inbox.comments.reply.failure.empty',
  too_long: 'inbox.comments.reply.failure.too_long',
  permission_missing: 'inbox.comments.reply.failure.permission_missing',
  reconnect_required: 'inbox.comments.reply.failure.reconnect_required',
  comment_unavailable: 'inbox.comments.reply.failure.comment_unavailable',
  rate_limited: 'inbox.comments.reply.failure.rate_limited',
  blocked: 'inbox.comments.reply.failure.blocked',
  meta_error: 'inbox.comments.reply.failure.meta_error',
}

export default function CommentReplyForm({
  commentId,
  authorName,
  onSent,
  onCancel,
  locale = 'he',
}: {
  commentId: string
  authorName: string | null
  /** The reply Meta accepted, so the card can show it without a reload. */
  onSent?: (reply: { replyId: string; message: string }) => void
  onCancel?: () => void
  /** Our labels and messages; the draft is the rep's own text and is never touched. */
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  const router = useRouter()
  const [draft, setDraft] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const inFlight = useRef(false)
  const { loading, run, error, accessDenied } = useAction()

  if (accessDenied) {
    return (
      <SubscriptionExpiredState
        mode='inline'
        source='comment_reply'
        feature={t('inbox.comments.reply.expired')}
        translated={locale !== 'he'}
      />
    )
  }

  const empty = draft.trim().length === 0
  const shownFailure = failure ?? (error ? t('inbox.comments.reply.thrown') : null)

  const submit = () => {
    if (inFlight.current || empty) return
    inFlight.current = true
    run(async () => {
      setFailure(null)
      try {
        const message = draft.trim()
        const result = await replyToComment(commentId, message)
        if ('reason' in result) {
          setFailure(t(FAILURE_KEYS[result.reason] ?? FAILURE_KEYS.meta_error))
          return
        }
        setDraft('')
        toast('success', t('inbox.comments.reply.published'))
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
        {authorName ? t('inbox.comments.reply.label', { name: authorName }) : t('inbox.comments.reply.labelNoName')}
      </label>
      <textarea
        id={inputId}
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, REPLY_MAX_CHARS))}
        rows={3}
        autoFocus
        disabled={loading}
        placeholder={t('inbox.comments.reply.placeholder')}
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
          lbl={loading ? t('inbox.comments.reply.publishing') : t('inbox.comments.reply.publish')}
          icon={loading ? 'spinner' : undefined}
          iconClassName={loading ? 'animate-spin' : undefined}
          size='small'
          disabled={loading || empty}
          title={empty ? t('inbox.comments.reply.emptyHint') : undefined}
          onClick={submit}
        />
        {onCancel && <Btn variant='ghost' size='small' lbl={t('inbox.comments.reply.cancel')} disabled={loading} onClick={onCancel} />}
      </div>
    </div>
  )
}
