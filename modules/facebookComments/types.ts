/**
 * Facebook Comments Inbox — shared shapes.
 *
 * Mirrors `modules/inbox/types.ts`: the list item carries exactly what a row
 * renders, and the cursor is a keyset, not an offset.
 */

export type CommentStatus = 'open' | 'converted' | 'ignored' | 'deleted'

/** `all` means "every live status" — deleted comments are tombstones, not work. */
export type CommentStatusFilter = CommentStatus | 'all'

export const COMMENT_STATUSES: readonly CommentStatusFilter[] = [
  'open',
  'converted',
  'ignored',
  'deleted',
  'all',
]

export type CommentListItem = {
  id: number
  /** The Page the comment was left on — an agency may own several. */
  pageId: string
  commentId: string
  postId: string
  /** Parent OBJECT: the post for a top-level comment, a comment for a reply. */
  parentId: string | null
  isTopLevel: boolean
  authorName: string | null
  message: string
  /**
   * False when Meta sent no text (before `pages_read_user_content`, or a Page token
   * that predates the grant). NOT the same as an empty
   * comment — the UI must say "not available yet" rather than render a void.
   */
  messageAvailable: boolean
  status: CommentStatus
  convertedLeadId: number | null
  createdTime: Date | null
  receivedAt: Date
  /** A picture Meta returned for this commenter, or null (initials are shown). Expiring CDN URL. */
  authorPictureUrl?: string | null
  /** A photo or video the commenter attached, from the webhook. */
  attachmentType?: 'photo' | 'video' | null
  attachmentUrl?: string | null
}

/**
 * The post a comment was left on, as far as we know it. Every field is
 * optional in practice: a legacy comment has no row at all, and a row may hold
 * only the webhook's permalink until enrichment reaches it.
 */
export type CommentPost = {
  pageId: string
  postId: string
  message: string | null
  pictureUrl: string | null
  permalinkUrl: string | null
  /** 'unavailable' — Meta says the post is gone. null — not fetched yet. */
  fetchStatus: 'ok' | 'unavailable' | 'denied' | null
}

/**
 * Keyset cursor. Ordered on `receivedAt` rather than `createdTime` because
 * `createdTime` is nullable (Meta may omit `created_time`), and a nullable
 * ordering key breaks keyset pagination. `receivedAt` is NOT NULL and
 * monotonic, and for live webhook traffic the two are seconds apart.
 */
export type CommentsCursor = { receivedAt: string; id: number }

export type CommentsPage = {
  items: CommentListItem[]
  nextCursor: CommentsCursor | null
}

/**
 * One entry in a comment's reply thread: another commenter's reply, or the
 * Page's own reply (from Facebook or from SocialCRM).
 */
export type CommentReply = {
  id: number
  pageId: string
  commentId: string
  parentId: string
  authorName: string | null
  authorIsPage: boolean
  /** Set only when the reply was sent from inside SocialCRM. */
  sentByUserId: number | null
  /**
   * Client-only: a reply this browser just published, shown before the refresh
   * brings the stored row. Never read from or written to the database.
   */
  sentHere?: boolean
  message: string
  messageAvailable: boolean
  status: CommentStatus
  createdTime: Date | null
  receivedAt: Date
}
