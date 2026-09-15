import type { NotificationFeedItem } from './types'

/**
 * WHICH ROWS BECOME A TOAST — pure, so the dedup rules can be proven without
 * React, a clock, or a fake server.
 *
 * Spec §13.2. Four independent gates, and each one closes a different hole. They
 * are all necessary; removing any one produces a real, specific bug:
 *
 *   1. toastEligible          — server's channel-policy decision (§13.2). Without
 *                               it the client would be a second routing site and
 *                               quiet types would start interrupting.
 *   2. seenAt IS NULL         — the DURABLE gate. The database, not the browser,
 *                               remembers what was surfaced, so a reload or a
 *                               second tab cannot re-toast yesterday's rows.
 *   3. not already toasted    — the SESSION gate. Covers the window between
 *                               toasting and the seen-stamp round-trip, during
 *                               which polls still return seenAt = null.
 *   4. createdAt > mountedAt  — the BACKLOG gate. Pre-existing unread shows as a
 *                               count, never as a flood of toasts on load
 *                               (care-charter: proportional, never overwhelming).
 *
 * Gates 2 and 3 are deliberately BOTH present. Gate 3 alone would forget across
 * reloads; gate 2 alone would re-toast for the seconds before the stamp lands.
 * Together, frontend memory handles only the in-flight window and the database
 * stays authoritative for everything durable — which is the rule P2.2 is required
 * to honour.
 */
export function selectToastable(args: {
  items: NotificationFeedItem[]
  /** ISO. Client mount time — the boundary between backlog and genuinely new. */
  mountedAt: string
  /** Ids this session has already presented. */
  alreadyToasted: ReadonlySet<number>
  /** Categories another live system still owns (see AWARENESS_OWNED_CATEGORIES). */
  suppressedCategories: ReadonlySet<string>
  /** Types inside a suppressed category that no other system toasts (see MESSAGE_TYPES_TOASTED_BY_REGISTRY). */
  exemptTypes?: ReadonlySet<string>
  /**
   * The page the user is on. An exempt type is not toasted on its own surface — a
   * rep in the Messenger tab already sees the conversation arrive (frontend
   * guidelines §15), the same silence Awareness keeps inside the WhatsApp inbox.
   */
  currentPath?: string
}): NotificationFeedItem[] {
  return args.items.filter((item) => {
    if (!item.toastEligible) return false
    if (item.seenAt !== null) return false
    if (args.alreadyToasted.has(item.id)) return false
    if (args.suppressedCategories.has(item.category)) {
      if (!args.exemptTypes?.has(item.type)) return false
      if (args.currentPath && item.deepLink.split('?')[0] === args.currentPath) return false
    }
    return item.createdAt > args.mountedAt
  })
}

/**
 * Categories NotificationContext must stay silent about while the legacy
 * awareness path is still mounted.
 *
 * `messages` is owned by AwarenessContext today: its poll toasts new WhatsApp
 * arrivals, and the spec's retirement table (§13.1) hands that job to the
 * registry-driven toast only when awareness is retired. Until then, both systems
 * are alive at once, and without this suppression an enabled feed would produce
 * TWO toasts for one inbound message.
 *
 * It is empty of `leads` etc. on purpose — nothing else has a competing toast
 * path, so nothing else needs suppressing.
 *
 * REMOVED IN P2.6, together with AwarenessProvider. That is the whole change:
 * delete this set and the messages category starts toasting through the registry.
 *
 * Load-bearing while Awareness remains mounted: `message.inbound` now emits real
 * rows (P3.3 coverage). Without this suppression an enabled feed would produce
 * TWO toasts for one inbound WhatsApp message — Awareness plus NotificationContext.
 */
export const AWARENESS_OWNED_CATEGORIES: ReadonlySet<string> = new Set(['messages'])

/**
 * Message types Awareness does NOT own. Awareness polls the WhatsApp inbox only,
 * so suppressing Messenger with the rest of `messages` would leave a Messenger
 * arrival with no toast at all — nothing would ever double it.
 */
export const MESSAGE_TYPES_TOASTED_BY_REGISTRY: ReadonlySet<string> = new Set(['message.messenger_inbound'])

/**
 * A cheap change signature, used to skip state updates when a poll returns
 * nothing new.
 *
 * The feed polls every few seconds and usually returns an identical page; without
 * this, every consumer would re-render on every tick for no reason. Covers the
 * fields a consumer can actually observe — id, seen and read state per row — so a
 * change the UI should reflect can never be skipped.
 */
export function feedSignature(args: {
  unreadNotificationCount: number
  presence: string
  items: NotificationFeedItem[]
  whileYouWereAwayTotal: number | null
}): string {
  const rows = args.items.map((i) => `${i.id}:${i.seenAt ? 1 : 0}${i.readAt ? 1 : 0}`).join(',')
  return `${args.unreadNotificationCount}|${args.presence}|${args.whileYouWereAwayTotal ?? '-'}|${rows}`
}
