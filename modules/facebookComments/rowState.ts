import type { CommentListItem, CommentStatus } from './types'

type Row = Pick<CommentListItem, 'status' | 'convertedLeadId'>

/**
 * Whether a comment row gets the ליד slot ("המר לליד", or "פתח ליד" once linked).
 *
 * A linked comment always keeps its link — also after Facebook deletes it. An
 * unlinked one can be converted unless it is deleted or ignored; that includes a
 * row marked 'converted' WITHOUT a ליד, which an earlier bug produced by linking
 * a failed create (production: comments 1 and 2). The action accepts those rows,
 * so the user can finish what the failed click started.
 */
export function hasLeadSlot(c: Row): boolean {
  if (c.convertedLeadId) return true
  return c.status !== 'deleted' && c.status !== 'ignored'
}

/** The status badge to show: "הומר לליד" only when there is a ליד to back it. */
export function badgeStatus(c: Row): CommentStatus | null {
  if (c.status === 'converted' && !c.convertedLeadId) return null
  return c.status
}
