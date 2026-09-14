import { db } from '@/config/db'
import type { MetaGraphError } from '@/lib/facebook/graphClient'

/**
 * Replying to a Facebook comment as the Page — the pure rules and the one write.
 *
 * Endpoint: POST /{comment-id}/comments with a Page access token that carries
 * `pages_manage_engagement` (https://developers.facebook.com/docs/graph-api/reference/object/comments).
 * Response: { id } — the new comment's id, which is the SAME id the `feed`
 * webhook later delivers for it. That shared id is the whole dedup story.
 */

export { REPLY_MAX_CHARS, threadRootId, type ReplyFailureReason } from '@/lib/facebook/comments/thread'
import type { ReplyFailureReason } from '@/lib/facebook/comments/thread'

/**
 * Meta error → a reason the rep can act on. Codes per
 * https://developers.facebook.com/docs/graph-api/guides/error-handling:
 * 190 token invalid; 10/200-299 permission; 4/17/32/613 throttling;
 * 368 temporarily blocked for policy; 100 + subcode 33 object missing/unreadable.
 */
export function replyFailureFromGraph(error: MetaGraphError): ReplyFailureReason {
  const code = error.code
  if (error.kind !== 'graph') return 'meta_error'
  if (code === 190 || error.status === 401) return 'reconnect_required'
  if (code === 10 || (code !== null && code >= 200 && code <= 299)) return 'permission_missing'
  if (code === 4 || code === 17 || code === 32 || code === 613) return 'rate_limited'
  if (code === 368) return 'blocked'
  // Only subcode 33 proves the object is gone/unreadable; a bare 100 is any invalid parameter.
  if (code === 100 && error.subcode === 33) return 'comment_unavailable'
  return 'meta_error'
}

/**
 * Record the Page's reply from the Graph response.
 *
 * Idempotent with the webhook echo of the same reply, in either order:
 *  · reply first → this INSERTs; the echo later merges into it (ingest never
 *    touches `sentByUserId` and never blanks text).
 *  · echo first  → ingest INSERTed it as a Page-authored row; this merges in
 *    who sent it and the text we know we sent.
 * Tenancy columns are never in the merge set.
 */
export async function recordPageReply(input: {
  agencyId: number
  pageId: string
  replyId: string
  postId: string
  rootCommentId: string
  message: string
  sentByUserId: number
  authorName: string | null
}): Promise<void> {
  const now = new Date()
  await db('facebook_page_comments')
    .insert({
      agencyId: input.agencyId,
      pageId: input.pageId,
      commentId: input.replyId,
      postId: input.postId,
      parentId: input.rootCommentId,
      isTopLevel: false,
      authorExternalId: input.pageId,
      authorName: input.authorName,
      authorIsPage: true,
      sentByUserId: input.sentByUserId,
      message: input.message,
      messageAvailable: true,
      verb: 'add',
      createdTime: now,
      receivedAt: now,
      updatedAt: now,
    })
    .onConflict(['pageId', 'commentId'])
    .merge({
      sentByUserId: input.sentByUserId,
      authorIsPage: true,
      message: input.message,
      messageAvailable: true,
      updatedAt: now,
    })
}
