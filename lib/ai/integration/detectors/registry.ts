import { followupOverdueDetector } from './followupOverdue'
import { openLoopSlaDetector } from './openLoopSla'
import { conversationUnansweredDetector } from './conversationUnanswered'
import { conversationObjectionDetector } from './conversationObjection'
import { conversationStalledDetector } from './conversationStalled'
import type { ConversationFacts } from '@/db/ai/conversationFacts'
import type { LeadFact, NowCtx } from '@/lib/today/types'
import type { ExternalSignal } from '@/lib/ai/runtime/eventInterpretation'
import type { Scope } from '@/db/ai/stateManagement'

/**
 * The detector registry — one declarative entry per expectation.
 *
 * Follows the pattern `lib/notifications/registry.ts` already proves: adding a
 * detector means adding ONE entry here and one pure module beside it. It never
 * means editing the sweep driver, which reads `detect` off the entry and knows
 * nothing about any specific expectation.
 *
 * Completeness is enforced by the COMPILER, not by a test: `DETECTORS` is typed
 * `Record<ExpectationKind, DetectorDef>`, so a new member of the union without
 * an entry fails `tsc`.
 *
 * WHAT AN ENTRY MAY NOT CARRY. No severity floor, no `needsInvestigation`, no
 * priority and no admission hint. Whether a subject earns cognition, and at
 * which tier, is `RuntimeScheduler.admit()`'s decision (§3.6); a floor declared
 * here would be the comparative ranking that section forbids the scheduler
 * itself from performing. An entry describes an EXPECTATION and how to observe
 * its violation. Nothing else.
 */

/**
 * The closed set of expectations the sweep can observe.
 *
 * `conversation.unanswered` is the first CONVERSATION-sourced expectation: the
 * two originals read lead state, so the busiest surface in the product produced
 * no signals at all. It is a plain union member because
 * `signal_jobs.expectation` is unconstrained `text` — new expectations cost no
 * migration, which is precisely why the vocabulary lives here and not in the
 * database.
 */
export type ExpectationKind =
  | 'followup.overdue'
  | 'sla.open_loop'
  | 'conversation.unanswered'
  | 'conversation.objection'
  | 'conversation.stalled'

export interface DetectorDef {
  /** The expectation this detector reports on; carried as the absence marker. */
  readonly expectation: ExpectationKind
  /**
   * Pure: facts in, canonical ExternalSignals out. No I/O, no clock read, no
   * model, no ordering guarantee beyond the input's.
   *
   * `conversation` carries what has been SAID — the qualifier's own persisted
   * classifications — for the detectors that observe conversation activity
   * rather than lead state. It is a fourth PARAMETER rather than a widened
   * `LeadFact` on purpose: `LeadFact` is the Today brief's shape, shared with
   * the UI, and conversation classifications have no business in it. Detectors
   * that do not need it simply declare three parameters, which is why adding it
   * left both original detectors untouched.
   */
  readonly detect: (
    facts: readonly LeadFact[],
    ctx: NowCtx,
    scope: Scope,
    conversation: ConversationFacts,
  ) => ExternalSignal[]
}

export const DETECTORS: Record<ExpectationKind, DetectorDef> = {
  'followup.overdue': followupOverdueDetector,
  'sla.open_loop': openLoopSlaDetector,
  'conversation.unanswered': conversationUnansweredDetector,
  'conversation.objection': conversationObjectionDetector,
  'conversation.stalled': conversationStalledDetector,
}

/** Stable iteration order for the sweep driver. */
export const DETECTOR_LIST: readonly DetectorDef[] = Object.values(DETECTORS)
