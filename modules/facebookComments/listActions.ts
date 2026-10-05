'use server'

import { after } from 'next/server'
import { requireAgencyUser } from '@/lib/requireUser'
import { isFacebookCommentsEnabledForAgency } from '@/lib/facebook/comments/capability'
import { refreshCommentContext } from '@/lib/facebook/comments/enrich'
import { PAGE_STATUS_FILTERS } from './components/CommentsStatusFilter'
import { loadCommentsFeedPage, parseCursor, type CommentsFeedPage } from './feed'
import type { CommentStatusFilter } from './types'

export type MoreCommentsResult = ({ ok: true } & CommentsFeedPage) | { ok: false }

/**
 * "טען עוד" — the next page of the comments inbox.
 *
 * Tenancy from the session only; `status` and `cursor` are the browser's, so
 * both are validated against what the server itself issues before reaching SQL.
 * The new page gets the same bounded context enrichment as the first.
 */
export async function loadMoreComments(status: unknown, cursor: unknown): Promise<MoreCommentsResult> {
  try {
    const user = await requireAgencyUser()
    if (!isFacebookCommentsEnabledForAgency(user.agencyId)) return { ok: false }
    const safeCursor = parseCursor(cursor)
    if (!safeCursor) return { ok: false }
    const safeStatus: CommentStatusFilter = PAGE_STATUS_FILTERS.includes(status as CommentStatusFilter)
      ? (status as CommentStatusFilter)
      : 'all'

    const page = await loadCommentsFeedPage(user.agencyId, { status: safeStatus, cursor: safeCursor })
    const ids = page.items.map((c) => c.id)
    after(() => refreshCommentContext({ agencyId: user.agencyId, commentRowIds: ids }))
    return { ok: true, ...page }
  } catch (err) {
    console.error('[FacebookComments] loadMoreComments failed:', err instanceof Error ? err.message : 'unknown')
    return { ok: false }
  }
}
