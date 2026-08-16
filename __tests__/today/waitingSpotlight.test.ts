import { describe, expect, it } from 'vitest'
import type { WaitingWhatsappRow } from '@/db/inboxWaiting'
import {
  hydrateBriefWaitingItems,
  inboxHrefForConversation,
  mergeWaitingSpotlight,
  toWaitingRecommendation,
} from '@/modules/today/waitingSpotlight'
import type { BriefItem } from '@/lib/today/types'

const NOW = Date.UTC(2026, 7, 16, 12, 0, 0)
const H = 3_600_000

const waiter = (over: Partial<WaitingWhatsappRow> = {}): WaitingWhatsappRow => ({
  conversationId: 88,
  leadId: 4,
  name: 'דנה',
  phone: '0500000000',
  status: 'contacted',
  lastInboundAt: new Date(NOW - 7 * H).toISOString(),
  lastHumanOutboundAt: null,
  ...over,
})

describe('Today waiting spotlight', () => {
  it('oldest waiter becomes the hero and deep-links to that conversation', () => {
    const hero = toWaitingRecommendation(waiter(), NOW)
    expect(hero.eyebrow).toBe('צריך לטפל עכשיו')
    expect(hero.reason).toBe('ממתין 7 שעות')
    expect(hero.windowHint).toBe('נותרו 17 שעות בחלון WhatsApp')
    expect(hero.conversationId).toBe(88)
    expect(inboxHrefForConversation(hero.conversationId!)).toBe('/inbox?conversation=88')
  })

  it('does not invent a new ranking — existing recommended stay after the waiter', () => {
    const merged = mergeWaitingSpotlight(
      [
        { lead: { id: 1, name: 'א', phone: null, status: 'new', nextFollowUpAt: null }, reason: 'ליד חדש' },
        { lead: { id: 2, name: 'ב', phone: null, status: 'new', nextFollowUpAt: null }, reason: 'מעקב להיום' },
      ],
      waiter({ leadId: 9, conversationId: 12 }),
      NOW,
      3,
    )
    expect(merged.map((r) => r.lead.id)).toEqual([9, 1, 2])
    expect(merged[0].conversationId).toBe(12)
  })

  it('dedupes the waiter if that lead was already recommended', () => {
    const merged = mergeWaitingSpotlight(
      [{ lead: { id: 4, name: 'דנה', phone: null, status: 'contacted', nextFollowUpAt: null }, reason: 'מעקב באיחור' }],
      waiter(),
      NOW,
      3,
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].conversationId).toBe(88)
  })

  it('hydrates the exact conversation onto a WAITING_REPLY brief item', () => {
    const items: BriefItem[] = [
      {
        id: 4,
        name: 'דנה',
        phone: '050',
        state: 'WAITING_REPLY',
        reason: 'ממתין לתשובה שלך',
        targetSurface: 'inbox',
      },
      {
        id: 7,
        name: 'יוסי',
        phone: null,
        state: 'FOLLOWUP_DUE_TODAY',
        reason: 'מעקב להיום',
        targetSurface: 'lead',
      },
    ]
    const out = hydrateBriefWaitingItems(items, [waiter({ conversationId: 42 })], NOW)
    expect(out[0].conversationId).toBe(42)
    expect(out[0].href).toBe('/inbox?conversation=42')
    expect(out[0].waitingFor).toBe('ממתין 7 שעות')
    expect(out[1].href).toBeUndefined()
  })

  it('does not attach a conversation to non-waiting items', () => {
    const items: BriefItem[] = [
      {
        id: 4,
        name: 'דנה',
        phone: null,
        state: 'NEW_INBOUND',
        reason: 'ליד חדש',
        targetSurface: 'lead',
      },
    ]
    expect(hydrateBriefWaitingItems(items, [waiter()], NOW)[0].conversationId).toBeUndefined()
  })
})
