import { db } from '@/config/db'

/**
 * seenAt / readAt writes — the only two lifecycle fields a USER SURFACE may set.
 * Spec §8.
 *
 * `resolvedAt` is deliberately absent from this module. Resolution means the
 * underlying business work happened, which the UI cannot know and must never
 * assert: a user reading a notification about an unhandled hot lead has not
 * handled it. Resolution is business-state driven (spec §9.1) and belongs to P4.
 *
 * TENANT ISOLATION: both statements filter agencyId AND userId AND id. The id is
 * an OBJECT IDENTIFIER, never an authorization capability — a guessed or borrowed
 * id updates zero rows because it will not match the caller's scope, and zero rows
 * is indistinguishable from a wrong id, so there is no enumeration oracle
 * (spec §20.1, §20.2).
 */

/**
 * Upper bound on a single batch.
 *
 * The feed serves at most FEED_MAX_LIMIT (50) rows, so a legitimate client never
 * needs more than that; the ceiling exists so a crafted body cannot turn one
 * request into an unbounded UPDATE. mark-all-read is a separate statement with no
 * id list precisely so it does not need a large batch.
 */
export const MAX_MARK_IDS = 100

/**
 * seenAt — "SocialCRM surfaced this to the user".
 *
 * `WHERE "seenAt" IS NULL` makes it first-write-wins and idempotent: re-surfacing
 * a row must not move the timestamp, because "when did the user first see this"
 * is the question "While you were away" asks, and a later render would otherwise
 * keep pushing the answer forward.
 *
 * Setting seenAt does NOT touch readAt, does NOT clear the badge, and does NOT
 * free the collapse key (spec §8.1). Seeing is not reading.
 */
export function markNotificationsSeenQuery(args: { agencyId: number; userId: number; ids: number[] }) {
  return db('notifications')
    .where({ agencyId: args.agencyId, userId: args.userId })
    .whereIn('id', args.ids)
    .whereNull('seenAt')
    .update({ seenAt: db.fn.now(), updatedAt: db.fn.now() })
}

/**
 * readAt — "the user explicitly read this".
 *
 * FREES THE COLLAPSE KEY, because the partial unique index is
 * `(userId, collapseKey) WHERE "readAt" IS NULL` (migration …120002). Once read, a
 * genuinely new event for the same entity may open a fresh row instead of being
 * absorbed — which is the entire point of collapse being keyed on unread state
 * rather than unseen state (spec §10.1).
 *
 * DELIBERATELY DOES NOT SET seenAt. The two fields stay independent (spec §8.1):
 * a push notification that the user clicks sets readAt while seenAt stays null,
 * because SocialCRM never surfaced it — the OS did. Collapsing them would destroy
 * the distinction "While you were away" depends on.
 */
export function markNotificationsReadQuery(args: { agencyId: number; userId: number; ids: number[] }) {
  return db('notifications')
    .where({ agencyId: args.agencyId, userId: args.userId })
    .whereIn('id', args.ids)
    .whereNull('readAt')
    .update({ readAt: db.fn.now(), updatedAt: db.fn.now() })
}

/** Mark-all-read. No id list, so no batch ceiling — the scope is the whole user. */
export function markAllNotificationsReadQuery(args: { agencyId: number; userId: number }) {
  return db('notifications')
    .where({ agencyId: args.agencyId, userId: args.userId })
    .whereNull('readAt')
    .update({ readAt: db.fn.now(), updatedAt: db.fn.now() })
}

/** Returns the number of rows actually transitioned, so callers can log honestly. */
export async function markNotificationsSeen(args: {
  agencyId: number
  userId: number
  ids: number[]
}): Promise<number> {
  if (!args.ids.length) return 0
  return markNotificationsSeenQuery(args)
}

export async function markNotificationsRead(args: {
  agencyId: number
  userId: number
  ids: number[]
}): Promise<number> {
  if (!args.ids.length) return 0
  return markNotificationsReadQuery(args)
}

/**
 * Close THIS user's open row for one piece of work — e.g. a Messenger conversation
 * they just read or answered. Without it the row stays open, every later message
 * collapses into it silently (no new toast, no push), and the conversation goes
 * quiet until someone happens to clear the bell.
 */
export async function markNotificationsReadByCollapseKey(args: {
  agencyId: number
  userId: number
  collapseKey: string
}): Promise<number> {
  return db('notifications')
    .where({ agencyId: args.agencyId, userId: args.userId, collapseKey: args.collapseKey })
    .whereNull('readAt')
    .update({ readAt: db.fn.now(), updatedAt: db.fn.now() })
}

export async function markAllNotificationsRead(args: { agencyId: number; userId: number }): Promise<number> {
  return markAllNotificationsReadQuery(args)
}

/**
 * Parses an id list from a request body.
 *
 * Rejects rather than coerces: a body that is not an array of positive integers is
 * a client bug or an attack, and silently "fixing" it would hide both. Truncation
 * is not used either — a caller asking to mark 5,000 rows has misunderstood the
 * endpoint and should be told.
 */
export function parseIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MARK_IDS) return null
  const ids = raw.map((v) => Number(v))
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) return null
  return Array.from(new Set(ids))
}
