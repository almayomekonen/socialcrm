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
   * False until Meta grants `pages_read_user_content`. NOT the same as an empty
   * comment — the UI must say "not available yet" rather than render a void.
   */
  messageAvailable: boolean
  status: CommentStatus
  convertedLeadId: number | null
  createdTime: Date | null
  receivedAt: Date
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
  message: string
  messageAvailable: boolean
  status: CommentStatus
  createdTime: Date | null
  receivedAt: Date
}
