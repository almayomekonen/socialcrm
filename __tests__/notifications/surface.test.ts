// Toast surface selection — the four dedup gates, proven without React.
//
// This is where "does not toast twice" actually lives. NotificationContext wires
// it to a poll loop and a toast() call, but the decision itself is pure, so these
// tests need no clock, no server and no DOM.
//
// Runs without a database: `npm run test:notifications`.

import { describe, expect, it } from 'vitest'
import { AWARENESS_OWNED_CATEGORIES, feedSignature, selectToastable } from '@/modules/notifications/surface'
import type { NotificationFeedItem } from '@/modules/notifications/types'

const MOUNT = '2026-08-11T12:00:00.000Z'
const BEFORE = '2026-08-11T11:59:00.000Z'
const AFTER = '2026-08-11T12:00:30.000Z'
const LATER = '2026-08-11T12:01:00.000Z'

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
    createdAt: AFTER,
    seenAt: null,
    readAt: null,
    toastEligible: true,
    ...over,
  }
}

const select = (items: NotificationFeedItem[], alreadyToasted: number[] = []) =>
  selectToastable({
    items,
    mountedAt: MOUNT,
    alreadyToasted: new Set(alreadyToasted),
    suppressedCategories: AWARENESS_OWNED_CATEGORIES,
  })

describe('selectToastable — a genuinely new notification', () => {
  it('selects a row that arrived after mount, unseen, never toasted', () => {
    expect(select([item()]).map((i) => i.id)).toEqual([1])
  })

  it('selects it exactly once even when the same page is polled repeatedly', () => {
    const page = [item({ id: 7 })]
    const toasted = new Set<number>()

    // Poll 1: fresh. Poll 2 and 3: identical response, seenAt not yet round-tripped.
    const first = selectToastable({
      items: page,
      mountedAt: MOUNT,
      alreadyToasted: toasted,
      suppressedCategories: AWARENESS_OWNED_CATEGORIES,
    })
    for (const i of first) toasted.add(i.id)
    const second = selectToastable({
      items: page,
      mountedAt: MOUNT,
      alreadyToasted: toasted,
      suppressedCategories: AWARENESS_OWNED_CATEGORIES,
    })
    const third = selectToastable({
      items: page,
      mountedAt: MOUNT,
      alreadyToasted: toasted,
      suppressedCategories: AWARENESS_OWNED_CATEGORIES,
    })

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(0)
    expect(third).toHaveLength(0)
  })
})

describe('selectToastable — the four gates', () => {
  it('gate 1: a row the server did not mark toast-eligible never toasts', () => {
    expect(select([item({ toastEligible: false })])).toEqual([])
  })

  it('gate 2: a row already seen in the DATABASE never toasts, even in a new session', () => {
    // The durable gate: this is what survives a reload or a second tab.
    expect(select([item({ seenAt: '2026-08-11T12:00:10.000Z' })])).toEqual([])
  })

  it('gate 3: a row this session already toasted never toasts again', () => {
    expect(select([item({ id: 9 })], [9])).toEqual([])
  })

  it('gate 4: unread BACKLOG from before mount is a count, not a flood of toasts', () => {
    const backlog = [item({ id: 1, createdAt: BEFORE }), item({ id: 2, createdAt: BEFORE })]
    expect(select(backlog)).toEqual([])
  })

  it('a row created exactly at mount is backlog, not new (strict comparison)', () => {
    expect(select([item({ createdAt: MOUNT })])).toEqual([])
  })
})

describe('selectToastable — ordering cannot cause a duplicate', () => {
  it('dedups by id, so feed order is irrelevant', () => {
    const a = item({ id: 1, createdAt: AFTER })
    const b = item({ id: 2, createdAt: LATER })

    // The feed returns createdAt DESC; assert the reverse order picks the same set.
    const desc = select([b, a]).map((i) => i.id)
    const asc = select([a, b]).map((i) => i.id)
    expect(desc.sort()).toEqual([1, 2])
    expect(asc.sort()).toEqual([1, 2])
  })

  it('a row re-appearing at a different page position is still suppressed', () => {
    const target = item({ id: 4 })
    const other = item({ id: 5, createdAt: LATER })
    expect(select([target, other], [4]).map((i) => i.id)).toEqual([5])
    expect(select([other, target], [4]).map((i) => i.id)).toEqual([5])
  })
})

describe('selectToastable — awareness migration guard', () => {
  it('stays silent on the messages category, which AwarenessContext still owns', () => {
    // Without this, an enabled feed plus the live awareness poll would produce TWO
    // toasts for one inbound WhatsApp message.
    expect(select([item({ id: 3, category: 'messages', type: 'message.inbound' })])).toEqual([])
  })

  it('still toasts every other category', () => {
    const rows = [
      item({ id: 1, category: 'leads' }),
      item({ id: 2, category: 'integrations', type: 'integration.disconnected' }),
    ]
    expect(select(rows).map((i) => i.id)).toEqual([1, 2])
  })

  it('suppresses messages and only messages', () => {
    expect([...AWARENESS_OWNED_CATEGORIES]).toEqual(['messages'])
  })
})

describe('feedSignature', () => {
  it('is stable when a poll returns an identical page', () => {
    const args = { unreadNotificationCount: 3, presence: 'online', items: [item()], whileYouWereAwayTotal: null }
    expect(feedSignature(args)).toBe(feedSignature({ ...args }))
  })

  it('changes when the unread count changes', () => {
    const base = { presence: 'online', items: [item()], whileYouWereAwayTotal: null }
    expect(feedSignature({ ...base, unreadNotificationCount: 1 })).not.toBe(
      feedSignature({ ...base, unreadNotificationCount: 2 }),
    )
  })

  it('changes when a row becomes seen or read, so the UI can never miss it', () => {
    const base = { unreadNotificationCount: 1, presence: 'online', whileYouWereAwayTotal: null }
    const unseen = feedSignature({ ...base, items: [item()] })
    const seen = feedSignature({ ...base, items: [item({ seenAt: LATER })] })
    const read = feedSignature({ ...base, items: [item({ readAt: LATER })] })
    expect(new Set([unseen, seen, read]).size).toBe(3)
  })

  it('changes when a new row arrives', () => {
    const base = { unreadNotificationCount: 1, presence: 'online', whileYouWereAwayTotal: null }
    expect(feedSignature({ ...base, items: [item({ id: 1 })] })).not.toBe(
      feedSignature({ ...base, items: [item({ id: 1 }), item({ id: 2 })] }),
    )
  })

  it('changes when the While-you-were-away total changes', () => {
    const base = { unreadNotificationCount: 1, presence: 'online', items: [item()] }
    expect(feedSignature({ ...base, whileYouWereAwayTotal: null })).not.toBe(
      feedSignature({ ...base, whileYouWereAwayTotal: 4 }),
    )
  })
})
