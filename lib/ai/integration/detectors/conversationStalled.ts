import type { LeadFact, NowCtx } from '@/lib/today/types'
import type { ExternalSignal } from '@/lib/ai/runtime/eventInterpretation'
import type { Scope } from '@/db/ai/stateManagement'
import { subjectForConversationFact, type ConversationFacts } from '@/db/ai/conversationFacts'
import type { DetectorDef } from './registry'

/**
 * Detector — `conversation.stalled`.
 *
 * A conversation that was genuinely GOING SOMEWHERE and stopped.
 *
 * IT IS NOT "OLDER THAN X", and that distinction is the whole design. Age alone
 * is already `sla.open_loop`'s business, which observes a lead answered and then
 * left with nothing scheduled. Emitting a second signal on the same evidence
 * would be two voices saying one thing. What this detector adds is the evidence
 * `sla.open_loop` cannot see: the qualifier's own record that the customer was
 * TRANSACTING — a buying signal, an objection, a product question — immediately
 * before the silence.
 *
 * CONSERVATIVE BY CONSTRUCTION. `db/ai/conversationFacts.ts` requires all four
 * of these together, and any one failing means no signal:
 *
 *   1. a classified turn recorded commercial engagement (`ENGAGEMENT_MOVES`);
 *   2. the qualifier ANSWERED it (`decision = 'send'`) — an escalated turn is
 *      already a human's open item, not a stall;
 *   3. the customer has not written since (no inbound past that turn's
 *      sequence) — if they had, the conversation is alive, or it is
 *      `conversation.unanswered`'s business;
 *   4. nothing is scheduled: no `nextFollowUpAt` and no open task.
 *
 * Plus the existing `STALE_CEILING_DAYS` recency bound, so a months-cold thread
 * is Leads-side revival and never a signal. False negatives are the intended
 * failure mode; a noisy stall detector would teach reps to ignore the engine.
 *
 * WHY `absence` AND NOT `message`. Something WAS owed here — the exchange had
 * momentum and no next step was ever taken. That is a violated expectation, so
 * the signal carries the absence marker and `sinceLastSignalAt` is the moment
 * the engaged turn was classified. `observationKeyFor` therefore discriminates
 * on `since:{engagedAt}`, which means: re-detected every minute, enqueued once;
 * and if the customer later writes again and stalls again on a NEW engaged turn,
 * that is a new observation rather than a suppressed duplicate.
 *
 * PURE. Facts arrive already read, agency-scoped and plan-gated. No I/O, no
 * clock read, no model. It executes nothing.
 */


/** The expectation whose violation this detector reports. Also the absence marker. */
export const CONVERSATION_STALLED_EXPECTATION = 'conversation.stalled'

export function detectConversationStalled(
  _facts: readonly LeadFact[],
  ctx: NowCtx,
  scope: Scope,
  conversation: ConversationFacts,
): ExternalSignal[] {
  const occurredAt = new Date(ctx.nowMs).toISOString()
  const signals: ExternalSignal[] = []

  for (const stalled of conversation.stalled) {
    const subject = subjectForConversationFact(stalled)
    signals.push({
      signalType: 'absence',
      scope,
      source: { kind: 'system', id: `detector:${CONVERSATION_STALLED_EXPECTATION}` },
      occurredAt,
      subject,
      traceRefs: [
        { type: 'conversation', id: String(stalled.conversationId) },
        { type: 'turn', id: String(stalled.triggerSequence) },
        ...(stalled.leadId != null && stalled.leadId > 0 ? [{ type: 'lead', id: String(stalled.leadId) }] : []),
      ],
      // A stall is inferred from a pattern across turns rather than read off a
      // single row, so it sits one step further from the raw observation than
      // an objection does.
      inferentialDistance: 'medium',
      absence: {
        violatedExpectation: CONVERSATION_STALLED_EXPECTATION,
        // No deadline was ever named — nobody wrote a date down, which is
        // precisely the problem. The engaged turn is the last real signal.
        sinceLastSignalAt: new Date(stalled.engagedAt).toISOString(),
      },
    })
  }

  return signals
}

export const conversationStalledDetector: DetectorDef = {
  expectation: CONVERSATION_STALLED_EXPECTATION,
  detect: detectConversationStalled,
}
