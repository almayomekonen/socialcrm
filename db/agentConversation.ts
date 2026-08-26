import { db } from '@/config/db'
import { messageTimelineOrderSql } from '@/lib/inbox/messageTimeline'

/**
 * Agent conversation reads — the bounded, agency-scoped thread reader.
 *
 * WHY A NEW READER. The existing thread readers are unsuitable for Agent use:
 *
 *   · `listLeadWhatsappMessages` has no LIMIT — it returns a lead's entire
 *     history across every conversation, and bounding it in JavaScript would
 *     still fetch thousands of rows. It also derives its own agency from the
 *     session rather than accepting the caller's resolved scope, and its column
 *     list carries no `sequence`.
 *   · `listMessagesForAnalysis` is bounded and agency-scoped, but keyed by
 *     conversationId with no way to reach one from a leadId.
 *
 * So this module owns the two reads an Agent tool needs, both bounded at the
 * DATABASE and both taking `agencyId` explicitly — supplied from the
 * server-resolved AgentScope, never from a model argument.
 *
 * Builders are exported separately from executors so they are `.toSQL()`-
 * testable under the current harness, the convention `db/today/facts.ts` set.
 *
 * DELIBERATE OMISSION — no AI-vs-human discriminator. Distinguishing an
 * `auto_response` outbound from a rep's own message requires
 * `metadata->>'source'`, which no committed thread reader selects. Rather than
 * infer it, this reader returns `direction` only: the Agent may say a message
 * went out, never that a person wrote it. Adding the discriminator later is
 * additive (one more column here); claiming it now would let the Agent tell a
 * rep they said something the system said for them.
 */

/** Default window. Matches `listMessagesForAnalysis`, the existing bounded reader. */
export const AGENT_MESSAGE_LIMIT_DEFAULT = 30

/** Ceiling. Matches `getConversationOutboundStatuses`, the existing capped reader. */
export const AGENT_MESSAGE_LIMIT_MAX = 60

export type AgentConversationRef = {
  conversationId: number
  /** True total in the thread, so a bounded window never reads as the whole story. */
  messageCount: number
}

export type AgentMessage = {
  /** Stable row id — the evidence ref the Agent cites. */
  id: number
  /** Stable in-thread ordering. */
  sequence: number
  direction: string
  text: string
  timestamp: string
}

function clampLimit(limit?: number): number {
  const n = Number(limit)
  if (!Number.isFinite(n)) return AGENT_MESSAGE_LIMIT_DEFAULT
  return Math.min(Math.max(Math.floor(n), 1), AGENT_MESSAGE_LIMIT_MAX)
}

function toIso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : v ? String(v) : ''
}

/**
 * The lead's most recent WhatsApp conversation. Agency-scoped.
 *
 * A lead can have more than one thread (a customer who wrote from a second
 * number); the Agent investigates the live one, so this picks the most recently
 * active and reports its true size.
 */
export function latestLeadConversationQuery(args: { agencyId: number; leadId: number }) {
  return db('inbox_conversations')
    .where({ agencyId: args.agencyId, leadId: args.leadId, channel: 'whatsapp' })
    .orderByRaw('"lastMessageAt" DESC NULLS LAST')
    .orderBy('id', 'desc')
    .first('id', 'messageCount')
}

export async function findLatestLeadConversation(args: {
  agencyId: number
  leadId: number
}): Promise<AgentConversationRef | null> {
  if (!Number.isFinite(args.agencyId) || args.agencyId <= 0) return null
  if (!Number.isFinite(args.leadId) || args.leadId <= 0) return null

  const row = await latestLeadConversationQuery(args)
  if (!row) return null
  return {
    conversationId: Number(row.id),
    messageCount: Number(row.messageCount ?? 0),
  }
}

/**
 * The most recent `limit` messages of one conversation, oldest-first.
 *
 * Bounded at the database: `ORDER BY sequence DESC LIMIT n`, then reversed in
 * memory so the Agent reads the window in conversational order while the newest
 * message is always included. This is the same shape `listMessagesForAnalysis`
 * uses, with `agencyId` in the WHERE clause so a conversation id from another
 * tenant returns nothing rather than another agency's thread.
 */
export function agentConversationMessagesQuery(args: {
  agencyId: number
  conversationId: number
  limit?: number
}) {
  return db('inbox_messages')
    .where({ agencyId: args.agencyId, conversationId: args.conversationId })
    // Newest-first by OCCURRENCE (the caller reverses into reading order).
    // `sequence` is still selected and still means order-of-arrival; it is just
    // no longer mistaken for chronology.
    .orderByRaw(messageTimelineOrderSql('inbox_messages', 'desc'))
    .limit(clampLimit(args.limit))
    .select('id', 'sequence', 'direction', 'text', 'channelTimestamp', 'createdAt')
}

export async function listAgentConversationMessages(args: {
  agencyId: number
  conversationId: number
  limit?: number
}): Promise<AgentMessage[]> {
  if (!Number.isFinite(args.agencyId) || args.agencyId <= 0) return []
  if (!Number.isFinite(args.conversationId) || args.conversationId <= 0) return []

  const rows = await agentConversationMessagesQuery(args)

  return rows
    .map(
      (r: Record<string, unknown>): AgentMessage => ({
        id: Number(r.id),
        sequence: Number(r.sequence),
        direction: String(r.direction),
        text: String(r.text ?? ''),
        timestamp: toIso(r.channelTimestamp ?? r.createdAt),
      }),
    )
    .reverse()
}
