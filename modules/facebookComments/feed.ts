import { threadRootId } from '@/lib/facebook/comments/thread'
import { listCommentPosts, listCommentReplies, listPageComments } from './queries'
import type { CommentListItem, CommentPost, CommentReply, CommentsCursor, CommentStatusFilter } from './types'

/**
 * One page of the comments inbox with everything its cards render: the
 * comments, their reply threads and the posts they were left on. Three
 * tenant-scoped reads per page, whatever its size — never one per card.
 *
 * Shared by the route (first page) and `loadMoreComments` (every next page),
 * so a card looks the same however it arrived.
 */
export type CommentsFeedPage = {
  items: CommentListItem[]
  replies: CommentReply[]
  posts: CommentPost[]
  nextCursor: CommentsCursor | null
}

export async function loadCommentsFeedPage(
  agencyId: number,
  opts: { status: CommentStatusFilter; cursor?: CommentsCursor | null },
): Promise<CommentsFeedPage> {
  const page = await listPageComments(agencyId, opts)
  const [replies, posts] = await Promise.all([
    listCommentReplies(
      agencyId,
      page.items.map((c) => ({ pageId: c.pageId, commentId: threadRootId(c) })),
    ),
    listCommentPosts(
      agencyId,
      page.items.map((c) => ({ pageId: c.pageId, postId: c.postId })),
    ),
  ])
  return { items: page.items, replies, posts, nextCursor: page.nextCursor }
}

/** A cursor from the browser, accepted only in the exact shape the server issued. */
export function parseCursor(raw: unknown): CommentsCursor | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { receivedAt, id } = raw as Record<string, unknown>
  if (typeof receivedAt !== 'string' || Number.isNaN(new Date(receivedAt).getTime())) return null
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return null
  return { receivedAt: new Date(receivedAt).toISOString(), id }
}
