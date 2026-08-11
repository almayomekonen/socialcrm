// The dropdown's rules, proven without a DOM.
//
// The load-bearing one is the seen boundary: the panel renders a slice of the
// feed, and only that slice may be stamped. Getting it wrong is silent — rows
// would be marked seen that nobody saw, and "While you were away" would quietly
// stop telling the truth.
//
// Runs without a database: `npm run test:notifications`.

import { describe, expect, it } from 'vitest'
import {
  CATEGORY_ICON,
  CATEGORY_LABEL,
  DROPDOWN_ITEM_LIMIT,
  bellLabel,
  hasMeaningfulAway,
  idsToStampSeen,
  renderedNotifications,
} from '@/modules/notifications/dropdown'
import { NOTIFICATION_CATEGORIES } from '@/lib/notifications/types'
import type { NotificationFeedItem, WhileYouWereAway } from '@/modules/notifications/types'

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
    deepLink: '/clients/55',
    groupCount: 1,
    createdAt: '2026-08-11T12:00:00.000Z',
    seenAt: null,
    readAt: null,
    toastEligible: true,
    ...over,
  }
}

const many = (n: number) => Array.from({ length: n }, (_, i) => item({ id: i + 1 }))

describe('renderedNotifications', () => {
  it('caps the panel at the render limit', () => {
    expect(renderedNotifications(many(50))).toHaveLength(DROPDOWN_ITEM_LIMIT)
  })

  it('keeps the feed order — newest first, as the server sorted it', () => {
    const rows = [item({ id: 9 }), item({ id: 5 }), item({ id: 2 })]
    expect(renderedNotifications(rows).map((i) => i.id)).toEqual([9, 5, 2])
  })

  it('returns everything when the feed is short', () => {
    expect(renderedNotifications(many(3))).toHaveLength(3)
  })

  it('returns nothing for an empty feed', () => {
    expect(renderedNotifications([])).toEqual([])
  })
})

describe('idsToStampSeen — the precision that matters', () => {
  it('stamps only the RENDERED rows, not the whole feed page', () => {
    // 50 in the feed, 8 on screen: exactly 8 get stamped.
    const rendered = renderedNotifications(many(50))
    const ids = idsToStampSeen(rendered)
    expect(ids).toHaveLength(DROPDOWN_ITEM_LIMIT)
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('skips rows the database already reports as seen', () => {
    const rendered = [item({ id: 1, seenAt: '2026-08-11T11:00:00.000Z' }), item({ id: 2 }), item({ id: 3 })]
    expect(idsToStampSeen(rendered)).toEqual([2, 3])
  })

  it('returns nothing when every rendered row is already seen', () => {
    const seen = [item({ id: 1, seenAt: 'x' }), item({ id: 2, seenAt: 'y' })]
    expect(idsToStampSeen(seen)).toEqual([])
  })

  it('is indifferent to readAt — seen and read are separate facts', () => {
    // A row can be read without ever having been surfaced by SocialCRM (a clicked
    // push), and it can be surfaced while staying unread. Neither implies the other.
    const rendered = [item({ id: 1, readAt: '2026-08-11T11:00:00.000Z', seenAt: null })]
    expect(idsToStampSeen(rendered)).toEqual([1])
  })
})

describe('hasMeaningfulAway', () => {
  const away = (over: Partial<WhileYouWereAway> = {}): WhileYouWereAway => ({
    since: '2026-08-11T09:00:00.000Z',
    total: 3,
    categories: [{ category: 'leads', count: 3 }],
    ...over,
  })

  it('is true for a real away window', () => {
    expect(hasMeaningfulAway(away())).toBe(true)
  })

  it('is false when the server sent nothing', () => {
    expect(hasMeaningfulAway(null)).toBe(false)
  })

  it('is false for a zero total — no empty section announcing that nothing happened', () => {
    expect(hasMeaningfulAway(away({ total: 0, categories: [] }))).toBe(false)
  })

  it('is false when there are no categories to name', () => {
    expect(hasMeaningfulAway(away({ categories: [] }))).toBe(false)
  })
})

describe('category presentation', () => {
  it('covers every category, so a new one cannot render without an icon', () => {
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(CATEGORY_ICON[category]).toBeTruthy()
      expect(CATEGORY_LABEL[category]).toBeTruthy()
    }
  })

  it('reuses the nav vocabulary for concepts the nav already names', () => {
    expect(CATEGORY_ICON.leads).toBe('image-polaroid-user')
    expect(CATEGORY_ICON.messages).toBe('comments')
    expect(CATEGORY_ICON.followups).toBe('list-check')
  })

  it('uses no emoji anywhere in the labels', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
    for (const label of Object.values(CATEGORY_LABEL)) expect(emoji.test(label)).toBe(false)
  })
})

describe('bellLabel — the count lives in the accessible name', () => {
  it('names the control plainly when there is nothing unread', () => {
    expect(bellLabel(0)).toBe('התראות')
    expect(bellLabel(-1)).toBe('התראות')
  })

  it('states an exact count', () => {
    expect(bellLabel(1)).toBe('התראות, חדשה אחת')
    expect(bellLabel(4)).toBe('התראות, 4 חדשות')
    expect(bellLabel(99)).toBe('התראות, 99 חדשות')
  })

  it('caps in words at the same boundary the badge caps visually', () => {
    // What a screen reader hears and what the screen shows must not disagree.
    expect(bellLabel(100)).toBe('התראות, יותר מ-99 חדשות')
    expect(bellLabel(5000)).toBe('התראות, יותר מ-99 חדשות')
  })
})
