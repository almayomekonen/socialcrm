import type { IconNames } from '@/lib/Icon'
import type { NotificationCategory } from '@/lib/notifications/types'
import type { NotificationFeedItem, WhileYouWereAway } from './types'

/**
 * The dropdown's rules, kept pure so the ones that matter can be proven without
 * a DOM: which rows are actually surfaced, and therefore which rows may be
 * stamped seen.
 *
 * Spec §13.2, §8.2. The bell and the panel are thin renderers over this.
 */

/**
 * How many rows the panel shows.
 *
 * A compact system control, not a page (§13 "triage, never dump"): the point of
 * the dropdown is to answer "what needs me now", and a scrolling wall of fifty
 * rows answers a different question. The feed may hold more — those stay in the
 * count and reach the full center in P2.5.
 */
export const DROPDOWN_ITEM_LIMIT = 8

/**
 * The rows the panel will render. Order is the feed's own (createdAt DESC).
 *
 * THIS IS THE SEEN BOUNDARY. Everything downstream derives from it, which is why
 * it is one function rather than a `.slice()` repeated at each call site: if the
 * panel showed a different set than the one we stamp, we would either mark rows
 * seen that nobody saw, or re-toast rows that were.
 */
export function renderedNotifications(
  items: NotificationFeedItem[],
  limit: number = DROPDOWN_ITEM_LIMIT,
): NotificationFeedItem[] {
  return items.slice(0, limit)
}

/**
 * Which of the rendered rows still need a seenAt stamp.
 *
 * Only the rendered ones, and only those not already seen. A feed page of fifty
 * with eight rendered stamps eight — "the request returned it" is not "the user
 * saw it" (spec §8.2), and neither is "it exists further down a list we truncated".
 */
export function idsToStampSeen(rendered: NotificationFeedItem[]): number[] {
  return rendered.filter((item) => item.seenAt === null).map((item) => item.id)
}

/**
 * Is there anything worth showing a "While you were away" block for?
 *
 * Derived entirely from the persisted summary the feed computed from
 * `awaySinceAt` (P2.1) — never from anything the browser remembers. A zero total
 * renders nothing rather than an empty section announcing that nothing happened.
 */
export function hasMeaningfulAway(away: WhileYouWereAway | null): away is WhileYouWereAway {
  return away !== null && away.total > 0 && away.categories.length > 0
}

/**
 * Category → icon, reusing the vocabulary the nav already established for the
 * same concepts, so a notification about a lead carries the lead icon the user
 * has been clicking all day.
 *
 * Closed `Record`, so adding a category without deciding its icon fails `tsc`.
 * There is deliberately NO priority → colour map: the app has no such
 * convention to reuse, and inventing one is exactly what CLAUDE.md §14 forbids.
 * Priority reaches the user through the copy the registry already writes.
 */
export const CATEGORY_ICON: Record<NotificationCategory, IconNames> = {
  leads: 'image-polaroid-user',
  messages: 'comments',
  followups: 'list-check',
  sla: 'clock',
  integrations: 'plug',
}

export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  leads: 'לידים',
  messages: 'שיחות',
  followups: 'מעקבים',
  sla: 'זמני תגובה',
  integrations: 'חיבורים',
}

/**
 * The bell's accessible name.
 *
 * The count lives HERE rather than in a live region: a polling badge wired to
 * `aria-live` would announce itself every few seconds, which is noise, not
 * accessibility. Put in the name, it is available on demand — when the user
 * reaches the control — and never interrupts.
 *
 * Capped in words at the same boundary the badge caps visually, so what a screen
 * reader hears and what the screen shows never disagree.
 */
export function bellLabel(unreadCount: number): string {
  if (unreadCount <= 0) return 'התראות'
  if (unreadCount === 1) return 'התראות, חדשה אחת'
  if (unreadCount > 99) return 'התראות, יותר מ-99 חדשות'
  return `התראות, ${unreadCount} חדשות`
}
