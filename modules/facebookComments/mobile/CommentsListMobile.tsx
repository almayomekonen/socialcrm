import Link from 'next/link'
import { formatDateTime } from '@/lib/dates'
import ChannelIcon from '@/modules/inbox/components/ChannelIcon'
import ConvertCommentButton from '@/modules/facebookComments/components/ConvertCommentButton'
import CommentThread from '@/modules/facebookComments/components/CommentThread'
import CommentReplyForm from '@/modules/facebookComments/components/CommentReplyForm'
import { facebookCommentUrl } from '@/lib/facebook/comments/links'
import { groupRepliesByThread, threadRootId } from '@/lib/facebook/comments/thread'
import type { CommentListItem, CommentReply, CommentStatus } from '../types'

/**
 * Phone comment rows. Same records as desktop `CommentsList` — author, text,
 * timestamp, Facebook source, convert — laid out as CRM activity rows, not
 * chat bubbles. Desktop `CommentsList` is untouched.
 */

const STATUS_COPY: Partial<Record<CommentStatus, { label: string; dot: string; text: string }>> = {
  converted: { label: 'הומר לליד', dot: 'bg-green-600', text: 'text-green-700' },
  ignored: { label: 'התעלמת', dot: 'bg-gray-400', text: 'text-gray-600' },
  deleted: { label: 'נמחקה בפייסבוק', dot: 'bg-gray-400', text: 'text-gray-500' },
}

export default function CommentsListMobile({
  comments,
  replies = [],
  replyablePageIds = [],
}: {
  comments: CommentListItem[]
  replies?: CommentReply[]
  replyablePageIds?: string[]
}) {
  const threads = groupRepliesByThread(replies)
  const replyable = new Set(replyablePageIds)
  return (
    <ul className='divide-y divide-gray-100 overflow-hidden rounded-md border border-gray-200 bg-white'>
      {comments.map((c) => {
        const when = c.createdTime ?? c.receivedAt
        const status = STATUS_COPY[c.status]
        const thread = threads.get(`${c.pageId}:${threadRootId(c)}`) ?? []
        const facebookUrl = facebookCommentUrl(c.postId, c.commentId)

        return (
          <li
            key={c.commentId}
            data-comment-id={c.commentId}
            data-post-id={c.postId}
            className='flex gap-2.5 px-3.5 py-2.5'
          >
            <span
              aria-hidden
              className='mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-gray-50'
            >
              <ChannelIcon channel='facebook' className='size-4' />
            </span>

            <div className='min-w-0 flex-1'>
              <div className='flex items-center gap-2'>
                <span className='truncate text-[15px] font-semibold leading-tight text-ink'>
                  {c.authorName ?? 'מגיב מפייסבוק'}
                </span>
                <time
                  className='ms-auto shrink-0 text-[11px] tabular-nums leading-tight text-gray-400'
                  dateTime={when.toISOString()}
                >
                  {formatDateTime(when)}
                </time>
              </div>

              {c.messageAvailable ? (
                <p className='mt-0.5 text-sm leading-snug break-words whitespace-pre-wrap text-gray-700'>{c.message}</p>
              ) : (
                <p className='mt-0.5 text-sm text-gray-400'>תוכן התגובה עדיין לא זמין</p>
              )}

              <div className='mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500'>
                <span>פייסבוק</span>
                {!c.isTopLevel && <span>תגובה לתגובה</span>}
                {status && (
                  <span className={`inline-flex items-center gap-1 font-medium ${status.text}`}>
                    <span aria-hidden className={`size-1 shrink-0 rounded-full ${status.dot}`} />
                    {status.label}
                  </span>
                )}
              </div>

              {c.convertedLeadId && (
                <Link
                  href={`/clients/${c.convertedLeadId}/summary`}
                  className='mt-1 inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-2'
                >
                  פתח את הליד
                </Link>
              )}

              {c.status === 'open' && !c.convertedLeadId && (
                <div className='mt-1 [&_button]:min-h-11 [&_button]:rounded-md'>
                  <ConvertCommentButton commentId={c.commentId} />
                </div>
              )}

              {facebookUrl && (
                <a
                  href={facebookUrl}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='mt-1 inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2'
                >
                  פתח את הפוסט בפייסבוק
                </a>
              )}

              <CommentThread replies={thread} excludeCommentId={c.commentId} />

              {c.status !== 'deleted' && replyable.has(c.pageId) && (
                <div className='[&_button]:min-h-11 [&_button]:rounded-md'>
                  <CommentReplyForm commentId={c.commentId} authorName={c.authorName} />
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
