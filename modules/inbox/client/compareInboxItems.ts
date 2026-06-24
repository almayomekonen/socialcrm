import type { InboxConversationListItem, InboxSort } from '@/modules/inbox/types'

// Client-side mirror of the server's RANK_SQL ordering (queries.ts), so the live
// list stays correctly ordered for EVERY sort after a delta merge — not just the
// default 'latest' view, and without depending on the router.refresh reconcile.
const TEMP_RANK: Record<string, number> = { hot: 3, warm: 2, cold: 1 }
const INTENT_RANK: Record<string, number> = { signup: 7, pricing: 6, demo: 5, support: 4, followup: 3, information: 2, other: 1 }
const ACTION_RANK: Record<string, number> = { close_lead: 7, send_quote: 6, schedule_demo: 5, answer_question: 4, escalate_support: 3, follow_up: 2, none: 1 }

const rank = (table: Record<string, number>, key: string | null): number => (key ? (table[key] ?? 0) : 0)
const ts = (i: InboxConversationListItem): string => i.lastMessageAt ?? ''

// ISO timestamps compare lexically = chronologically; ties broken by id (newest first).
const latestDesc = (a: InboxConversationListItem, b: InboxConversationListItem): number =>
  ts(b).localeCompare(ts(a)) || b.conversationId - a.conversationId

export function compareInboxItems(sort: InboxSort): (a: InboxConversationListItem, b: InboxConversationListItem) => number {
  switch (sort) {
    case 'oldest':
      return (a, b) => ts(a).localeCompare(ts(b)) || a.conversationId - b.conversationId
    case 'unread':
      return (a, b) => Number(b.unread) - Number(a.unread) || latestDesc(a, b)
    case 'temperature':
      return (a, b) => rank(TEMP_RANK, b.temperature) - rank(TEMP_RANK, a.temperature) || latestDesc(a, b)
    case 'intent':
      return (a, b) => rank(INTENT_RANK, b.intent) - rank(INTENT_RANK, a.intent) || latestDesc(a, b)
    case 'action':
      return (a, b) => rank(ACTION_RANK, b.suggestedAction) - rank(ACTION_RANK, a.suggestedAction) || latestDesc(a, b)
    case 'latest':
    default:
      return latestDesc
  }
}
