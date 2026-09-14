/**
 * Comment threads — pure rules shared by server components, the reply action
 * and the client reply form. No database, no Graph, safe in a client bundle.
 */
import type { CommentReply } from '@/modules/facebookComments/types'

export const REPLY_MAX_CHARS = 8000

export type ReplyFailureReason =
  | 'not_enabled'
  | 'not_found'
  | 'deleted'
  | 'page_authored'
  | 'empty'
  | 'too_long'
  | 'permission_missing'
  | 'reconnect_required'
  | 'comment_unavailable'
  | 'rate_limited'
  | 'blocked'
  | 'meta_error'

/**
 * Facebook threads are two levels deep: a comment and its replies. Replying to
 * a reply is posted into the thread of its top-level comment, which is where
 * Facebook shows it — so the thread root is the one id the reply targets and
 * the one id the UI groups under.
 */
export function threadRootId(c: { commentId: string; parentId: string | null; isTopLevel: boolean }): string {
  return c.isTopLevel || !c.parentId ? c.commentId : c.parentId
}


/** Replies grouped by the thread they belong to: `${pageId}:${rootCommentId}`. */
export function groupRepliesByThread(replies: CommentReply[]): Map<string, CommentReply[]> {
  const byThread = new Map<string, CommentReply[]>()
  for (const r of replies) {
    const key = `${r.pageId}:${r.parentId}`
    byThread.set(key, [...(byThread.get(key) ?? []), r])
  }
  return byThread
}
