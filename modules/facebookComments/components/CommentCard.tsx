'use client'

import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { formatBusinessDateTime } from '@/lib/today/time'
import ChannelIcon from '@/modules/inbox/components/ChannelIcon'
import MessengerAvatar from '@/modules/messenger/components/MessengerAvatar'
import { facebookCommentUrl } from '@/lib/facebook/comments/links'
import ConvertCommentButton from './ConvertCommentButton'
import CommentBody from './CommentBody'
import CommentPostContext from './CommentPostContext'
import CommentThread from './CommentThread'
import CommentReplyForm from './CommentReplyForm'
import { badgeStatus, hasLeadSlot } from '../rowState'
import type { CommentListItem, CommentPost, CommentReply, CommentStatus } from '../types'
import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * One comment in the comments inbox, as a card: who wrote it, what they wrote,
 * on which post, what SocialCRM has done about it, and the next action.
 *
 * Hierarchy: the comment text leads; post context sits below it, quieter; the
 * one primary action is "המר לליד" (or "פתח ליד" once linked), with "ענה לתגובה"
 * beside it. The reply composer opens inside the card only when asked for.
 *
 * NO CONTACT DETAILS ARE SHOWN OR IMPLIED: a comment carries a display name and
 * a Page-scoped id, nothing callable. The id itself is never rendered.
 */

// Open is the normal state of a comment in this inbox (and what the filter
// already says), so it carries no badge — a label on every card is noise.
const STATUS_BADGE: Partial<Record<CommentStatus, { label: MessageKey; cls: string }>> = {
  converted: { label: 'inbox.comments.card.badge.converted', cls: 'bg-green-50 text-green-700' },
  ignored: { label: 'inbox.comments.card.badge.ignored', cls: 'bg-gray-100 text-gray-600' },
  deleted: { label: 'inbox.comments.card.badge.deleted', cls: 'bg-gray-100 text-gray-500' },
}

export default function CommentCard({
  comment: c,
  post,
  thread,
  canReply,
  leavesViewOnConvert = false,
  touch = false,
  locale = 'he',
}: {
  comment: CommentListItem
  post: CommentPost | undefined
  /** This comment's thread, oldest first. */
  thread: CommentReply[]
  /** The comment's Page carries the reply permission and replies are rolled out. */
  canReply: boolean
  leavesViewOnConvert?: boolean
  /** Phone: 44px tap targets on every action. */
  touch?: boolean
  /** The page's interface language for our labels; names and text are the commenter's. */
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  const author = c.authorName ?? t('inbox.comments.card.fallbackAuthor')
  const [composing, setComposing] = useState(false)
  // Replies published from this card, shown at once; the refresh brings the
  // stored copy, and the id keeps the two from appearing twice.
  const [sent, setSent] = useState<CommentReply[]>([])

  // createdTime is nullable (Meta may omit created_time); receivedAt is not.
  const when = c.createdTime ?? c.receivedAt
  const shown = badgeStatus(c)
  const badge = shown ? (STATUS_BADGE[shown] ?? null) : null
  const replyable = canReply && c.status !== 'deleted'
  const stored = new Set(thread.map((r) => r.commentId))
  const fullThread = [...thread, ...sent.filter((r) => !stored.has(r.commentId))]

  const onSent = ({ replyId, message }: { replyId: string; message: string }) => {
    const now = new Date()
    setSent((prev) => [
      ...prev,
      {
        id: -now.getTime(),
        pageId: c.pageId,
        commentId: replyId,
        parentId: c.commentId,
        authorName: null,
        authorIsPage: true,
        sentByUserId: null,
        sentHere: true,
        message,
        messageAvailable: true,
        status: 'open',
        createdTime: now,
        receivedAt: now,
      },
    ])
    setComposing(false)
  }

  return (
    <article
      aria-label={t('inbox.comments.card.label', { name: author })}
      className='flex flex-col rounded-lg border border-gray-200 bg-white p-3.5 shadow-xs sm:p-4'
    >
      <header className='flex items-start gap-3'>
        <MessengerAvatar
          name={c.authorName}
          picUrl={c.authorPictureUrl ?? null}
          size='md'
          fallback={t('inbox.comments.card.avatarFallback')}
        />
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
            <span className='truncate text-[15px] font-semibold text-gray-900'>{author}</span>
            {/* Desktop keeps the inbox's pill badges; phone records stay rectangular (mobile design). */}
            {badge && (
              <span className={`${touch ? 'rounded-md' : 'rounded-full'} px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>
                {t(badge.label)}
              </span>
            )}
          </div>
          <div className='mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-gray-500'>
            <span className='inline-flex items-center gap-1'>
              <ChannelIcon channel='facebook' className='size-3' />
              {t('inbox.comments.card.channel')}
            </span>
            {!c.isTopLevel && <span>{t('inbox.comments.card.isReply')}</span>}
            <span aria-hidden>·</span>
            <time className='tabular-nums' dateTime={new Date(when).toISOString()}>
              {formatBusinessDateTime(when)}
            </time>
          </div>
        </div>
      </header>

      <CommentBody
        message={c.message}
        messageAvailable={c.messageAvailable}
        attachmentType={c.attachmentType ?? null}
        attachmentUrl={c.attachmentUrl ?? null}
        touch={touch}
        locale={locale}
      />

      <CommentPostContext
        post={post}
        facebookUrl={facebookCommentUrl(c.postId, c.commentId)}
        isReply={!c.isTopLevel}
        touch={touch}
        locale={locale}
      />

      <CommentThread replies={fullThread} excludeCommentId={c.commentId} locale={locale} />

      <div>
        {(hasLeadSlot(c) || (replyable && !composing)) && (
          <div
            className={`mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 ${touch ? '[&_a]:min-h-11 [&_button]:min-h-11' : ''}`}
          >
            {/* The ליד slot — see rowState for who gets one. */}
            {hasLeadSlot(c) && (
              <ConvertCommentButton
                commentId={c.commentId}
                convertedLeadId={c.convertedLeadId}
                leavesViewOnConvert={leavesViewOnConvert}
                locale={locale}
              />
            )}
            {replyable && !composing && (
              <Btn variant='outline' size='small' lbl={t('inbox.comments.card.reply')} onClick={() => setComposing(true)} />
            )}
          </div>
        )}

        {replyable && composing && (
          <div className={touch ? '[&_button]:min-h-11' : ''}>
            <CommentReplyForm
              commentId={c.commentId}
              authorName={c.authorName}
              onSent={onSent}
              onCancel={() => setComposing(false)}
              locale={locale}
            />
          </div>
        )}
      </div>
    </article>
  )
}
