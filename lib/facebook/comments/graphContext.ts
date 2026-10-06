import { graphRequest, type MetaGraphError } from '@/lib/facebook/graphClient'

/**
 * Graph reads that give a comment its context: the POST it was left on, and
 * the commenter's PICTURE. Both use the Page access token of the comment's own
 * Page, and both are documented reads (checked 2026-10-05):
 *
 *  · GET /{post-id}?fields=message,full_picture,permalink_url,created_time,status_type
 *    https://developers.facebook.com/docs/graph-api/reference/post — "A page
 *    access token can read all posts posted to or posted by that Page."
 *    `full_picture` is capped at 720px and is a CDN URL.
 *  · GET /{page-scoped-user-id}/picture?redirect=0&type=normal
 *    https://developers.facebook.com/docs/graph-api/reference/user/picture —
 *    for a Page-scoped id: "Page access token", permissions "None". The URL
 *    expires. `is_silhouette` marks Meta's generic placeholder, which is NOT a
 *    picture of the person and is never shown as one.
 *
 * NEVER INVENTS. A URL is only ever one Meta returned, https, for this id. No
 * URL is constructed from an id, nothing is scraped.
 *
 * NEVER THROWS, and classifies every answer so the caller can tell "gone" and
 * "refused" (record, stop asking) from a blip (ask again next pass).
 */

export type PostContext =
  | {
      status: 'ok'
      message: string | null
      pictureUrl: string | null
      permalinkUrl: string | null
      statusType: string | null
      createdTime: Date | null
    }
  | { status: 'unavailable' | 'denied' | 'transient' }

export type AuthorPicture = { status: 'ok'; url: string } | { status: 'none' | 'denied' | 'transient' }

/** A post shown as context, not reproduced: long copy is cut here, once. */
export const POST_MESSAGE_MAX = 600

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

export function httpsUrl(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  try {
    return new URL(s).protocol === 'https:' ? s : null
  } catch {
    return null
  }
}

function facebookUrl(v: unknown): string | null {
  const s = httpsUrl(v)
  if (!s) return null
  const host = new URL(s).hostname
  return host === 'facebook.com' || host.endsWith('.facebook.com') ? s : null
}

/** Meta refused, and asking again with the same grant will not change it. */
export function isAccessDenied(error: MetaGraphError): boolean {
  if (error.kind !== 'graph') return false
  const { code } = error
  return code === 10 || code === 283 || (code !== null && code >= 200 && code <= 299) || error.status === 403
}

/** The object is gone or unreadable — Meta's documented 100/33. */
export function isObjectUnavailable(error: MetaGraphError): boolean {
  return error.kind === 'graph' && error.code === 100 && error.subcode === 33
}

export async function fetchPostContext(input: {
  postId: string
  token: string
  fetchImpl?: typeof fetch
}): Promise<PostContext> {
  const result = await graphRequest<Record<string, unknown>>({
    path: `/${encodeURIComponent(input.postId)}`,
    token: input.token,
    query: { fields: 'message,full_picture,permalink_url,created_time,status_type' },
    timeoutMs: 4000,
    fetchImpl: input.fetchImpl,
  })
  // `'error' in result`: strictNullChecks is off, so `!result.ok` does not narrow.
  if ('error' in result) {
    if (isObjectUnavailable(result.error)) return { status: 'unavailable' }
    if (isAccessDenied(result.error)) return { status: 'denied' }
    return { status: 'transient' }
  }
  const d = ('data' in result ? result.data : null) ?? {}
  const created = str(d.created_time) ? new Date(d.created_time as string) : null
  const message = str(d.message)
  return {
    status: 'ok',
    message: message ? message.slice(0, POST_MESSAGE_MAX) : null,
    pictureUrl: httpsUrl(d.full_picture),
    permalinkUrl: facebookUrl(d.permalink_url),
    statusType: str(d.status_type),
    createdTime: created && !Number.isNaN(created.getTime()) ? created : null,
  }
}

export async function fetchAuthorPicture(input: {
  authorId: string
  token: string
  fetchImpl?: typeof fetch
}): Promise<AuthorPicture> {
  const result = await graphRequest<{ data?: { url?: unknown; is_silhouette?: unknown } }>({
    path: `/${encodeURIComponent(input.authorId)}/picture`,
    token: input.token,
    query: { redirect: 0, type: 'normal' },
    timeoutMs: 4000,
    fetchImpl: input.fetchImpl,
  })
  if ('error' in result) {
    if (isAccessDenied(result.error) || isObjectUnavailable(result.error)) return { status: 'denied' }
    return { status: 'transient' }
  }
  const pic = ('data' in result ? result.data?.data : null) ?? {}
  const url = httpsUrl(pic.url)
  // Meta's generic silhouette is an answer ("no picture"), not a photo of anyone.
  if (!url || pic.is_silhouette === true) return { status: 'none' }
  return { status: 'ok', url }
}
