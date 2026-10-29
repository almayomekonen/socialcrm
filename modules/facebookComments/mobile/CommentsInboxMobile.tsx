import InboxChannelSwitch from '@/modules/inbox/components/InboxChannelSwitch'
import CommentsEmptyState, { type CommentsEmptyKind } from '@/modules/facebookComments/components/CommentsEmptyState'
import CommentsListMobile from './CommentsListMobile'
import type { ReactNode } from 'react'
import { regionAttrs, type UiLocale } from '@/lib/i18n/config'
import type { CommentListItem, CommentPost, CommentReply, CommentsCursor, CommentStatusFilter } from '../types'

/**
 * Phone Comments Inbox. Same cards and empty states as desktop `/inbox/comments`;
 * chrome is phone-sized. No second query and no new comment model.
 */
export default function CommentsInboxMobile({
  emptyKind,
  comments,
  replies = [],
  posts = [],
  replyablePageIds = [],
  replyPrompt = null,
  statusFilter = null,
  leavesViewOnConvert = false,
  showMessenger = false,
  nextCursor = null,
  status = 'all',
  locale = 'he',
}: {
  emptyKind: CommentsEmptyKind | null
  comments: CommentListItem[]
  replies?: CommentReply[]
  posts?: CommentPost[]
  replyablePageIds?: string[]
  /** The reply-permission notice + CTA, built by the route; null when not needed. */
  replyPrompt?: ReactNode
  /** The status filter, built by the route; null when there is no Page to filter. */
  statusFilter?: ReactNode
  leavesViewOnConvert?: boolean
  showMessenger?: boolean
  nextCursor?: CommentsCursor | null
  status?: CommentStatusFilter
  /** Interface language, resolved once on the server (the comments page). */
  locale?: UiLocale
}) {
  return (
    <div data-testid='facebook-comments-mobile' className='flex flex-col gap-3 p-3' {...regionAttrs(locale)}>
      <div className='[&_a]:min-h-11 [&_a]:rounded-md [&_a]:px-3 [&_a]:text-sm'>
        <InboxChannelSwitch active='facebook' showMessenger={showMessenger} locale={locale} />
      </div>

      {statusFilter && (
        <div className='[&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:rounded-md [&_a]:px-3 [&_a]:text-sm'>
          {statusFilter}
        </div>
      )}

      {emptyKind && <CommentsEmptyState kind={emptyKind} compact locale={locale} />}

      {comments.length > 0 && (
        <>
          {replyPrompt}
          <CommentsListMobile
            comments={comments}
            replies={replies}
            posts={posts}
            replyablePageIds={replyablePageIds}
            leavesViewOnConvert={leavesViewOnConvert}
            nextCursor={nextCursor}
            status={status}
            locale={locale}
          />
        </>
      )}
    </div>
  )
}
