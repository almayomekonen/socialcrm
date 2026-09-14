import { formatBusinessDateTime as formatDateTime } from '@/lib/today/time'
import type { CommentReply } from '../types'

/**
 * The replies under a comment, oldest first — other commenters and the Page.
 *
 * The Page's own replies are labelled as such, and a reply sent from SocialCRM
 * says so, so a rep can tell at a glance what the business already answered
 * and where. Text Meta withheld reads "not available", never as an empty reply.
 */
export default function CommentThread({ replies, excludeCommentId }: { replies: CommentReply[]; excludeCommentId?: string }) {
  const visible = replies.filter((r) => r.commentId !== excludeCommentId)
  if (visible.length === 0) return null

  return (
    <ul aria-label='תגובות בשרשור' className='mt-2 grid gap-1.5 border-s-2 border-gray-100 ps-3'>
      {visible.map((r) => {
        const when = r.createdTime ?? r.receivedAt
        return (
          <li key={r.commentId} data-reply-id={r.commentId} className='text-sm'>
            <div className='flex flex-wrap items-center gap-x-2 gap-y-0.5'>
              <span className={`font-medium ${r.authorIsPage ? 'text-primary-text' : 'text-gray-800'}`}>
                {r.authorIsPage ? `${r.authorName ?? 'הדף'} (הדף שלך)` : (r.authorName ?? 'מגיב מפייסבוק')}
              </span>
              {r.authorIsPage && r.sentByUserId && (
                <span className='rounded-full bg-primary-tint px-1.5 py-0.5 text-[10px] font-medium text-primary-text'>
                  נשלח מ-SocialCRM
                </span>
              )}
              <time className='text-[11px] tabular-nums text-gray-400' dateTime={new Date(when).toISOString()}>
                {formatDateTime(when)}
              </time>
            </div>
            {r.messageAvailable ? (
              <p className='mt-0.5 break-words whitespace-pre-wrap text-gray-700'>{r.message}</p>
            ) : (
              <p className='mt-0.5 text-gray-400 italic'>תוכן התגובה עדיין לא זמין</p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
