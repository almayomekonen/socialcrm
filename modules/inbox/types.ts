export type InboxChannel = 'whatsapp'
export type InboxAttention = 'needs_reply' | 'replied'
export type InboxConversationState = 'open' | 'archived' | 'closed'
export type InboxStatusFilter = 'all' | InboxConversationState
export type InboxSort = 'latest' | 'oldest' | 'unread' | 'temperature' | 'intent' | 'action'
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

export type InboxSmartCounts = {
  hot: number
  attention: number
  demo: number
  escalation: number
}

export type InboxConversationListItem = {
  conversationId: number
  leadId: number | null
  channel: InboxChannel
  displayName: string | null
  leadName: string | null
  leadStatus: string | null
  lastMessageAt: string | null
  lastInboundAt: string | null
  lastHumanOutboundAt: string | null
  lastDirection: 'inbound' | 'outbound' | null
  lastMessagePreview: string | null
  unread: boolean
  attention: InboxAttention | null
  /** Precomputed waiting copy. Null on non-waiting rows — keep those rows clean. */
  waitingTitle: string | null
  waitingWindowHint: string | null
  temperature: string | null
  intent: string | null
  suggestedAction: string | null
}

export type InboxCursor = {
  lastMessageAt: string
  id: number
  unread: boolean
  rank?: number
}

export type InboxConversationsPage = {
  items: InboxConversationListItem[]
  nextCursor: InboxCursor | null
}

export type InboxConversationTarget = {
  conversationId: number
  leadId: number | null
  isPersonal: boolean
  channel: InboxChannel
  displayName: string | null
  leadName: string | null
  leadStatus: string | null
  customerWaId: string | null
}
