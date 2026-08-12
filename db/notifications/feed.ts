import { db } from '@/config/db'
import type { NotificationCategory } from '@/lib/notifications/types'
import type { FeedCursor, NotificationRow, WhileYouWereAway } from '@/modules/notifications/types'

/**
 * Notification feed reads — the bell's hot path.
 *
 * TENANT ISOLATION: every statement filters BOTH "agencyId" AND "userId", and
 * neither is ever taken from client input (the route supplies them from the
 * session). There is no read-by-id function here, so a guessed id has nothing to
 * address (spec §20.1). Asserted structurally by
 * __tests__/notifications/feed.sql.test.ts rather than by fixture, so the
 * predicate is proven present for every call and not just the cases someone
 * wrote a row for.
 *
 * NO JOINS ON THE HOT PATH. `title`, `body` and `deepLink` are already-rendered
 * copy, denormalized onto the row by P1's copy builders at persist time. Two
 * consequences, both deliberate:
 *   · no N+1 and no per-row entity lookup, at any feed size;
 *   · no join can leak a field the notification was not authorized to carry,
 *     because there is no join. Entity authorization happens at click time on the
 *     deep link's own route (spec §20.3), which is the only place that can decide
 *     it correctly anyway.
 *
 * The three reads below are independent and the route issues them concurrently.
 */

/** Dropdown page size. The bell shows recent, not all; the center paginates. */
export const FEED_ITEM_LIMIT = 20

/** Hard ceiling on ?limit, so a crafted request cannot ask for the whole table. */
export const FEED_MAX_LIMIT = 50

const ITEM_COLUMNS = [
  'id',
  'type',
  'category',
  'priority',
  'title',
  'body',
  'entityType',
  'entityId',
  'deepLink',
  'groupCount',
  'createdAt',
  'seenAt',
  'readAt',
] as const

/**
 * Recent notifications, newest first — read AND unread.
 *
 * Read rows are included on purpose: the dropdown is a short history, not an
 * inbox that empties itself. `readAt` travels with each row so the UI can style
 * state without a second request.
 *
 * ORDER BY "createdAt" DESC, id DESC matches notifications_user_created_idx
 * (spec §21.1) and the id tiebreak makes the keyset cursor total — without it,
 * two rows sharing a timestamp could straddle a page boundary and be served
 * twice or skipped.
 *
 * Note that a collapsed row keeps its ORIGINAL createdAt, so absorbing a fourth
 * event does not jump it to the top. That is the sanctioned order (§21.1 names
 * this index as the dropdown's path); re-sorting on updatedAt would be a product
 * change, not a P2.1 implementation detail.
 */
export function listNotificationsQuery(args: {
  agencyId: number
  userId: number
  limit: number
  cursor?: FeedCursor | null
  /**
   * The notification center's two filters (P2.4). Both are OPTIONAL and both
   * default to off, so the bell's call is byte-for-byte the P2.1 query.
   *
   * `unreadOnly` is served by notifications_user_unread_idx, the same partial
   * index the badge count uses. `category` has no index of its own: it narrows
   * an index scan that is already walking this user's rows newest-first and
   * stopping at LIMIT, which is the right trade for a per-user row count that
   * retention keeps small — a category index would cost every insert to save a
   * bounded scan.
   */
  unreadOnly?: boolean
  category?: NotificationCategory | null
}) {
  const q = db('notifications')
    .where({ agencyId: args.agencyId, userId: args.userId })
    .orderBy([
      { column: 'createdAt', order: 'desc' },
      { column: 'id', order: 'desc' },
    ])
    .limit(args.limit)
    .select(...ITEM_COLUMNS)

  if (args.cursor) {
    q.whereRaw('("createdAt", id) < (?, ?)', [args.cursor.createdAt, args.cursor.id])
  }
  if (args.unreadOnly) q.whereNull('readAt')
  if (args.category) q.where({ category: args.category })
  return q
}

/**
 * The bell badge number: unread NOTIFICATION ROWS.
 *
 * Not the nav badge's number. See modules/notifications/types.ts — one unread
 * conversation with six messages is 1 there and may be 1 collapsed row with
 * groupCount 6 here. Served by the partial index
 * notifications_user_unread_idx … WHERE "readAt" IS NULL.
 */
