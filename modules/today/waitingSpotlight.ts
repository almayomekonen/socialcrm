import { waitingReplyCopy } from '@/lib/inbox/waitingReplyCopy'
import { reasonFor } from '@/lib/today/labels'
import type { BriefItem } from '@/lib/today/types'
import type { Recommendation } from '@/lib/leads/recommend'
import type { WaitingWhatsappRow } from '@/db/inboxWaiting'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { WindowState } from '@/lib/today/types'

export type TodayRecommendation = Recommendation & {
  conversationId?: number | null
  windowHint?: string | null
  /** The window state behind `windowHint` — for logic; never parse the hint. */
  windowState?: WindowState | null
  eyebrow?: string | null
}

export function inboxHrefForConversation(conversationId: number): string {
  return `/inbox?conversation=${conversationId}`
}

export function toWaitingRecommendation(waiter: WaitingWhatsappRow, nowMs: number, locale: UiLocale = 'he'): TodayRecommendation {
  const t = translatorFor(locale)
  const copy = waitingReplyCopy({
    lastInboundAt: waiter.lastInboundAt,
    lastHumanOutboundAt: waiter.lastHumanOutboundAt,
    nowMs,
    channel: 'whatsapp',
    locale,
  })
  return {
    lead: {
      id: waiter.leadId,
      name: waiter.name || waiter.phone || t('today.conversationFallback'),
      phone: waiter.phone,
      status: waiter.status,
      nextFollowUpAt: null,
    },
    reason: copy?.waitingFor ?? reasonFor('WAITING_REPLY', locale),
    reasonCode: 'WAITING_REPLY',
    conversationId: waiter.conversationId,
    windowHint: copy?.windowHint ?? null,
    windowState: copy?.window ?? null,
    eyebrow: t('today.eyebrow.needsAction'),
  }
}

/** Oldest waiter becomes the hero. Existing recommended order is otherwise unchanged. */
export function mergeWaitingSpotlight(
  recommended: Recommendation[],
  waiter: WaitingWhatsappRow | null,
  nowMs: number,
  limit: number,
  locale: UiLocale = 'he',
): TodayRecommendation[] {
  if (!waiter) return recommended.slice(0, limit)
  const hero = toWaitingRecommendation(waiter, nowMs, locale)
  const rest = recommended.filter((r) => r.lead.id !== waiter.leadId)
  return [hero, ...rest].slice(0, limit)
}

export function hydrateBriefWaitingItems(
  items: BriefItem[],
  waiters: WaitingWhatsappRow[],
  nowMs: number,
  locale: UiLocale = 'he',
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
      locale,
    })
    return {
      ...item,
      conversationId: waiter.conversationId,
      href: inboxHrefForConversation(waiter.conversationId),
      waitingFor: copy?.waitingFor ?? null,
      windowHint: copy?.windowHint ?? null,
      windowState: copy?.window ?? null,
    }
  })
}
