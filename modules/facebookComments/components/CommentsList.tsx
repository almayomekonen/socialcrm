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
    // The whole workspace width, as a card grid: one column, two once the FEED
    // (not the viewport — the sidebar and padding are already subtracted) is
    // 56rem wide, so each card keeps a readable ~440px minimum.
    <div className='@container/feed grid w-full gap-3'>
      {/* items-start: a card is as tall as its content. Stretching to the row's
          tallest card left text-only cards mostly empty. */}
      <ul className='grid grid-cols-1 items-start gap-3 @4xl/feed:grid-cols-2' aria-label='תגובות מפייסבוק'>
        {all.map((c) => (
          <li key={c.commentId} data-comment-id={c.commentId} data-post-id={c.postId} className='min-w-0'>
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
