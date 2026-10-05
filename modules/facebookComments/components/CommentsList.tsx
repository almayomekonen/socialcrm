'use client'

import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { groupRepliesByThread, threadRootId } from '@/lib/facebook/comments/thread'
import CommentCard from './CommentCard'
import { loadMoreComments } from '../listActions'
import type { CommentListItem, CommentPost, CommentReply, CommentsCursor, CommentStatusFilter } from '../types'

/**
 * The comments inbox feed: one card per comment, newest first, and "טען עוד
 * תגובות" while the server reports another page.
 *
 * Every card renders from data the server already loaded for its page —
 * comments, threads and posts in three queries — so nothing here calls Graph.
 * Later pages are appended; a comment already on screen (e.g. after a refresh
 * shifted the first page) is never shown twice.
 */
export default function CommentsList({
  comments,
  replies = [],
  posts = [],
  replyablePageIds = [],
  leavesViewOnConvert = false,
  nextCursor = null,
  status = 'all',
  touch = false,
}: {
  comments: CommentListItem[]
  /** Thread entries for the listed comments (see listCommentReplies). */
  replies?: CommentReply[]
  /** Post context for the listed comments (see listCommentPosts). */
  posts?: CommentPost[]
  /** Pages whose recorded grant includes the reply permission. */
  replyablePageIds?: string[]
  /** The list is filtered to open comments: a converted row drops out on refresh. */
  leavesViewOnConvert?: boolean
  nextCursor?: CommentsCursor | null
  status?: CommentStatusFilter
  /** Phone: larger tap targets. */
  touch?: boolean
}) {
  const [more, setMore] = useState<{ items: CommentListItem[]; replies: CommentReply[]; posts: CommentPost[] }>({
    items: [],
    replies: [],
    posts: [],
  })
  const [cursor, setCursor] = useState<CommentsCursor | null>(null)
  const [exhausted, setExhausted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  // Changing the filter (?status=) re-renders THIS instance with new props:
  // pages and the cursor loaded under the previous filter must not carry over.
  // Reset during render — React's pattern for state that depends on a prop.
  const [loadedFor, setLoadedFor] = useState(status)
  if (loadedFor !== status) {
    setLoadedFor(status)
    setMore({ items: [], replies: [], posts: [] })
    setCursor(null)
    setExhausted(false)
    setFailed(false)
  }

  const firstIds = new Set(comments.map((c) => c.commentId))
  const all = [...comments, ...more.items.filter((c) => !firstIds.has(c.commentId))]
  const threads = groupRepliesByThread([...replies, ...more.replies])
  const postByKey = new Map([...posts, ...more.posts].map((p) => [`${p.pageId}:${p.postId}`, p]))
  const replyable = new Set(replyablePageIds)
  const next = exhausted ? null : (cursor ?? nextCursor)

  const loadMore = async () => {
    if (loading || !next) return
    setLoading(true)
    setFailed(false)
    try {
      const res = await loadMoreComments(status, next)
      if (!('items' in res)) {
        setFailed(true)
        return
      }
      setMore((m) => ({
        items: [...m.items, ...res.items],
        replies: [...m.replies, ...res.replies],
        posts: [...m.posts, ...res.posts],
      }))
      setCursor(res.nextCursor)
      if (!res.nextCursor) setExhausted(true)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    // A readable column, aligned to the start (right in RTL) under the filter —
    // full-width cards on a wide screen make 1,300px lines of comment text.
    <div className='grid w-full max-w-3xl gap-3'>
      <ul className='grid gap-3' aria-label='תגובות מפייסבוק'>
        {all.map((c) => (
          <li key={c.commentId} data-comment-id={c.commentId} data-post-id={c.postId}>
            <CommentCard
              comment={c}
              post={postByKey.get(`${c.pageId}:${c.postId}`)}
              thread={threads.get(`${c.pageId}:${threadRootId(c)}`) ?? []}
              canReply={replyable.has(c.pageId)}
              leavesViewOnConvert={leavesViewOnConvert}
              touch={touch}
            />
          </li>
        ))}
      </ul>

      {next && (
        <div className={`flex flex-col items-center gap-1.5 ${touch ? '[&_button]:min-h-11' : ''}`}>
          <Btn
            variant='outline'
            lbl={loading ? 'טוען תגובות...' : 'טען עוד תגובות'}
            icon={loading ? 'spinner' : undefined}
            iconClassName={loading ? 'animate-spin' : undefined}
            disabled={loading}
            onClick={loadMore}
          />
          {failed && (
            <p role='alert' className='text-xs text-error-text'>
              לא הצלחנו לטעון עוד תגובות. נסה שוב.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
