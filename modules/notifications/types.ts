/**
 * The notification feed contract — the ONLY shape P2.2 (NotificationContext) and
 * P2.3 (bell/dropdown) are allowed to depend on.
 *
 * Spec §13.1 promotes /api/inbox/awareness into /api/notifications/feed. This
 * file is the successor to modules/inbox/awareness/types.ts, and it exists as a
 * standalone module for one structural reason: if the UI imported row types from
 * db/ or lib/notifications/, every schema detail would become a client
 * dependency and the "database is the source of truth" boundary would leak in
 * the wrong direction. The UI gets a contract; the contract gets a version.
 *
 * TWO UNREAD COUNTS, DELIBERATELY (P2.0 discovery §11.1). They are NOT
 * interchangeable and must never be substituted for one another:
 *
 *   unreadConversationCount — unread inbox CONVERSATIONS. Powers the existing
 *                             nav badge. One conversation with six unread
 *                             messages counts 1.
 *   unreadNotificationCount — unread NOTIFICATION ROWS. Powers the bell badge.
 *                             A collapsed row counts 1 and carries groupCount 6.
 *
 * The nav badge must stay behaviourally identical after P2, so the feed carries
 * its number unchanged from the existing query rather than recomputing it.
 */

import type { NotificationCategory, NotificationType, Presence, Priority } from '@/lib/notifications/types'

/**
 * One notification, exactly as persisted — never merged, never grouped.
 *
 * Individual by contract (spec §11): twenty leads while away is twenty rows,
 * because the user has to work each one. Only the interruption channels
 * (push/email) ever group, and that is a later delivery-layer concern.
 *
 * `title` and `body` are already-rendered Hebrew copy, written by P1's
 * deterministic copy builders at persist time. That denormalization is why the
 * feed needs no joins (§ query strategy in db/notifications/feed.ts).
 */
export type NotificationFeedItem = {
  id: number
  type: NotificationType
  category: NotificationCategory
  priority: Priority
  title: string
  body: string | null
  entityType: string | null
  entityId: number | null
  /**
   * Targets the underlying ENTITY (/clients/42), never the notification
   * (spec §20.2). A notification id is not a capability: it grants nothing, and
   * authorization is re-checked at the destination on click.
   */
  deepLink: string
  /** How many events this row absorbed via collapse. 1 for an uncollapsed row. */
  groupCount: number
  createdAt: string
  /** Set when a SocialCRM surface displayed it. A web push does NOT set this. */
  seenAt: string | null
  /** Set when the user explicitly read it. Clears the badge, frees the collapse key. */
  readAt: string | null
  /**
   * May this row be presented as a toast? Decided SERVER-side from the registry
   * policy and the server's presence classification
   * (`lib/notifications/toastEligibility.ts`), because the client has neither.
   *
   * Eligible is not the same as "toast it": the client still applies the two
   * facts only it knows — arrived after mount, and not already toasted this
   * session.
   */
  toastEligible: boolean
}

/** A persisted row before the server decorates it with presence-dependent fields. */
export type NotificationRow = Omit<NotificationFeedItem, 'toastEligible'>

/**
 * "While you were away" — a persisted summary, never frontend memory.
 *
 * `since` is user_presence.awaySinceAt: the boundary is stored, so it survives
 * the presence write in the very request that computes it and stays stable
 * across subsequent polls (P2.0 discovery §7).
 *
 * Category counts only. The rows themselves are already in `items`, and
 * duplicating them here would invite the UI to render the same notification
 * twice.
 */
export type WhileYouWereAway = {
  since: string
  total: number
  categories: { category: NotificationCategory; count: number }[]
}

/** Keyset pagination cursor, for the notification center (P2.4). The bell never paginates. */
export type FeedCursor = { createdAt: string; id: number }

export type NotificationFeedResponse = {
  /**
   * false ⇒ NOTIFICATIONS_ENABLED is off or this agency is not allowlisted, and
   * every other field is inert. The client keeps its existing awareness path, so
   * a disabled feed is byte-for-byte today's behaviour rather than a degraded
   * version of tomorrow's.
   */
  enabled: boolean
  /** Unread NOTIFICATION rows — the bell badge. */
  unreadNotificationCount: number
  /** Unread CONVERSATIONS — the existing nav badge metric, unchanged. */
  unreadConversationCount: number
  items: NotificationFeedItem[]
  whileYouWereAway: WhileYouWereAway | null
  /** Server-classified from user_presence. Echoed for observability; never trusted back. */
  presence: Presence
  /**
   * The server's clock, echoed by the client as the next `?since`. The client's
   * own clock is never an input — the awareness loop established this and skew
   * between a laptop and the server would silently drop or duplicate arrivals.
   */
  serverTime: string
  /** null ⇒ no further pages. */
  nextCursor: FeedCursor | null
}
