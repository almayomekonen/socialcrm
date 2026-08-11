import type { Knex } from 'knex'
import { db } from '@/config/db'
import {
  COMMENT_STATUSES,
  type CommentListItem,
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
    .orderByRaw('"receivedAt" desc, "id" desc')
    // One extra row is the "is there a next page" probe.
    .limit(limit + 1)
    .select(...SELECTED_COLUMNS)

  // A deleted comment is a tombstone kept for provenance, not work to do, so it
  // is excluded from every view except the one that asks for it by name.
  q = status === 'all' ? q.whereNot({ status: 'deleted' }) : q.where({ status })

  if (opts.cursor) {
    q = q.whereRaw('("receivedAt", id) < (?, ?)', [opts.cursor.receivedAt, opts.cursor.id])
  }

  return q
}

/** Badge count for the Inbox switcher. Open comments only — the actionable ones. */
export function countOpenCommentsQuery(knex: Knex, agencyId: number) {
  return knex('facebook_page_comments').where({ agencyId, status: 'open' }).count({ count: '*' })
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
