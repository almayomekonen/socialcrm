import { followupOverdueDetector } from './followupOverdue'
import { openLoopSlaDetector } from './openLoopSla'
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

/** The closed set of expectations Phase 1 can observe. */
export type ExpectationKind = 'followup.overdue' | 'sla.open_loop'

export interface DetectorDef {
  /** The expectation this detector reports on; carried as the absence marker. */
  readonly expectation: ExpectationKind
  /**
   * Pure: facts in, canonical ExternalSignals out. No I/O, no clock read, no
   * model, no ordering guarantee beyond the input's.
   */
  readonly detect: (facts: readonly LeadFact[], ctx: NowCtx, scope: Scope) => ExternalSignal[]
}

export const DETECTORS: Record<ExpectationKind, DetectorDef> = {
  'followup.overdue': followupOverdueDetector,
  'sla.open_loop': openLoopSlaDetector,
}

/** Stable iteration order for the sweep driver. */
export const DETECTOR_LIST: readonly DetectorDef[] = Object.values(DETECTORS)
