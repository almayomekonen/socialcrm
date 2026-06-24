export type InboxChannel = 'whatsapp'

export type InboxAttention = 'needs_reply' | 'replied'

export type InboxConversationState = 'open' | 'archived' | 'closed'

export type InboxStatusFilter = 'all' | InboxConversationState

export type InboxSort = 'latest' | 'oldest' | 'unread' | 'temperature' | 'intent' | 'action'

/**
 * Intelligence-driven segments (Phase 4). Read from persisted
 * conversation_intelligence only — never computed at render time.
 *   hot        — temperature = hot
 *   attention  — temperature = hot AND awaiting reply (needs immediate attention)
 *   pricing    — intent = pricing
 *   demo       — intent = demo
 *   support    — intent = support
 *   escalation — suggested action = escalate_support
 *   followup   — suggested action = follow_up
 */
export type InboxIntelFilter = 'all' | 'hot' | 'attention' | 'pricing' | 'demo' | 'support' | 'escalation' | 'followup'

export type InboxListFilters = {
  q: string | null
  status: InboxStatusFilter
  unread: boolean
  needsReply: boolean
  intel: InboxIntelFilter
  sort: InboxSort
}

export const DEFAULT_INBOX_FILTERS: InboxListFilters = {
  q: null,
  status: 'all',
  unread: false,
  needsReply: false,
  intel: 'all',
  sort: 'latest',
}

/** Counts for the smart sections strip — derived from persisted intelligence. */
export type InboxSmartCounts = {
  hot: number
  attention: number
  demo: number
  escalation: number
}

export type InboxConversationListItem = {
  conversationId: number
  leadId: number
  channel: InboxChannel
  displayName: string | null
  leadName: string | null
  leadStatus: string | null
  lastMessageAt: string | null
  lastDirection: 'inbound' | 'outbound' | null
  lastMessagePreview: string | null
  unread: boolean
  attention: InboxAttention | null
  temperature: string | null
  intent: string | null
  suggestedAction: string | null
}

export type InboxCursor = {
  lastMessageAt: string
  id: number
  unread: boolean
  /** Sort-rank of the last row — present for intelligence sorts (temperature/intent/action). */
  rank?: number
}

export type InboxConversationsPage = {
  items: InboxConversationListItem[]
  nextCursor: InboxCursor | null
}

export type InboxConversationTarget = {
  conversationId: number
  leadId: number
  channel: InboxChannel
  displayName: string | null
  leadName: string | null
  leadStatus: string | null
}
