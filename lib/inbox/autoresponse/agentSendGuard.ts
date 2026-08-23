/**
 * WhatsApp Agent — the final outbound authorization boundary.
 *
 * EVERY autonomous WhatsApp message the agent sends passes through this check,
 * server-side, in the last moment before the Graph call. It is deliberately the
 * narrowest possible surface: one function, one fresh read, no cached verdict.
 *
 * A decision taken earlier in the turn is worthless here — the whole point is
 * that the world may have changed while the model was generating. So this never
 * accepts pre-loaded facts; it reads presence from the database at call time.
 *
 * Call sites (the complete set — see agentSendGuardCoverage.test.ts, which fails
 * if a new unguarded WhatsApp send appears in the agent tree):
 *   · lib/inbox/autoresponse/ireSend.ts  — qualify turns, closers, handoff,
 *     post-handoff, no-response warning/close.
 *   · lib/inbox/autoresponse/worker.ts   — acknowledge-mode first contact.
 */
import { readHumanPresence } from '@/db/conversationHumanPresence'
import { authorizeAgentSend, type AgentSendAuthorization } from './humanPresence'
import { waTrace, type WaTraceCtx } from './waTrace'

export type { AgentSendAuthorization }

/**
 * @param turnStartedAt Turn epoch — the job's `createdAt`. Database-clocked, so
 *   it is comparable with the typing marker without process clock skew, and
 *   stable across retries of the same job.
 */
export async function assertAgentSendAllowed(args: {
  conversationId: number
  turnStartedAt: string
  trace?: WaTraceCtx
}): Promise<AgentSendAuthorization> {
  let facts
  try {
    facts = await readHumanPresence(args.conversationId)
  } catch (err) {
    // FAIL CLOSED. If we cannot prove the human is absent, we do not speak for
    // them. A skipped agent reply costs one turn; a reply sent over a rep who
    // was mid-sentence costs the customer's trust in both of them.
    waTrace('AGENT_SEND_GUARD', args.trace ?? {}, {
      authorized: false,
      reason: 'presence_unavailable',
      error: (err as Error)?.message ?? 'unknown',
    })
    return { authorized: false, reason: 'presence_unavailable' }
  }

  const verdict = authorizeAgentSend(facts, args.turnStartedAt)
  waTrace('AGENT_SEND_GUARD', args.trace ?? {}, {
    authorized: verdict.authorized,
    // This repo's TS does not narrow on `.authorized`; reach the failure member
    // through the in-operator, the same way the WhatsApp send result is read.
    reason: 'reason' in verdict ? verdict.reason : null,
    aiState: facts.aiState,
    humanTypingAt: facts.humanTypingAt,
    humanTypingUntil: facts.humanTypingUntil,
    turnStartedAt: args.turnStartedAt,
    now: facts.now,
  })
  return verdict
}
