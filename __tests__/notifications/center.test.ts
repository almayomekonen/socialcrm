// The notification center's rules, proven without a DOM or a database.
//
// These are the decisions shared by the server page and the client list — what a
// filter in the URL means, which rows may be stamped seen, and how a page is
// appended. Keeping them pure is what lets the SAME answer serve both sides;
// tests that could only reach them through a rendered page would not be able to
// prove that.
//
// Runs in `npm run test:notifications`.

import { describe, expect, it } from 'vitest'
import {
  appendPage,
  CENTER_PAGE_SIZE,
  centerHref,
  centerPageQuery,
  encodeCursor,
  idsToStampSeen,
  NO_FILTERS,
  parseCenterFilters,
} from '@/modules/notifications/center'
import { FEED_MAX_LIMIT } from '@/db/notifications/feed'
import { NOTIFICATION_CATEGORIES } from '@/lib/notifications/types'
import type { NotificationFeedItem } from '@/modules/notifications/types'

function item(over: Partial<NotificationFeedItem> = {}): NotificationFeedItem {
  return {
    id: 1,
    type: 'lead.created',
    category: 'leads',
    priority: 'medium',
    title: 'ליד חדש',
    body: null,
    entityType: 'lead',
    entityId: 55,
    deepLink: '/clients/55/summary',
    groupCount: 1,
    createdAt: '2026-08-11T10:00:00.000Z',
    seenAt: null,
    readAt: null,
    toastEligible: false,
    ...over,
  }
}

describe('a page is bounded', () => {
  it('never asks for more than the endpoint will serve', () => {
    // The ceiling is the endpoint's, so raising the page size cannot silently
    // start requesting a limit that gets clamped without anyone noticing.
    expect(CENTER_PAGE_SIZE).toBeLessThanOrEqual(FEED_MAX_LIMIT)
    expect(CENTER_PAGE_SIZE).toBeGreaterThan(0)
  })
})

describe('filters come from the URL, and only in a known vocabulary', () => {
  it('reads both axes', () => {
    expect(parseCenterFilters({ unread: '1', category: 'leads' })).toEqual({ unreadOnly: true, category: 'leads' })
  })

  it('defaults to no filter when the querystring is empty', () => {
    expect(parseCenterFilters({})).toEqual(NO_FILTERS)
    expect(parseCenterFilters({ unread: null, category: null })).toEqual(NO_FILTERS)
  })

  it('accepts every category the registry declares, and nothing else', () => {
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(parseCenterFilters({ category }).category).toBe(category)
    }
    // An unknown value must never reach SQL as an arbitrary string.
    for (const bogus of ['leads;drop', 'LEADS', 'billing', '', ' leads']) {
      expect(parseCenterFilters({ category: bogus }).category).toBeNull()
    }
  })

  it('degrades an unrecognized unread value to off rather than guessing', () => {
    expect(parseCenterFilters({ unread: '0' }).unreadOnly).toBe(false)
    expect(parseCenterFilters({ unread: 'yes' }).unreadOnly).toBe(false)
    expect(parseCenterFilters({ unread: 'true' }).unreadOnly).toBe(true)
  })

  it('takes the first value when a param is repeated', () => {
    // ?category=leads&category=sla — Next hands this over as an array.
    expect(parseCenterFilters({ category: ['sla', 'leads'] }).category).toBe('sla')
    expect(parseCenterFilters({ unread: ['1'] }).unreadOnly).toBe(true)
  })
})

describe('filter links round-trip', () => {
  it('an unfiltered view is the bare path', () => {
    expect(centerHref(NO_FILTERS)).toBe('/notifications')
  })

  it('every filter state parses back to itself', () => {
    for (const filters of [
      { unreadOnly: true, category: null },
      { unreadOnly: false, category: 'messages' as const },
      { unreadOnly: true, category: 'integrations' as const },
    ]) {
      const href = centerHref(filters)
      const qs = Object.fromEntries(new URLSearchParams(href.split('?')[1] ?? ''))
      expect(parseCenterFilters(qs)).toEqual(filters)
    }
  })
})

describe('paging asks the existing feed endpoint for the next page', () => {
  const cursor = { createdAt: '2026-08-11T10:00:00.000Z', id: 900 }

  it('carries the cursor, the limit and the filters together', () => {
    const qs = new URLSearchParams(centerPageQuery({ cursor, filters: { unreadOnly: true, category: 'leads' } }))
    expect(qs.get('cursor')).toBe(encodeCursor(cursor))
    expect(qs.get('limit')).toBe(String(CENTER_PAGE_SIZE))
    expect(qs.get('unread')).toBe('1')
    expect(qs.get('category')).toBe('leads')
  })

  it('omits filters that are off, so an unfiltered page asks for an unfiltered query', () => {
    const qs = new URLSearchParams(centerPageQuery({ cursor, filters: NO_FILTERS }))
    expect(qs.has('unread')).toBe(false)
    expect(qs.has('category')).toBe(false)
  })

  it('a cursor is a position, not a query — the filters must travel with it', () => {
    // Pinning the consequence rather than the implementation: if filters were
    // dropped on page 2, rows outside the filter would splice into the list.
    const filtered = centerPageQuery({ cursor, filters: { unreadOnly: true, category: 'sla' } })
    expect(filtered).toContain('unread=1')
    expect(filtered).toContain('category=sla')
  })

  it('the cursor is the timestamp and id the response gave, unconverted', () => {
    expect(encodeCursor(cursor)).toBe('2026-08-11T10:00:00.000Z_900')
  })
})

describe('the center stamps seen for what it renders — and no more', () => {
  it('stamps every loaded row that has never been seen', () => {
    const items = [item({ id: 1 }), item({ id: 2 }), item({ id: 3 })]
    expect(idsToStampSeen(items)).toEqual([1, 2, 3])
  })

  it('leaves an already-seen row alone', () => {
    const items = [item({ id: 1, seenAt: '2026-08-11T09:00:00.000Z' }), item({ id: 2 })]
    expect(idsToStampSeen(items)).toEqual([2])
  })

  it('seen is independent of read: a read row still needs its stamp', () => {
    // The two timestamps answer different questions (spec §8.2) — a row marked
    // read from the dropdown without ever being displayed here is still unseen.
    const items = [item({ id: 4, readAt: '2026-08-11T09:30:00.000Z', seenAt: null })]
    expect(idsToStampSeen(items)).toEqual([4])
  })

  it('stamps nothing when nothing is loaded', () => {
    expect(idsToStampSeen([])).toEqual([])
  })
})

describe('appending a page', () => {
  it('keeps order and adds the new rows', () => {
    const first = [item({ id: 10 }), item({ id: 9 })]
    const second = [item({ id: 8 }), item({ id: 7 })]
    expect(appendPage(first, second).map((i) => i.id)).toEqual([10, 9, 8, 7])
  })

  it('drops a row already held, so an arrival cannot appear twice', () => {
    // Rows arrive while a user reads, so the same notification can legitimately
    // be served on a later page than the one it first appeared in.
    const first = [item({ id: 10 }), item({ id: 9 })]
    const second = [item({ id: 9 }), item({ id: 8 })]
    expect(appendPage(first, second).map((i) => i.id)).toEqual([10, 9, 8])
  })

  it('keeps the copy already on screen rather than replacing it', () => {
    const first = [item({ id: 9, title: 'ראשון' })]
    const second = [item({ id: 9, title: 'שני' })]
    expect(appendPage(first, second)[0].title).toBe('ראשון')
  })

  it('an empty page changes nothing', () => {
    const first = [item({ id: 10 })]
    expect(appendPage(first, [])).toEqual(first)
  })
})
