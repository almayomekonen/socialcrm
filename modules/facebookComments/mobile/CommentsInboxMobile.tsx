import InboxChannelSwitch from '@/modules/inbox/components/InboxChannelSwitch'
import CommentsEmptyState, { type CommentsEmptyKind } from '@/modules/facebookComments/components/CommentsEmptyState'
import CommentsListMobile from './CommentsListMobile'
import type { CommentListItem } from '../types'

/**
 * Phone Comments Inbox. Same rows and empty states as desktop `/inbox/comments`;
 * chrome is phone-sized and rectangular (CRM activity, not chat). No second
 * query and no new comment model.
 */
export default function CommentsInboxMobile({
  emptyKind,
  comments,
  awaitingText,
}: {
  emptyKind: CommentsEmptyKind | null
  comments: CommentListItem[]
  awaitingText: boolean
}) {
  return (
    <div data-testid='facebook-comments-mobile' className='flex flex-col gap-3 p-3'>
      <div className='[&_a]:min-h-11 [&_a]:rounded-md [&_a]:px-3 [&_a]:text-sm'>
        <InboxChannelSwitch active='facebook' />
      </div>

      {emptyKind && <CommentsEmptyState kind={emptyKind} compact />}

      {comments.length > 0 && (
        <>
          {awaitingText && <CommentsEmptyState kind='awaiting-text' compact />}
          <CommentsListMobile comments={comments} />
        </>
      )}
    </div>
  )
}
