import { countUnreadConversationsForUser } from '@/db/inboxConversationReads'
import {
  clearAwayBoundary,
  readPresence,
  resolveAwayBoundary,
  stampPresence,
  toPresenceRow,
} from '@/db/notifications/presence'
import {
  countUnreadNotifications,
  FEED_ITEM_LIMIT,
  listNotifications,
  nextCursorFrom,
  summarizeAwayNotifications,
} from '@/db/notifications/feed'
import { classifyPresence } from '@/lib/notifications/presence'
import { Roles } from '@/types/roles'
import type { FeedCursor, NotificationFeedResponse } from '@/modules/notifications/types'

/**
 * Feed assembly — the ordered sequence behind GET /api/notifications/feed.
 *
 * Lives in lib/ rather than inside the route because the ORDER of these steps is
 * the correctness property (see below), and it belongs somewhere it can be unit
 * tested and, later, reused to server-render an initial payload without a
 * round-trip. The route above it deals only in HTTP: auth, flags, headers.
 *
 * The database is the source of truth for every field returned. Nothing here
 * caches, and nothing here holds state between requests.
 */

export type BuildFeedArgs = {
  /** From the session. NEVER from client input (spec §20.1). */
  agencyId: number
  /** From the session. NEVER from client input. */
  userId: number
  /** The tab reported itself visible. The only client-supplied input, and it can only affect the caller's own presence. */
  visible: boolean
  /**
   * From the session. Gates the CONVERSATION count only, mirroring
   * app/(app)/layout.tsx:88 — OFFICE never sees the inbox, so counting its unread
   * threads is the one way this endpoint could change what the nav badge shows.
   * Reported as 0 for OFFICE, exactly as the layout already does.
   */
  role?: string | null
  limit?: number
  cursor?: FeedCursor | null
  now?: Date
}

/**
 * STEP ORDER IS LOAD-BEARING.
 *
 * 1. READ presence — before anything writes it.
 * 2. DERIVE the away boundary from that read (pure).
 * 3. Concurrently: stamp presence (throttled), and run the three reads plus the
 *    conversation count.
 *
 * Step 1 must precede the stamp in step 3, because the stamp sets lastSeenAt to
 * now(): a read afterwards would report every user as having just arrived and the
 * away boundary could never be detected. This is the exact ordering bug the P2.0
 * discovery flagged, and the reason presence is read and written in two separate
 * statements rather than one clever RETURNING upsert.
 *
 * Presence classification uses the PRE-stamp snapshot, which is also correct
 * rather than merely convenient: it answers "where was this user before this
 * request", which is what channel routing needs. Classifying after the stamp
 * would make every polling user permanently ONLINE by construction.
 */
export async function buildNotificationFeed(args: BuildFeedArgs): Promise<Omit<NotificationFeedResponse, 'enabled'>> {
  const now = args.now ?? new Date()
  const limit = args.limit ?? FEED_ITEM_LIMIT
  const scope = { agencyId: args.agencyId, userId: args.userId }

  const snapshot = await readPresence(scope)
  const presence = classifyPresence(toPresenceRow(snapshot), now)
  const awayBoundary = resolveAwayBoundary({ snapshot, now })

  const [, unreadNotificationCount, unreadConversationCount, items, whileYouWereAway] = await Promise.all([
    stampPresence({ ...scope, visible: args.visible, awaySinceAt: awayBoundary }),
    countUnreadNotifications(scope),
    // The EXISTING conversation metric, called unchanged. P2 must not reinterpret
    // the nav badge, so the feed carries its number rather than deriving a new one
    // — including the layout's OFFICE guard, or an OFFICE user could acquire a
    // badge they have never had.
    args.role === Roles.OFFICE ? Promise.resolve(0) : countUnreadConversationsForUser(args.agencyId, args.userId),
    listNotifications({ ...scope, limit, cursor: args.cursor ?? null }),
    awayBoundary ? summarizeAwayNotifications({ ...scope, since: awayBoundary }) : Promise.resolve(null),
  ])

  /**
   * Close a boundary that has nothing left to show — the only write here beyond
   * the stamp, and it fires only on the transition. Two cases reach it: the user
   * came back to nothing new, and the user has since seen everything the window
   * covered. Guarded by `awayBoundary &&` so a settled feed performs no writes at
   * all on subsequent polls.
   */
  if (awayBoundary && !whileYouWereAway) await clearAwayBoundary(scope)

  return {
    unreadNotificationCount,
    unreadConversationCount,
    items,
    whileYouWereAway,
    presence,
    serverTime: now.toISOString(),
    nextCursor: nextCursorFrom(items, limit),
  }
}

/**
 * The inert response, returned whenever NOTIFICATIONS_ENABLED is off or the
 * agency is not allowlisted.
 *
 * Zeroes rather than real numbers, and NOT a 404 or an error: the client treats
 * `enabled: false` as "keep doing exactly what you did before", so a disabled
 * feed is today's behaviour unchanged rather than a degraded version of
 * tomorrow's. Nothing is read, and — critically — presence is NOT stamped, so a
 * flag that is off leaves the table untouched.
 */
export function inertFeed(now: Date = new Date()): NotificationFeedResponse {
  return {
    enabled: false,
    unreadNotificationCount: 0,
    unreadConversationCount: 0,
    items: [],
    whileYouWereAway: null,
    presence: 'offline',
    serverTime: now.toISOString(),
    nextCursor: null,
  }
}
