import { db } from '@/config/db'
import { resolvePageAccessToken } from '@/lib/facebook/pageToken'
import { fetchAuthorPicture, fetchPostContext } from '@/lib/facebook/comments/graphContext'

/**
 * Lazy, bounded enrichment of the comments a rep is looking at.
 *
 * WHEN. Called from `after()` on the inbox render — never inside the request,
 * never per card, never as a bulk backfill. It looks only at the comments that
 * page just listed, so legacy rows are enriched the first time someone actually
 * looks at them, a few at a time, and nothing old is touched otherwise.
 *
 * HOW MUCH. At most POST_REFRESH_BATCH posts and AUTHOR_REFRESH_BATCH
 * commenters per pass — one Graph call per POST (shared by all its comments)
 * and one per COMMENTER (shared by all their comments on that Page). A busy
 * inbox can never fan out into Graph.
 *
 * WHAT IS REMEMBERED. 'ok' and 'none' are refreshed after CONTEXT_TTL_MS (Meta's
 * CDN URLs expire); 'denied' is retried only after DENIED_RETRY_MS (a reconnect
 * can widen a grant); a post Meta says is gone is never asked about again.
 * A network blip or rate limit records nothing, so the next pass tries again.
 *
 * TENANCY. Every read and write is filtered by `agencyId`; the token comes from
 * that agency's own row for the comment's Page. A Page owned by another tenant
 * can never supply a token or receive a write here.
 *
 * NEVER THROWS.
 */

export const CONTEXT_TTL_MS = 3 * 24 * 60 * 60 * 1000
export const DENIED_RETRY_MS = 7 * 24 * 60 * 60 * 1000
export const POST_REFRESH_BATCH = 5
export const AUTHOR_REFRESH_BATCH = 8

type Status = string | null | undefined

/** True when this record is worth a Graph call now. */
export function contextIsDue(status: Status, fetchedAt: Date | string | null | undefined, now: Date): boolean {
  if (status === 'unavailable') return false
  if (!fetchedAt) return true
  const at = new Date(fetchedAt).getTime()
  if (Number.isNaN(at)) return true
  return now.getTime() - at >= (status === 'denied' ? DENIED_RETRY_MS : CONTEXT_TTL_MS)
}

type CommentRow = {
  pageId: string
  postId: string
  authorExternalId: string | null
  authorPictureStatus: Status
  authorPictureFetchedAt: Date | null
}
type PostRow = { pageId: string; postId: string; fetchStatus: Status; fetchedAt: Date | null }

export async function refreshCommentContext(input: {
  agencyId: number
  /** `facebook_page_comments.id` of the rows the inbox just rendered. */
  commentRowIds: number[]
  now?: Date
  fetchImpl?: typeof fetch
}): Promise<{ posts: number; authors: number }> {
  const now = input.now ?? new Date()
  const summary = { posts: 0, authors: 0 }
  if (input.commentRowIds.length === 0) return summary
  try {
    const comments = (await db('facebook_page_comments')
      .where({ agencyId: input.agencyId, authorIsPage: false })
      .whereIn('id', input.commentRowIds)
      .select('pageId', 'postId', 'authorExternalId', 'authorPictureStatus', 'authorPictureFetchedAt')) as CommentRow[]
    if (comments.length === 0) return summary

    const postKeys = [...new Map(comments.map((c) => [`${c.pageId}:${c.postId}`, c])).values()]
    const known = (await db('facebook_page_posts')
      .where({ agencyId: input.agencyId })
      .whereIn(['pageId', 'postId'], postKeys.map((c) => [c.pageId, c.postId]))
      .select('pageId', 'postId', 'fetchStatus', 'fetchedAt')) as PostRow[]
    const knownByKey = new Map(known.map((p) => [`${p.pageId}:${p.postId}`, p]))
    const duePosts = postKeys
      .filter((c) => {
        const p = knownByKey.get(`${c.pageId}:${c.postId}`)
        return contextIsDue(p?.fetchStatus, p?.fetchedAt, now)
      })
      .slice(0, POST_REFRESH_BATCH)

    const authorKeys = [
      ...new Map(
        comments
          .filter((c) => c.authorExternalId && c.authorExternalId !== c.pageId)
          .filter((c) => contextIsDue(c.authorPictureStatus, c.authorPictureFetchedAt, now))
          .map((c) => [`${c.pageId}:${c.authorExternalId}`, c]),
      ).values(),
    ].slice(0, AUTHOR_REFRESH_BATCH)

    if (duePosts.length === 0 && authorKeys.length === 0) return summary

    const tokenByPage = await pageTokens(input.agencyId, [...new Set([...duePosts, ...authorKeys].map((c) => c.pageId))])

    for (const c of duePosts) {
      const token = tokenByPage.get(c.pageId)
      if (!token) continue
      const ctx = await fetchPostContext({ postId: c.postId, token, fetchImpl: input.fetchImpl })
      if (ctx.status === 'transient') continue
      await savePost(input.agencyId, c.pageId, c.postId, ctx, now)
      summary.posts++
    }

    for (const c of authorKeys) {
      const token = tokenByPage.get(c.pageId)
      if (!token) continue
      const pic = await fetchAuthorPicture({ authorId: c.authorExternalId as string, token, fetchImpl: input.fetchImpl })
      if (pic.status === 'transient') continue
      await db('facebook_page_comments')
        .where({ agencyId: input.agencyId, pageId: c.pageId, authorExternalId: c.authorExternalId })
        .update({
          authorPictureUrl: pic.status === 'ok' ? pic.url : null,
          authorPictureStatus: pic.status,
          authorPictureFetchedAt: now,
        })
      summary.authors++
    }
  } catch (err) {
    console.error('[FacebookComments] Context refresh failed:', err instanceof Error ? err.message : 'unknown')
  }
  return summary
}

/** One token per Page, read from THIS agency's rows only. */
async function pageTokens(agencyId: number, pageIds: string[]): Promise<Map<string, string>> {
  const rows = (await db('facebook_pages')
    .where({ agency_id: agencyId })
    .whereIn('page_id', pageIds)
    .select('page_id', 'page_access_token')) as { page_id: string; page_access_token: string }[]
  const out = new Map<string, string>()
  for (const r of rows) {
    try {
      const token = resolvePageAccessToken(r.page_access_token)
      if (token) out.set(r.page_id, token)
    } catch {
      // A token that will not open is a connection problem, surfaced elsewhere.
    }
  }
  return out
}

async function savePost(
  agencyId: number,
  pageId: string,
  postId: string,
  ctx: Awaited<ReturnType<typeof fetchPostContext>>,
  now: Date,
): Promise<void> {
  // A refusal or a vanished post records only its status: whatever we already
  // knew about the post (e.g. the webhook's permalink) stays.
  const fields =
    ctx.status === 'ok'
      ? {
          message: ctx.message,
          pictureUrl: ctx.pictureUrl,
          ...(ctx.permalinkUrl ? { permalinkUrl: ctx.permalinkUrl } : {}),
          ...(ctx.statusType ? { statusType: ctx.statusType } : {}),
          createdTime: ctx.createdTime,
        }
      : {}
  await db('facebook_page_posts')
    .insert({ agencyId, pageId, postId, ...fields, fetchStatus: ctx.status, fetchedAt: now, updatedAt: now })
    .onConflict(['agencyId', 'pageId', 'postId'])
    .merge({ ...fields, fetchStatus: ctx.status, fetchedAt: now, updatedAt: now })
}
