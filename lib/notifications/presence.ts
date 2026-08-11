/**
 * Presence classification — spec §7.2.
 *
 * Derived SERVER-SIDE from a user_presence row, never trusted from a client: a
 * client that could declare itself offline could farm itself push notifications,
 * and one that could declare itself online could silence them.
 *
 * Pure function of (row, now) so every boundary is unit-testable without a
 * database or a clock.
 *
 * P1 note: nothing writes user_presence yet — the feed poll is its single owner
 * and that is P2. So this classifier returns 'offline' for everyone today, which
 * is harmless because P1 dispatches IN_APP only and IN_APP is presence-
 * independent in every row of the §19 matrix.
 */

import type { Presence } from './types'

/** Recent enough to be watching. */
export const ONLINE_WINDOW_MS = 90_000

/** Recent enough to still be at the desk. */
export const IDLE_WINDOW_MS = 10 * 60 * 1000

export type PresenceRow = {
  lastSeenAt: Date
  /** The tab reported itself visible on its last poll. */
  lastSeenVisible: boolean
}

/**
 * A user with NO ROW classifies `offline`.
 *
 * Safe rather than merely convenient: the only channel that treats offline
 * differently is WEB_PUSH, and push requires an opted-in push_subscriptions
 * row. A user who has a subscription but no recent presence stamp is genuinely
 * away — exactly when push is the right channel. A user with neither simply
 * gets the in-app row, which is what the bell is for.
 */
export function classifyPresence(row: PresenceRow | null | undefined, now: Date): Presence {
  if (!row) return 'offline'

  const age = now.getTime() - row.lastSeenAt.getTime()
  // A future timestamp means clock skew, not presence from the future. Treat it
  // as fresh rather than letting a negative age fall through to offline.
  const elapsed = Math.max(age, 0)

  if (elapsed >= IDLE_WINDOW_MS) return 'offline'
  // Within the idle window but either stale or hidden: at the desk, not looking.
  if (elapsed >= ONLINE_WINDOW_MS || !row.lastSeenVisible) return 'idle'
  return 'online'
}
