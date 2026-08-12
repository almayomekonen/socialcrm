import { NOTIFICATION_CATEGORIES, type NotificationCategory } from '@/lib/notifications/types'
import type { FeedCursor, NotificationFeedItem } from './types'

/**
 * The notification center's rules, kept pure — the same split
 * `modules/notifications/dropdown.ts` uses for the bell.
 *
 * Everything here is shared by a SERVER page (which validates the querystring
 * and runs the first page) and a CLIENT list (which pages and stamps seen).
 * Putting the vocabulary in one module is what stops the two from disagreeing
 * about what `?category=leads` means, and lets the parsing be proven without a
 * DOM or a database.
 */

/**
 * One page of the center.
 *
 * Larger than the dropdown's 8 because this surface answers a different
 * question — the dropdown triages "what needs me now", the center is where you
 * go to work through everything — and still bounded by FEED_MAX_LIMIT so no
 * request can ask for the table.
 */
export const CENTER_PAGE_SIZE = 25

/** The filter state, fully derived from the URL. There is no client filter state. */
export type CenterFilters = {
  unreadOnly: boolean
  category: NotificationCategory | null
}

export const NO_FILTERS: CenterFilters = { unreadOnly: false, category: null }

/**
 * Read the filters out of a querystring.
 *
 * Unknown values DEGRADE to "no filter" rather than erroring: a link from an
 * older tab, a hand-edited URL or a renamed category are all normal events, and
 * the useful response is the unfiltered list, not a broken page. The category is
 * checked against the registry's own vocabulary, so it can never reach SQL as
 * an arbitrary string.
 */
export function parseCenterFilters(params: {
  unread?: string | string[] | null
  category?: string | string[] | null
}): CenterFilters {
  const one = (v: string | string[] | null | undefined): string | null =>
    typeof v === 'string' ? v : Array.isArray(v) ? (v[0] ?? null) : null

  const unread = one(params.unread)
  const category = one(params.category)

  return {
    unreadOnly: unread === '1' || unread === 'true',
    category: NOTIFICATION_CATEGORIES.includes(category as NotificationCategory)
      ? (category as NotificationCategory)
      : null,
  }
}

/** The center's own URL for a given filter state. Chips are links, so this is their href. */
export function centerHref(filters: CenterFilters): string {
  const params = new URLSearchParams()
  if (filters.unreadOnly) params.set('unread', '1')
  if (filters.category) params.set('category', filters.category)
  const qs = params.toString()
  return qs ? `/notifications?${qs}` : '/notifications'
}

/**
 * The querystring for a "load more" request against the existing feed endpoint.
 *
 * The center adds no endpoint of its own: `?cursor=&limit=` was designated for
 * exactly this caller in the approved feed contract, and the two filters travel
 * beside them. Filters are repeated on every page because the cursor names a
 * position, not a query — a page fetched with different filters would splice
 * unrelated rows into the list.
 */
export function centerPageQuery(args: { cursor: FeedCursor; filters: CenterFilters; limit?: number }): string {
  const params = new URLSearchParams({
    cursor: encodeCursor(args.cursor),
    limit: String(args.limit ?? CENTER_PAGE_SIZE),
    // The center is not a poll and must not be read as presence: a page-2 fetch
    // says nothing about whether the tab is in front of the user.
    visible: '1',
  })
  if (args.filters.unreadOnly) params.set('unread', '1')
  if (args.filters.category) params.set('category', args.filters.category)
  return params.toString()
}

/**
 * Serialize a cursor for the wire — the ISO the response already carried, handed
 * back verbatim rather than converted to epoch milliseconds and back.
 */
export function encodeCursor(cursor: FeedCursor): string {
  return `${cursor.createdAt}_${cursor.id}`
}

/**
 * Which loaded rows still need a seenAt stamp.
 *
 * THE CENTER RENDERING A ROW IS A SURFACE EVENT (spec §8.2) — it is named in the
 * spec's list beside the toast and the dropdown. Unlike the dropdown there is no
 * render limit to respect: every row it has loaded is on the page, so every
 * unseen one qualifies. Rows on pages the user never asked for are not loaded
 * and therefore not seen, which is the same boundary drawn a different way.
 *
 * Seen is not read. Working through this list does not silently clear the badge.
 */
export function idsToStampSeen(items: NotificationFeedItem[]): number[] {
  return items.filter((item) => item.seenAt === null).map((item) => item.id)
}

/**
 * Append a page, ignoring ids already held.
 *
 * The de-duplication is not defensive noise: rows arrive while a user reads, so
 * the same notification can legitimately appear in a later page than the one it
 * was first served in. Keeping the first copy preserves the feed's order and
 * keeps React keys unique.
 */
export function appendPage(
  current: NotificationFeedItem[],
  page: NotificationFeedItem[],
): NotificationFeedItem[] {
  const seen = new Set(current.map((i) => i.id))
  return [...current, ...page.filter((i) => !seen.has(i.id))]
}

/** Chip vocabulary for the filter row, in the order the nav established. */
export const CENTER_CATEGORY_ORDER: readonly NotificationCategory[] = NOTIFICATION_CATEGORIES
