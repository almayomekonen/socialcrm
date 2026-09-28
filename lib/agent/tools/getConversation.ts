import 'server-only'
import { z } from 'zod'
import { tool } from 'ai'
import { getNamedLeadById } from '@/db/briefing'
import { readerScope } from './readerScope'
import {
  AGENT_MESSAGE_LIMIT_DEFAULT,
  AGENT_MESSAGE_LIMIT_MAX,
  findLatestLeadConversation,
  listAgentConversationMessages,
} from '@/db/agentConversation'
import type { AgentScope } from '../types'
import type { Budget } from '../budget'
import { entityRef } from '../evidence'
import type { EvidenceCollector } from '../evidence'

const MIN_LIMIT = 10

/**
 * Tool 3 — the actual WhatsApp thread.
 *
 * This is what the Copilot cannot see today, and the single largest cause of
 * generic answers about a lead.
 *
 * THREE STEPS, IN ORDER:
 *   1. gate the LEAD through `getNamedLeadById` (agency + user + role + plan);
 *   2. resolve that lead's most recent thread, agency-scoped;
 *   3. read a window bounded at the DATABASE.
 *
 * The lead gate comes first because the conversation readers are agency-scoped
 * only — reaching them without it would expose any lead's thread to any user in
 * the agency.
 *
 * DELIBERATE LIMITATION — no AI-vs-human attribution. `direction` is the only
 * attribution the source data supports here; distinguishing an automatic reply
 * from a rep's own message needs `metadata->>'source'`, which no committed
 * thread reader selects. The Agent may therefore say a message went out, never
 * that a person wrote it. Telling a rep they said something the system said for
 * them is a worse failure than saying less.
 */
export function makeGetConversation(deps: { scope: AgentScope; evidence: EvidenceCollector; budget: Budget }) {
  return tool({
    description:
      'The real WhatsApp thread with a lead: the most recent messages, oldest first, each marked inbound (from the customer) or outbound (from the business). Use it whenever the answer depends on what was actually said — drafting a reply, judging intent, or explaining why a lead went quiet. Outbound messages may have been sent automatically; the data does not say who wrote them.',
    inputSchema: z.object({
      leadId: z
        .number()
        .int()
        .positive()
        .describe(
          'The lead id. Use the investigation subject when the objective names one, otherwise an id from an earlier tool result. Never invented.',
        ),
      limit: z
        .number()
        .int()
        .min(MIN_LIMIT)
        .max(AGENT_MESSAGE_LIMIT_MAX)
        .optional()
        .describe(
          `How many of the most recent messages to read. Defaults to ${AGENT_MESSAGE_LIMIT_DEFAULT}, at most ${AGENT_MESSAGE_LIMIT_MAX}.`,
        ),
    }),
    execute: async ({ leadId, limit }) => {
      const take = limit ?? AGENT_MESSAGE_LIMIT_DEFAULT
      const verdict = deps.budget.canStep('get_conversation', `${leadId}:${take}`)
      if (verdict.allowed === false) return { refused: true as const, reason: verdict.reason }

      // ── 1. Gate the lead. Never read messages for a lead the caller cannot see.
      const named = await getNamedLeadById(readerScope(deps.scope), leadId)
      if (!named) {
        deps.budget.noteResult(`not_found:${leadId}`)
        return { found: false as const, leadId }
      }

      // ── 2. Resolve the thread, agency-scoped from the server-derived scope.
      const conversation = await findLatestLeadConversation({ agencyId: deps.scope.agencyId, leadId })
      deps.evidence.add({ kind: 'lead', refId: String(leadId) })

      if (!conversation) {
        const empty = {
          found: true as const,
          leadId,
          leadName: named.name,
          conversationId: null,
          messageCount: 0,
          returned: 0,
          messages: [] as { id: number; sequence: number; direction: string; text: string; at: string }[],
        }
        deps.budget.noteResult(JSON.stringify(empty))
        return empty
      }

      // ── 3. Bounded read.
      const messages = await listAgentConversationMessages({
        agencyId: deps.scope.agencyId,
        conversationId: conversation.conversationId,
        limit: take,
      })

      for (const m of messages) deps.evidence.add({ kind: 'message', refId: String(m.id) })

      const payload = {
        found: true as const,
        leadId,
        evidenceRef: entityRef('lead', leadId),
        leadName: named.name,
        conversationId: conversation.conversationId,
        /** True size of the thread, so a bounded window never reads as the whole story. */
        messageCount: conversation.messageCount,
        returned: messages.length,
        messages: messages.map((m) => ({
          // The id the evidence ledger records. Without it the model was shown
          // `sequence` and asked to cite `id` — every message claim was dropped
          // (inv_mt8mev3v_x24g97: 19 messages read, 3 claims, 3 dropped).
          id: m.id,
          /** Cite THIS string for a message. */
          evidenceRef: entityRef('message', m.id),
          sequence: m.sequence,
          direction: m.direction,
          text: m.text,
          at: m.timestamp,
        })),
      }

      deps.budget.noteResult(JSON.stringify(payload).slice(0, 2000))
      return payload
    },
  })
}
