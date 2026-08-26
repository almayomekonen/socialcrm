import { classifyLead } from '@/lib/today/classify'
import type { LeadFact, NowCtx } from '@/lib/today/types'
import type { ExternalSignal } from '@/lib/ai/runtime/eventInterpretation'
import type { Scope } from '@/db/ai/stateManagement'
import type { DetectorDef } from './registry'

/**
 * Detector — `conversation.unanswered`.
 *
 * The first detector that observes CONVERSATION activity rather than lead
 * state. Until now the signal engine could see a missed follow-up date and an
 * aged status, but not the single most consequential fact in a WhatsApp-first
 * CRM: a customer wrote, and no human has answered.
 *
 * IT INVENTS NO RESPONSE WINDOW. `lib/today/classify.ts` already owns that
 * semantic — `isWaitingForReply(lastInboundAt, lastHumanOutboundAt, nowMs)` —
 * and `WAITING_REPLY` is the highest-priority state in `STATE_PRIORITY`. This
 * detector calls `classifyLead` exactly as its two siblings do rather than
 * re-deriving the rule in SQL or a second predicate. Three properties follow
 * for free, none of which a hand-rolled comparison would have:
 *
 *   · AN EXISTING OUTBOUND SUPPRESSES IT. A later human reply makes
 *     `isWaitingForReply` false, so the state is not WAITING_REPLY and nothing
 *     is emitted. There is no separate "has an outbound" check to get wrong.
 *   · TERMINAL LEADS ARE EXCLUDED, by `isTerminal` running first in
 *     `classifyLead` and again in `db/ai/leadFacts.ts`'s SQL.
 *   · PRIORITY IS RESPECTED. Because WAITING_REPLY outranks FOLLOWUP_OVERDUE,
 *     a lead who is both produces this signal and not the overdue one — the
 *     owed action really is the reply.
 *
 * AI REPLIES DO NOT SUPPRESS IT, deliberately. `db/ai/leadFacts.ts` computes
 * `lastHumanOutboundAt` with `metadata->>'source' IS DISTINCT FROM
 * 'auto_response'` (Today Amendment C-2), so an autonomous acknowledgement
 * leaves the conversation still owed a human answer. That is the same judgement
 * the Today brief already makes, and reversing it here would let the agent
 * silence the very signal that says a person is waiting.
 *
 * SYSTEM MESSAGES cannot reach this path: the aggregation reads
 * `inbox_messages.direction`, and a system row is neither an inbound customer
 * message nor a human outbound.
 *
 * NO DEADLINE, SO NO `expectedBy`. Nothing promised a reply by a named instant;
 * what happened is that the customer's last message has gone unanswered. The
 * absence therefore carries `sinceLastSignalAt` only, and `observationKeyFor`
 * discriminates on `since:{lastInboundAt}` — so re-detection every minute is one
 * job, and a NEW customer message is genuinely new work.
 *
 * PURE. No I/O, no clock read, no model. `nowMs` arrives in `ctx`.
 *
 * IT EXECUTES NOTHING. The output is an observation. Whether it earns cognition
 * is the scheduler's call, whether it earns surfacing is `valueBar`'s, and the
 * only reachable outcomes remain `recommend` / `stay_silent`.
 */

/** The expectation whose violation this detector reports. Also the absence marker. */
export const CONVERSATION_UNANSWERED_EXPECTATION = 'conversation.unanswered'

export function detectConversationUnanswered(
  facts: readonly LeadFact[],
  ctx: NowCtx,
  scope: Scope,
): ExternalSignal[] {
  const occurredAt = new Date(ctx.nowMs).toISOString()
  const signals: ExternalSignal[] = []

  for (const fact of facts) {
    if (classifyLead(fact, ctx) !== 'WAITING_REPLY') continue
    // Unreachable through classifyLead (the state requires an inbound), and
    // asserted anyway: without the moment the customer wrote, the observation
    // has no identity and `observationKeyFor` would refuse it.
    if (fact.lastInboundAt == null) continue

    const subjectId = String(fact.id)
    signals.push({
      signalType: 'absence',
      scope,
      source: { kind: 'system', id: `detector:${CONVERSATION_UNANSWERED_EXPECTATION}` },
      occurredAt,
      subject: { subjectType: 'lead', subjectId },
      // Provenance walks back to the lead. No message body, no customer
      // identity, no phone number — a subject id and a trace ref are the whole
      // payload, exactly as the sibling detectors keep it.
      traceRefs: [{ type: 'lead', id: subjectId }],
      inferentialDistance: 'low',
      absence: {
        violatedExpectation: CONVERSATION_UNANSWERED_EXPECTATION,
        sinceLastSignalAt: new Date(fact.lastInboundAt).toISOString(),
      },
    })
  }

  return signals
}

export const conversationUnansweredDetector: DetectorDef = {
  expectation: CONVERSATION_UNANSWERED_EXPECTATION,
  detect: detectConversationUnanswered,
}
