import type { Knex } from 'knex'
import { db } from '@/config/db'
import {
  COMMENT_STATUSES,
  type CommentListItem,
  type CommentPost,
  type CommentReply,
  type CommentsCursor,
  type CommentsPage,
  type CommentStatusFilter,
} from './types'

/**
 * Comments Inbox read layer.
 *
 * TENANCY: every exported builder takes `agencyId` as a required first-class
 * argument and applies it unconditionally. There is no code path that reads
 * comments without a tenant predicate, and no caller can pass one in from the
 * client — the page resolves it from the session (see the route).
 *
 * Builders are exported separately from the executors so their SQL can be
 * pinned by `.toSQL()` tests without a live database — the repo's established
 * pattern (see `db/automations/jobs.ts` and `__tests__/automations/queueDb.sql.test.ts`).
 */

export const COMMENTS_PAGE_SIZE = 30
const MAX_PAGE_SIZE = 100

const SELECTED_COLUMNS = [
  'id',
  'pageId',
  'commentId',
  'postId',
  'parentId',
  'isTopLevel',
  'authorName',
  'message',
  'messageAvailable',
  'status',
  'convertedLeadId',
  'createdTime',
  'receivedAt',
  'authorPictureUrl',
  'attachmentType',
  'attachmentUrl',
] as const

/** A querystring is user input; anything unrecognised collapses to the default. */
function safeStatus(status: CommentStatusFilter | undefined): CommentStatusFilter {
  return status && COMMENT_STATUSES.includes(status) ? status : 'open'
}

export function listPageCommentsQuery(
  knex: Knex,
  agencyId: number,
  opts: { status?: CommentStatusFilter; cursor?: CommentsCursor | null; limit?: number } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? COMMENTS_PAGE_SIZE, 1), MAX_PAGE_SIZE)
  const status = safeStatus(opts.status)

  let q = knex('facebook_page_comments')
    .where({ agencyId })
    // The Page's own replies are thread context, never work items.
    .where({ authorIsPage: false })
    .orderByRaw('"receivedAt" desc, "id" desc')
    // One extra row is the "is there a next page" probe.
    .limit(limit + 1)
    .select(...SELECTED_COLUMNS)

  // A deleted comment is a tombstone kept for provenance, not work to do, so it
  // is excluded from every view except the one that asks for it by name —
  // UNLESS it produced a ליד: Facebook deleting the comment must not hide the
  // association, so it stays under "all" and "converted". Each OR is grouped,
  // so it can never widen the agency/author predicates above.
  if (status === 'all') {
    q = q.where((b) => b.whereNot({ status: 'deleted' }).orWhereNotNull('convertedLeadId'))
  } else if (status === 'converted') {
    q = q.where((b) => b.where({ status: 'converted' }).orWhere((d) => d.where({ status: 'deleted' }).whereNotNull('convertedLeadId')))
  } else {
    q = q.where({ status })
  }

  if (opts.cursor) {
    q = q.whereRaw('("receivedAt", id) < (?, ?)', [opts.cursor.receivedAt, opts.cursor.id])
  }

  return q
}

/** Badge count for the Inbox switcher. Open comments only — the actionable ones. */
export function countOpenCommentsQuery(knex: Knex, agencyId: number) {
  return knex('facebook_page_comments').where({ agencyId, status: 'open', authorIsPage: false }).count({ count: '*' })
}

const REPLY_COLUMNS = [
  'id',
  'pageId',
  'commentId',
  'parentId',
  'authorName',
  'authorIsPage',
  'sentByUserId',
  'message',
  'messageAvailable',
  'status',
  'createdTime',
  'receivedAt',
] as const

const MAX_THREAD_ROWS = 300

/**
 * Replies under a set of thread roots. Keyed by (pageId, parentId) — a comment
 * id is only meaningful inside its Page — and filtered by the tenant like every
 * other read here. Newest first so the row cap drops the OLDEST replies, never
 * the one just sent; `listCommentReplies` returns them oldest first for reading.
 */
export function listCommentRepliesQuery(knex: Knex, agencyId: number, roots: { pageId: string; commentId: string }[]) {
  return knex('facebook_page_comments')
    .where({ agencyId })
    .whereNot({ status: 'deleted' })
    .whereIn(
      ['pageId', 'parentId'],
      roots.map((r) => [r.pageId, r.commentId]),
    )
    .orderByRaw('COALESCE("createdTime", "receivedAt") desc, "id" desc')
    .limit(MAX_THREAD_ROWS)
    .select(...REPLY_COLUMNS)
}

export async function listCommentReplies(
  agencyId: number,
  roots: { pageId: string; commentId: string }[],
): Promise<CommentReply[]> {
  if (roots.length === 0) return []
  return ((await listCommentRepliesQuery(db, agencyId, roots)) as CommentReply[]).reverse()
}

/**
 * Post context for a set of comments — a SEPARATE query, not a join, so the
 * list query keeps reading one table under one tenant predicate. Keyed by
 * (pageId, postId) inside the agency: a post id is only meaningful on its Page.
 */
export function listCommentPostsQuery(knex: Knex, agencyId: number, keys: { pageId: string; postId: string }[]) {
  return knex('facebook_page_posts')
    .where({ agencyId })
    .whereIn(
      ['pageId', 'postId'],
      keys.map((k) => [k.pageId, k.postId]),
    )
    .select('pageId', 'postId', 'message', 'pictureUrl', 'permalinkUrl', 'fetchStatus')
}

export async function listCommentPosts(
  agencyId: number,
  keys: { pageId: string; postId: string }[],
): Promise<CommentPost[]> {
  const unique = [...new Map(keys.map((k) => [`${k.pageId}:${k.postId}`, k])).values()]
  if (unique.length === 0) return []
  return (await listCommentPostsQuery(db, agencyId, unique)) as CommentPost[]
}

export async function listPageComments(
  agencyId: number,
  opts: { status?: CommentStatusFilter; cursor?: CommentsCursor | null; limit?: number } = {},
): Promise<CommentsPage> {
  const limit = Math.min(Math.max(opts.limit ?? COMMENTS_PAGE_SIZE, 1), MAX_PAGE_SIZE)
  const rows = (await listPageCommentsQuery(db, agencyId, opts)) as CommentListItem[]

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items[items.length - 1]

  return {
    items,
    nextCursor:
      hasMore && last ? { receivedAt: new Date(last.receivedAt).toISOString(), id: last.id } : null,
  }
}

export async function countOpenComments(agencyId: number): Promise<number> {
  const row = (await countOpenCommentsQuery(db, agencyId).first()) as { count?: string | number } | undefined
  return Number(row?.count ?? 0)
}
