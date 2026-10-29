import { inboxWaitingCopy } from '@/lib/inbox/waitingReplyCopy'
import type { UiLocale } from '@/lib/i18n/config'
import { isWaitingForReply } from '@/lib/today/waitingReply'
import type { InboxAttention, InboxChannel, InboxConversationListItem } from './types'

const PREVIEW_MAX = 80

const toIso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null)

const truncate = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v)
  if (!s) return null
  return s.length > PREVIEW_MAX ? s.slice(0, PREVIEW_MAX - 1) + '…' : s
}

export function computeUnread(r: { lastInboundAt?: unknown; lastReadAt?: unknown }): boolean {
  const lastInboundMs = r.lastInboundAt ? new Date(r.lastInboundAt as string | Date).getTime() : null
  const lastReadMs = r.lastReadAt ? new Date(r.lastReadAt as string | Date).getTime() : null
  return lastInboundMs !== null && (lastReadMs === null || lastInboundMs > lastReadMs)
}

export function inboxAttention(input: {
  lastInboundAt: unknown
  lastHumanOutboundAt: unknown
  lastDirection: 'inbound' | 'outbound' | null
  nowMs: number
  channel?: string | null
}): InboxAttention | null {
  const waiting = isWaitingForReply({
    lastInboundAt: input.lastInboundAt as string | number | Date | null,
    lastHumanOutboundAt: input.lastHumanOutboundAt as string | number | Date | null,
    nowMs: input.nowMs,
  })
  if (waiting && (input.channel == null || input.channel === 'whatsapp')) return 'needs_reply'
  if (input.lastHumanOutboundAt != null && !waiting && input.lastDirection === 'outbound') return 'replied'
  if (!waiting && input.lastDirection === 'outbound' && input.lastHumanOutboundAt != null) return 'replied'
  return null
}

/**
 * `locale` only chooses the language of the two precomputed presentation
 * strings (`waitingTitle`, `waitingWindowHint`). Hebrew by default: every
 * caller that passes nothing (mobile API, mobile inbox, single-row reads) is
 * unchanged.
 */
export function mapInboxRow(r: Record<string, unknown>, nowMs: number, locale: UiLocale = 'he'): InboxConversationListItem {
  const lastDirection = (r.lastDirection ?? null) as 'inbound' | 'outbound' | null
  const lastInboundAt = toIso(r.lastInboundAt)
  const lastHumanOutboundAt = toIso(r.lastHumanOutboundAt)
  const channel = r.channel as InboxChannel
  const copy = inboxWaitingCopy({
    lastInboundAt,
    lastHumanOutboundAt,
    nowMs,
    channel,
    locale,
  })

  return {
    conversationId: Number(r.conversationId),
    leadId: r.leadId != null ? Number(r.leadId) : null,
    channel,
    displayName: (r.customerName as string) || (r.leadName as string) || (r.customerWaId as string) || null,
    leadName: (r.leadName as string) ?? null,
    leadStatus: (r.leadStatus as string) ?? null,
    lastMessageAt: toIso(r.lastMessageAt),
    lastInboundAt,
    lastHumanOutboundAt,
    lastDirection,
    lastMessagePreview: truncate(r.lastMessageText),
    unread: computeUnread(r),
    attention: inboxAttention({
      lastInboundAt,
      lastHumanOutboundAt,
      lastDirection,
      nowMs,
      channel,
    }),
    waitingTitle: copy?.title ?? null,
    waitingWindowHint: copy?.windowHint ?? null,
    temperature: (r.temperature as InboxConversationListItem['temperature']) ?? null,
    intent: (r.intent as InboxConversationListItem['intent']) ?? null,
    suggestedAction: (r.suggestedAction as InboxConversationListItem['suggestedAction']) ?? null,
  }
}
