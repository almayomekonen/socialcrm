import Link from 'next/link'
import { formatDateTime } from '@/lib/dates'
import ChannelIcon from '@/modules/inbox/components/ChannelIcon'
import LeadAvatar from '@/components/ui/lead-avatar'
import ConvertCommentButton from './ConvertCommentButton'
import CommentThread from './CommentThread'
import CommentReplyForm from './CommentReplyForm'
import { facebookCommentUrl } from '@/lib/facebook/comments/links'
import { groupRepliesByThread, threadRootId } from '@/lib/facebook/comments/thread'
import type { CommentListItem, CommentReply, CommentStatus } from '../types'

/**
 * Comment rows for the Comments Inbox.
 *
 * Row anatomy follows `modules/inbox/components/InboxConversationRow.tsx` —
 * avatar, name, timestamp, body, channel footer — so the two Inbox surfaces
 * read as one product rather than two.
 *
 * NO CONTACT DETAILS ARE SHOWN OR IMPLIED. A Facebook comment carries a display
 * name and a page-scoped id: no phone, no email. Rendering a call or mail
 * affordance here would be inventing data.
 *
 * There is no "create lead" action yet — that is Task 6.
 */

const STATUS_BADGE: Partial<Record<CommentStatus, { label: string; cls: string }>> = {
  converted: { label: 'הומר לליד', cls: 'bg-green-50 text-green-700' },
  ignored: { label: 'התעלמת', cls: 'bg-gray-100 text-gray-600' },
  deleted: { label: 'נמחקה בפייסבוק', cls: 'bg-gray-100 text-gray-500' },
}

export default function CommentsList({
  comments,
  replies = [],
  replyablePageIds = [],
}: {
  comments: CommentListItem[]
  /** Thread entries for the listed comments (see listCommentReplies). */
  replies?: CommentReply[]
  /** Pages whose recorded grant includes the reply permission. */
  replyablePageIds?: string[]
}) {
  const threads = groupRepliesByThread(replies)
  const replyable = new Set(replyablePageIds)
  return (
    <ul className='divide-y divide-gray-100 rounded-md border border-gray-200 bg-white'>
      {comments.map((c) => {
        // createdTime is nullable (Meta may omit created_time); receivedAt is
        // not, so the row always has an honest timestamp to show.
        const when = c.createdTime ?? c.receivedAt
        const badge = STATUS_BADGE[c.status]
        const thread = threads.get(`${c.pageId}:${threadRootId(c)}`) ?? []
        const facebookUrl = facebookCommentUrl(c.postId, c.commentId)

        return (
          <li
            key={c.commentId}
            data-comment-id={c.commentId}
            data-post-id={c.postId}
            className='flex gap-2.5 px-3 py-2.5'
          >
            <LeadAvatar name={c.authorName} size='sm' />

            <div className='min-w-0 flex-1'>
              <div className='flex flex-wrap items-center justify-between gap-x-2 gap-y-1'>
                <span className='truncate text-sm font-medium text-gray-900'>
                  {c.authorName ?? 'מגיב מפייסבוק'}
                </span>
                <time className='shrink-0 text-[11px] tabular-nums text-gray-400' dateTime={when.toISOString()}>
                  {formatDateTime(when)}
                </time>
              </div>

              {c.messageAvailable ? (
                <p className='mt-0.5 text-sm break-words whitespace-pre-wrap text-gray-700'>{c.message}</p>
              ) : (
                // Deliberate, not broken: Meta withholds comment text until
                // pages_read_user_content is granted.
                <p className='mt-0.5 text-sm text-gray-400 italic'>תוכן התגובה עדיין לא זמין</p>
              )}

              <div className='mt-1 flex flex-wrap items-center gap-x-2 gap-y-1'>
                <span className='inline-flex items-center gap-1 text-xs text-gray-500'>
                  <ChannelIcon channel='facebook' className='size-3' />
                  פייסבוק
                </span>
                {!c.isTopLevel && <span className='text-[11px] text-gray-500'>תגובה לתגובה</span>}
                {badge && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>
                    {badge.label}
                  </span>
                )}

                {/* After conversion the row points at the ליד it produced —
                    the same /clients/{id}/summary link every other surface uses. */}
                {c.convertedLeadId && (
                  <Link
                    href={`/clients/${c.convertedLeadId}/summary`}
                    className='text-[11px] text-primary underline underline-offset-2'
                  >
                    פתח את הליד
                  </Link>
                )}

                {/* Offered only for a live, unconverted comment. A deleted
                    comment no longer exists on Facebook; a converted one
                    already has its ליד. */}
                {c.status === 'open' && !c.convertedLeadId && <ConvertCommentButton commentId={c.commentId} />}

                {/* The post the comment was left on, opened at this comment. External. */}
                {facebookUrl && (
                  <a
                    href={facebookUrl}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='text-[11px] text-primary underline underline-offset-2'
                  >
                    פתח את הפוסט בפייסבוק
                  </a>
                )}
              </div>

              <CommentThread replies={thread} excludeCommentId={c.commentId} />

              {c.status !== 'deleted' && replyable.has(c.pageId) && (
                <CommentReplyForm commentId={c.commentId} authorName={c.authorName} />
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
