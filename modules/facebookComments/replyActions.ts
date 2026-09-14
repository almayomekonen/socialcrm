'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/config/db'
import { requireProductAccess } from '@/lib/requireUser'
import { parseGrantedScopes } from '@/db/facebook'
import { isFacebookCommentsEnabledForAgency } from '@/lib/facebook/comments/capability'
import { hasFeatureScopes, isFacebookCommentRepliesEnabledForAgency } from '@/lib/facebook/permissions'
import { resolvePageAccessToken } from '@/lib/facebook/pageToken'
import { describeGraphError, graphRequest } from '@/lib/facebook/graphClient'
import { markFacebookDisconnectedAndNotify } from '@/lib/facebook/integrationNotifications'
import {
  REPLY_MAX_CHARS,
  recordPageReply,
  replyFailureFromGraph,
  threadRootId,
  type ReplyFailureReason,
} from '@/lib/facebook/comments/replies'

export type ReplyResult = { ok: true; replyId: string } | { ok: false; reason: ReplyFailureReason }

/**
 * Reply to a Facebook comment AS THE PAGE, from inside SocialCRM.
 *
 * AUTHORIZATION, in order, all server-side:
 *  1. `requireProductAccess` — an authenticated agency user whose product
 *     access is active (a reply is outbound engagement, like a WhatsApp send).
 *     Its ProductAccessError is deliberately NOT caught, so `useAction` shows
 *     the subscription state instead of a retry that can never succeed.
 *  2. our rollout gates: Facebook comments AND comment replies (separate, so
 *     replies can be switched off without stopping comment ingestion).
 *  3. the comment must belong to the caller's agency — `commentId` is a
 *     Meta-global id, so filtering by it alone would be an IDOR.
 *  4. the Page is resolved from THAT comment's `pageId` inside the same agency
 *     (an agency may own several Pages), and must carry `pages_manage_engagement`
 *     in the grant Meta reported for it.
 *
 * The token never leaves the server and never appears in a URL or a log.
 */
export async function replyToComment(commentId: string, message: string): Promise<ReplyResult> {
  const user = await requireProductAccess()
  if (!isFacebookCommentsEnabledForAgency(user.agencyId) || !isFacebookCommentRepliesEnabledForAgency(user.agencyId)) {
    return { ok: false, reason: 'not_enabled' }
  }

  const text = typeof message === 'string' ? message.trim() : ''
  if (!text) return { ok: false, reason: 'empty' }
  if (text.length > REPLY_MAX_CHARS) return { ok: false, reason: 'too_long' }
  if (typeof commentId !== 'string' || !commentId) return { ok: false, reason: 'not_found' }

  const comment = await db('facebook_page_comments').where({ commentId, agencyId: user.agencyId }).first()
  if (!comment) return { ok: false, reason: 'not_found' }
  if (comment.status === 'deleted') return { ok: false, reason: 'deleted' }
  if (comment.authorIsPage) return { ok: false, reason: 'page_authored' }

  const connection = await db('facebook_pages').where({ page_id: comment.pageId, agency_id: user.agencyId }).first()
  if (!connection) return { ok: false, reason: 'reconnect_required' }
  if (!hasFeatureScopes(parseGrantedScopes(connection.granted_scopes), 'comment_replies')) {
    return { ok: false, reason: 'permission_missing' }
  }

  let token: string
  try {
    token = resolvePageAccessToken(connection.page_access_token)
  } catch {
    console.error('[FacebookCommentReply] Page token could not be opened', { pageTail: String(comment.pageId).slice(-4) })
    return { ok: false, reason: 'meta_error' }
  }

  const rootCommentId = threadRootId(comment)
  const result = await graphRequest<{ id?: string }>({
    method: 'POST',
    path: `/${encodeURIComponent(rootCommentId)}/comments`,
    token,
    body: { message: text },
  })

  // `in` narrowing: the repo compiles with strictNullChecks off, which disables
  // boolean-discriminant narrowing (same convention as ConvertCommentButton).
  if (!('data' in result) || !result.data?.id) {
    const reason = 'error' in result ? replyFailureFromGraph(result.error) : 'meta_error'
    console.warn('[FacebookCommentReply] Graph refused the reply', {
      reason,
      detail: 'error' in result ? describeGraphError(result.error) : 'no id in response',
    })
    if (reason === 'reconnect_required') await markFacebookDisconnectedAndNotify(connection).catch(() => {})
    return { ok: false, reason }
  }

  const replyId = result.data.id as string
  try {
    await recordPageReply({
      agencyId: user.agencyId,
      pageId: comment.pageId,
      replyId,
      postId: comment.postId,
      rootCommentId,
      message: text,
      sentByUserId: user.id,
      authorName: connection.page_name ?? null,
    })
  } catch (err) {
    // The reply IS published on Facebook; its `feed` echo will still record it.
    // Reporting failure here would invite a duplicate reply on retry.
    console.error('[FacebookCommentReply] Published, but local record failed:', err instanceof Error ? err.message : 'unknown')
  }

  revalidatePath('/inbox/comments')
  return { ok: true, replyId }
}