export function countUnreadNotificationsQuery(args: { agencyId: number; userId: number }) {
  return db('notifications')
    .where({ agencyId: args.agencyId, userId: args.userId })
    .whereNull('readAt')
    .count<{ count: string | number }>('id as count')
    .first()
}

/**
 * "While you were away" — counts per category over the persisted boundary.
 *
 * `seenAt IS NULL` is the correct predicate, not `readAt IS NULL`: seenAt means
 * SocialCRM itself surfaced the row, and a web push explicitly does NOT set it
 * (spec §8.2). So a user who was pushed about a lead but never opened the app
 * still gets it in their catch-up — which is the entire reason the two
 * timestamps are separate fields.
 *
 * Aggregated in SQL rather than by counting a fetched array, so the window costs
 * one row per category regardless of how many notifications landed overnight.
 * Served by notifications_unseen_idx … WHERE "seenAt" IS NULL.
 */
export function summarizeAwayNotificationsQuery(args: { agencyId: number; userId: number; since: Date }) {
  return db('notifications')
    .where({ agencyId: args.agencyId, userId: args.userId })
    .whereNull('seenAt')
    .where('createdAt', '>', args.since)
    .groupBy('category')
    .select('category')
    .count<{ category: NotificationCategory; count: string | number }[]>('id as count')
}

const toIso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(v as string).toISOString())
const toIsoOrNull = (v: unknown): string | null => (v == null ? null : toIso(v))

function mapItem(row: Record<string, unknown>): NotificationRow {
  return {
    id: Number(row.id),
    type: row.type as NotificationRow['type'],
    category: row.category as NotificationCategory,
    priority: row.priority as NotificationRow['priority'],
    title: String(row.title),
    body: (row.body as string | null) ?? null,
    entityType: (row.entityType as string | null) ?? null,
    entityId: row.entityId == null ? null : Number(row.entityId),
    deepLink: String(row.deepLink),
    groupCount: Number(row.groupCount ?? 1),
    createdAt: toIso(row.createdAt),
    seenAt: toIsoOrNull(row.seenAt),
    readAt: toIsoOrNull(row.readAt),
  }
}

/**
 * Returns raw rows. `toastEligible` is added by the assembler
 * (`lib/notifications/feed.ts`), which is the only layer that knows presence.
 */
export async function listNotifications(args: {
  agencyId: number
  userId: number
  limit: number
  cursor?: FeedCursor | null
  unreadOnly?: boolean
  category?: NotificationCategory | null
}): Promise<NotificationRow[]> {
  const rows = await listNotificationsQuery(args)
  return rows.map((r) => mapItem(r as Record<string, unknown>))
}

export async function countUnreadNotifications(args: { agencyId: number; userId: number }): Promise<number> {
  const row = await countUnreadNotificationsQuery(args)
  return Number(row?.count) || 0
}

/**
 * Returns null when the window is empty, which is what makes the UI's "only
 * appear when there is meaningful content" rule (Law 4) a property of the data
 * rather than a condition the component has to remember to check.
 */
export async function summarizeAwayNotifications(args: {
  agencyId: number
  userId: number
  since: Date
}): Promise<WhileYouWereAway | null> {
  const rows = await summarizeAwayNotificationsQuery(args)
  const categories = rows
    .map((r) => ({ category: r.category, count: Number(r.count) || 0 }))
    .filter((c) => c.count > 0)
  const total = categories.reduce((sum, c) => sum + c.count, 0)
  if (total === 0) return null
  return { since: args.since.toISOString(), total, categories }
}

/**
 * The cursor is derived from the LAST returned row rather than an offset, so
 * pagination cannot drift when a notification arrives mid-scroll. null when the
 * page was not full, which is the only reliable "no more pages" signal that does
 * not cost an extra count query.
 */
export function nextCursorFrom(items: NotificationRow[], limit: number): FeedCursor | null {
  if (items.length < limit || items.length === 0) return null
  const last = items[items.length - 1]
  return { createdAt: last.createdAt, id: last.id }
}
