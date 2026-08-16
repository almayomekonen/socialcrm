import { waitingReplyCopy } from '@/lib/inbox/waitingReplyCopy'
import { reasonFor } from '@/lib/today/labels'
import type { BriefItem } from '@/lib/today/types'
import type { Recommendation } from '@/lib/leads/recommend'
import type { WaitingWhatsappRow } from '@/db/inboxWaiting'

export type TodayRecommendation = Recommendation & {
  conversationId?: number | null
  windowHint?: string | null
  eyebrow?: string | null
}

export function inboxHrefForConversation(conversationId: number): string {
  return `/inbox?conversation=${conversationId}`
}

export function toWaitingRecommendation(waiter: WaitingWhatsappRow, nowMs: number): TodayRecommendation {
  const copy = waitingReplyCopy({
    lastInboundAt: waiter.lastInboundAt,
    lastHumanOutboundAt: waiter.lastHumanOutboundAt,
    nowMs,
    channel: 'whatsapp',
  })
  return {
    lead: {
      id: waiter.leadId,
      name: waiter.name || waiter.phone || 'שיחה',
      phone: waiter.phone,
      status: waiter.status,
      nextFollowUpAt: null,
    },
    reason: copy?.waitingFor ?? reasonFor('WAITING_REPLY'),
    conversationId: waiter.conversationId,
    windowHint: copy?.windowHint ?? null,
    eyebrow: 'צריך לטפל עכשיו',
  }
}

/** Oldest waiter becomes the hero. Existing recommended order is otherwise unchanged. */
export function mergeWaitingSpotlight(
  recommended: Recommendation[],
  waiter: WaitingWhatsappRow | null,
  nowMs: number,
  limit: number,
): TodayRecommendation[] {
  if (!waiter) return recommended.slice(0, limit)
  const hero = toWaitingRecommendation(waiter, nowMs)
  const rest = recommended.filter((r) => r.lead.id !== waiter.leadId)
  return [hero, ...rest].slice(0, limit)
}

export function hydrateBriefWaitingItems(
  items: BriefItem[],
  waiters: WaitingWhatsappRow[],
  nowMs: number,
): BriefItem[] {
  if (waiters.length === 0) return items
  const byLead = new Map(waiters.map((w) => [w.leadId, w]))
  return items.map((item) => {
    if (item.state !== 'WAITING_REPLY') return item
    const waiter = byLead.get(item.id)
    if (!waiter) return item
    const copy = waitingReplyCopy({
      lastInboundAt: waiter.lastInboundAt,
      lastHumanOutboundAt: waiter.lastHumanOutboundAt,
      nowMs,
      channel: 'whatsapp',
    })
    return {
      ...item,
      conversationId: waiter.conversationId,
      href: inboxHrefForConversation(waiter.conversationId),
      waitingFor: copy?.waitingFor ?? null,
      windowHint: copy?.windowHint ?? null,
    }
  })
}
