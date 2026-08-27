import type { LeadFact, NowCtx } from '@/lib/today/types'
import type { ExternalSignal } from '@/lib/ai/runtime/eventInterpretation'
import type { Scope } from '@/db/ai/stateManagement'
import { subjectForConversationFact, type ConversationFacts } from '@/db/ai/conversationFacts'
import type { DetectorDef } from './registry'

/**
 * Detector — `conversation.objection`.
 *
 * The customer pushed back, and the system already knows it. `salesIntent.ts`
 * classified the turn deterministically when the qualifier answered it, and
 * `conversation_turn_classification` recorded the verdict. Until now that
 * verdict went nowhere: the table was written and read by nothing, so "three
 * customers raised the same objection this week" stayed uncomputable even
 * though every one of them had been correctly identified at the time.
 *
 * IT DOES NOT RE-CLASSIFY. There is no regex here, no model, no second opinion
 * on what the customer meant. A detector that re-ran the classifier would be a
 * second authority on the same question, and the two would disagree the first
 * time the prompt or the pattern list changed. This module reads a persisted
 * fact and turns it into an observation. That is the entire job.
 *
 * WHY `message` AND NOT `absence`. Nothing was violated and no deadline passed —
 * the customer DID something. `message` is the canonical observation type for
 * exactly that, and `observationKeyFor` identifies an observation by its trace
 * refs rather than by a deadline. The refs are the conversation and the turn
 * sequence, which is why one classified turn can only ever produce one signal:
 * `conversation_turn_classification` carries a unique index on
 * `(conversationId, triggerSequence)`, so the input itself is already one row
 * per customer turn, however many times the job behind it retried.
 *
 * PURE. The facts arrive already read, agency-scoped and plan-gated, from
 * `db/ai/conversationFacts.ts`. No I/O, no clock read, no model.
 *
 * IT EXECUTES NOTHING. An objection is a reason to think, never a reason to
 * reply: the reachable outcomes remain `recommend` / `stay_silent`, and no
 * customer-facing action is reachable from here.
 *
 * CONTACT CONVERSATIONS ARE INCLUDED (Wave 1.1A). A leadless turn produces a
 * signal whose subject is the CONVERSATION. It is observable and measurable but
 * never investigable — the lead-only admission guard declines it before any
 * spend is reserved, and promotion to a Lead stays a human decision.
 */


/** The expectation this detector reports on. */
export const CONVERSATION_OBJECTION_EXPECTATION = 'conversation.objection'

export function detectConversationObjection(
  _facts: readonly LeadFact[],
  ctx: NowCtx,
  scope: Scope,
  conversation: ConversationFacts,
): ExternalSignal[] {
  const occurredAt = new Date(ctx.nowMs).toISOString()
  const signals: ExternalSignal[] = []

  for (const turn of conversation.objections) {
    const subject = subjectForConversationFact(turn)
    signals.push({
      signalType: 'message',
      scope,
      source: { kind: 'system', id: `detector:${CONVERSATION_OBJECTION_EXPECTATION}` },
      occurredAt,
      subject,
      /**
       * Provenance AND identity. `observationKeyFor` builds an observation's
       * discriminator from these refs, so the pair (conversation, turn) is what
       * makes one classified objection exactly one signal — re-detected every
       * minute, enqueued once.
       *
       * The turn ref is the trigger SEQUENCE, never the message body: the
       * evidence a reader needs is which turn, not what was said.
       */
      traceRefs: [
        { type: 'conversation', id: String(turn.conversationId) },
        { type: 'turn', id: String(turn.triggerSequence) },
        // The lead ref exists only when there IS a lead. A Contact's provenance
        // is the conversation and the turn, which is the whole truth about it.
        ...(turn.leadId != null && turn.leadId > 0 ? [{ type: 'lead', id: String(turn.leadId) }] : []),
      ],
      // The classification is a deterministic read of the customer's own words,
      // not a chain of reasoning away from them.
      inferentialDistance: 'low',
    })
  }

  return signals
}

export const conversationObjectionDetector: DetectorDef = {
  expectation: CONVERSATION_OBJECTION_EXPECTATION,
  detect: detectConversationObjection,
}
