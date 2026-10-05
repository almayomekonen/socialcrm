/**
 * Facebook Page `feed` webhook → normalized comment event.
 *
 * PURE: no DB, no Graph API, no clock, no mutation of the input. Given the same
 * arguments it returns an equal result, which is what makes it cheap to test
 * exhaustively and safe to call from inside a webhook batch.
 *
 * TOTAL: it runs inside a handler that processes many events in one delivery,
 * where one malformed comment must never strand a sibling leadgen event. Every
 * unusable input yields `null`; nothing throws.
 *
 * TENANCY: `pageId` is a PARAMETER, taken from the signature-verified
 * `entry.id`. It is never read out of `change.value` — a payload can claim any
 * page or agency it likes, and none of it is trusted. Nothing resembling an
 * agency id is extracted at all; the agency is resolved downstream by looking
 * the verified page up in `facebook_pages`.
 *
 * TOP-LEVEL DETECTION: production proved `parent_id` is present on EVERY
 * comment — for a top-level comment it is the post id, for a reply it is the
 * parent comment id. So the discriminator is `parentId === postId`, never a
 * presence check, which would misclassify every top-level comment as a reply.
 */

/** Feed verbs Meta emits for a comment. Anything else becomes 'unknown'. */
export type FeedCommentVerb = 'add' | 'edited' | 'remove' | 'hide' | 'unhide' | 'unknown'

export type FeedCommentEvent = {
  /** From the signed webhook entry — never from the payload body. */
  pageId: string
  commentId: string
  postId: string
  /** The parent OBJECT: the post for a top-level comment, a comment for a reply. */
  parentId: string | null
  isTopLevel: boolean
  /** Page-scoped author id. Not a phone, not an email, not contactable. */
  authorId: string | null
  authorName: string | null
  /**
   * The Page wrote this itself — a reply the business posted, from Facebook or
   * from SocialCRM. Such a comment is thread context, never incoming work and
   * never a lead. Decided by `from.id === pageId` (the verified entry id).
   */
  authorIsPage: boolean
  message: string
  /**
   * Whether Meta actually sent text.
   *
   * `message` is gated behind `pages_read_user_content` (approved; a Page whose
   * token predates the grant still delivers none until it reconnects). Also
   * false on a `remove`, where the body is legitimately gone. Keeping this separate from an empty
   * string is what lets the UI say "not available yet" instead of implying the
   * commenter wrote nothing.
   */
  messageAvailable: boolean
  createdTime: Date | null
  verb: FeedCommentVerb
  /**
   * A photo or video the commenter attached, as delivered on the webhook
   * (`photo` / `video`). https only; a photo wins when both are present.
   */
  attachment: { type: 'photo' | 'video'; url: string } | null
  /**
   * What the webhook says about the POST (`value.post`): its permalink — only a
   * facebook.com https URL is kept — and Meta's `status_type`. Context, never
   * tenancy.
   */
  post: { permalinkUrl: string | null; statusType: string | null }
}

const KNOWN_VERBS: readonly string[] = ['add', 'edited', 'remove', 'hide', 'unhide']

/** An absolute https URL, or null. */
function httpsUrl(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  try {
    return new URL(s).protocol === 'https:' ? s : null
  } catch {
    return null
  }
}

/** A permalink only when it points at Facebook itself. */
function facebookPermalink(v: unknown): string | null {
  const s = httpsUrl(v)
  if (!s) return null
  const host = new URL(s).hostname
  return host === 'facebook.com' || host.endsWith('.facebook.com') ? s : null
}

/** A non-empty string, or null. Rejects numbers, objects and empty strings. */
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** A plain object, or an empty one. Arrays and functions are not records. */
function record(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export function parseFeedComment(pageId: string, value: unknown): FeedCommentEvent | null {
  // The caller must supply a verified page. Without one there is no tenant to
  // resolve downstream, so the event is unusable.
  if (typeof pageId !== 'string' || pageId.length === 0) return null

  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const v = value as Record<string, unknown>

  // Feed carries posts, photos, videos, likes and shares too. Only comments here.
  if (v.item !== 'comment') return null

  // Both ids are load-bearing: commentId is the dedup key, postId locates the
  // comment and decides top-level. Without either, drop the event.
  const commentId = str(v.comment_id)
  const postId = str(v.post_id)
  if (!commentId || !postId) return null

  const from = record(v.from)
  const post = record(v.post)
  const photo = httpsUrl(v.photo)
  const video = httpsUrl(v.video)
  const parentId = str(v.parent_id)
  const message = typeof v.message === 'string' ? v.message : ''
  const rawVerb = typeof v.verb === 'string' ? v.verb : ''

  const createdTime =
    typeof v.created_time === 'number' && Number.isFinite(v.created_time)
      ? new Date(v.created_time * 1000)
      : null

  return {
    pageId,
    commentId,
    postId,
    parentId,
    // A missing parent_id is read as top-level: Meta always sends one for a
    // reply, so its absence cannot indicate nesting.
    isTopLevel: parentId === null || parentId === postId,
    authorId: str(from.id),
    authorName: str(from.name),
    authorIsPage: str(from.id) === pageId,
    message,
    messageAvailable: message.length > 0,
    createdTime,
    verb: KNOWN_VERBS.includes(rawVerb) ? (rawVerb as FeedCommentVerb) : 'unknown',
    attachment: photo ? { type: 'photo', url: photo } : video ? { type: 'video', url: video } : null,
    post: { permalinkUrl: facebookPermalink(post.permalink_url), statusType: str(post.status_type) },
  }
}
