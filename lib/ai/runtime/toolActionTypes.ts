import type { ReasoningLens } from './reasoning'
import type { Scope, SubjectRef, TraceRef, InferentialDistance } from '@/db/ai/stateManagement'
import type { ValueContext, ValueVerdict } from './valueBar'

/**
 * M6 Tool / Action Runtime — the DECLARATIONS.
 *
 * Extracted from `toolAction.ts` in Phase 4.1 under architecture-rules.md §1: adding
 * the Value Bar seam pushed that file past the 350-line hard limit, and the rule
 * requires an extraction agreed in the same change rather than a file that keeps
 * growing. The split is by kind, not by convenience — every declaration the gate's
 * contract is made of lives here; every decision the gate makes lives there.
 *
 * Two properties this buys beyond line count:
 *   · `valueBar.ts` can name `ReversibilityClass` without importing the module that
 *     imports it, so there is no import cycle between the seam and its policy —
 *     not even a type-only one that a later refactor could make real.
 *   · The constitutional terminal model is readable in one screen, undiluted by
 *     the walk that enforces it.
 *
 * `toolAction.ts` re-exports this module in full, so every existing import path
 * (`from '@/lib/ai/runtime/toolAction'`) keeps working unchanged. Nothing that
 * consumed these types before Phase 4.1 has to know the split happened.
 */

// ─────────────────────────────── terminal model ─────────────────────────────

/** The four permanent constitutional terminal outputs (Cog J, M; Constitution XI). */
export type TerminalOutcome = 'act' | 'recommend' | 'ask' | 'stay_silent'

/** The only terminal outcomes a Wave-1 gate may emit. Act/Ask are never returned. */
export const WAVE1_REACHABLE_OUTCOMES: ReadonlySet<TerminalOutcome> = new Set(['recommend', 'stay_silent'])

/** The ordered safety seams every candidate must pass (the safety spine, Part 7). */
export type BoundaryCheck = 'scope' | 'provenance' | 'groundedness' | 'reversibility' | 'earned_autonomy' | 'value'

/** Reversibility at the point of execution — the gate is the sole authority. */
export type ReversibilityClass = 'reversible' | 'irreversible'

/** Why the gate stayed silent (a constitutional outcome, not a rejection). */
export type SilenceReason = 'no_grounded_understanding' | 'no_settled_conclusion' | 'below_value_bar'

/** Earned-autonomy stub (M0 §1.7). Fixed at `none` for all of Wave 1. */
export interface EarnedAutonomy {
  level: 'none'
}

export const WAVE1_AUTONOMY: EarnedAutonomy = Object.freeze({ level: 'none' })

/** An internal boundary rejection. Recorded for traceability; never emitted. */
export interface BoundaryRejection {
  boundary: BoundaryCheck
  reason: string
}

/** One step in the ordered decision trace — every candidate carries the full walk. */
export interface DecisionTraceStep {
  boundary: BoundaryCheck
  passed: boolean
  detail: string
}

// ─────────────────────────────── recommendation ─────────────────────────────

/** The Wave-1 candidate effect. Surfacing a recommendation is fully reversible. */
export type CandidateEffect = 'surface_recommendation'

/** One link of the exact reasoning chain that produced a recommendation. */
export interface ReasoningChainLink {
  key: string
  leading: { label: string; credence: number; groundedness: number }
  evidenceForCount: number
  evidenceAgainstCount: number
  inferentialDistance: InferentialDistance
  isAbsenceDerived: boolean
  /** The traces this conclusion walks back to (empty only for an absence-derived link). */
  traceRefs: TraceRef[]
}

/**
 * A recommendation awaiting the human hand. It is fully explainable and fully
 * traceable: it carries the exact reasoning chain and the merged provenance that
 * produced it (Constitution I, XI.1, XI.8).
 */
export interface Recommendation {
  effect: CandidateEffect
  scope: Scope
  subject: SubjectRef
  asOf: string
  lens: ReasoningLens
  reversibility: ReversibilityClass
  autonomy: EarnedAutonomy
  provenance: {
    /** Every trace the recommendation rests on, merged and de-duplicated. */
    traceRefs: TraceRef[]
    anyHighInference: boolean
    anyAbsenceDerived: boolean
  }
  reasoningChain: ReasoningChainLink[]
  rationale: string
}

// ─────────────────────────────── gate decision ──────────────────────────────

export interface GateDecisionBase {
  scope: Scope
  subject: SubjectRef
  decidedAt: string
  trace: DecisionTraceStep[]
  /** The Value Bar verdict. Present only in surface mode; absent under inspect. */
  value?: ValueVerdict
}

/** The complete result of one gate evaluation. */
export type GateDecision =
  | (GateDecisionBase & { emitted: true; outcome: 'recommend'; recommendation: Recommendation })
  | (GateDecisionBase & { emitted: true; outcome: 'stay_silent'; silence: { reason: SilenceReason } })
  | (GateDecisionBase & { emitted: false; outcome: null; rejection: BoundaryRejection })

/**
 * What the caller intends to do with the decision — and therefore whether Gate 2
 * applies.
 *
 * `inspect` is a READ of the standing terminal decision, for prompt context or an
 * audit sink. It surfaces nothing to anyone, so DA-001 §9.1 does not govern it and
 * the Value Bar is not applied. This is the default, which is what keeps every
 * pre-Phase-4.1 caller byte-identical.
 *
 * `surface` declares an intent to spend operator attention. It REQUIRES the
 * deterministic {@link ValueContext} — the same object that selects the mode also
 * carries the bar's inputs, so entering the surfacing path without submitting to
 * the bar is not merely forbidden, it is unrepresentable. That is the structural
 * form of "no caller may omit the Value Bar accidentally".
 */
export type GateIntent = { mode: 'inspect' } | { mode: 'surface'; value: ValueContext }

export interface GateContext {
  /** The operator/agency scope the gate is enforcing for. */
  scope: Scope
  /** Earned autonomy for this operator/action-class. Defaults to the Wave-1 none. */
  autonomy?: EarnedAutonomy
  /** Injectable clock for deterministic decision stamping. */
  now?: Date
  /** Absent ⇒ inspect ⇒ no Value Bar, and behaviour identical to before Phase 4.1. */
  intent?: GateIntent
}
