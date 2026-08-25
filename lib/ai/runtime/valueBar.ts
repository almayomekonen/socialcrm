import type { ReasonedQuestion } from './reasoning'
import type { SubjectRef } from '@/db/ai/stateManagement'
import type { ReversibilityClass } from './toolActionTypes'

/**
 * Phase 4.1 — the Value / Taste Bar. Cognitive Architecture J **Gate 2**, realized.
 *
 * Gate 1 (reversibility) asks *may* this be done. Gate 2 asks something the
 * ratified cognition is emphatic about and the Wave-1 gate deferred: **having
 * something true and sufficiently certain is not grounds to say it.** This module
 * is the deterministic answer to one question and one only:
 *
 *     "Has this grounded conclusion earned the right to be surfaced?"
 *
 * It never asks "should the model notify the user". The model may discover and
 * explain a conclusion; it may never decide the conclusion deserves attention.
 * That is why nothing here reads a model output, a confidence the model wrote, or
 * any field a prompt could influence — see {@link ValueContext}, every member of
 * which is either produced by a deterministic domain authority or derived from the
 * Reasoning Runtime's own contract.
 *
 * FAIL-CLOSED, ABSOLUTELY. Only an explicit all-pass produces `surface: true`.
 * A malformed context, an unexpected value, or a thrown error resolves to a hard
 * failure of every criterion. There is no path through this module that surfaces
 * something by default, and no argument a caller can pass that skips a criterion.
 *
 * NO DOMAIN VOCABULARY LIVES HERE. The runtime imports only its own siblings and
 * `@/db/ai/*` (verified), and Phase 4.1 does not change that: `state` is an opaque
 * string, `costOfWaiting` is arithmetic over business-day bounds the caller
 * computed, and notification ownership arrives as a resolved boolean. The typed,
 * compiler-enforced `Record<ExpectationKind, NotificationType | null>` lives at the
 * integration boundary (lib/ai/integration/notificationOwnership.ts), where both
 * of those types are actually in scope. Putting it here would invert the layering
 * into a cycle: integration → runtime → integration.
 *
 * Implements: Cognitive Architecture J (Gate 2), M; Constitution XI.4, XI.5, XIII;
 * AI Runtime Architecture §3.9 (the value and taste checkpoint before spending any
 * operator attention); ai-safety-boundaries.md §9.1 (DA-001) conditions 1–13.
 */

// ─────────────────────────────── criteria ───────────────────────────────────

/**
 * The seven deterministic criteria. Every one must pass (or be legitimately
 * waived by vigilance, below) before a conclusion may spend operator attention.
 */
export const VALUE_CRITERIA = [
  /** C1 — the subject is in a qualifying business state (owed work exists). */
  'qualifying_state',
  /** C2 — the conclusion is about something a rep can act on. */
  'subject_actionable',
  /** C3 — the moment the expectation named has actually passed. */
  'cost_of_waiting',
  /** C4 — no deterministic notification type already owns this fact (DA-001 §13). */
  'notification_novelty',
  /** C5 — every surfaced conclusion rests on at least one real trace. */
  'evidence_sufficiency',
  /** C6 — the conclusion is anchored to the subject being investigated. */
  'subject_anchoring',
  /** C7 — the effect is the reversible surfacing the gate classified. */
  'safe_effect',
] as const

export type ValueCriterion = (typeof VALUE_CRITERIA)[number]

/**
 * The ONLY criteria the constitutional vigilance override may waive.
 *
 * Constitution XI.4 makes surfacing a genuinely dropped critical item a duty and
 * says escalating one is never "noise"; Cognitive Architecture J disciplines that
 * override against alarmism — "only genuinely critical, tractable items qualify."
 *
 * So the override relaxes the two criteria that describe *how well established*
 * the item is (has the deadline passed yet; how much evidence stands behind it)
 * and NONE of the five that describe whether it is a real, actionable, novel,
 * anchored, safe thing to say. In particular it can never waive
 * `notification_novelty`: a duplicate alert about a dropped ball is still a
 * duplicate, and brand-principles §6.3 (one owner per live signal) admits no
 * vigilance exception.
 */
export const VIGILANCE_WAIVABLE: ReadonlySet<ValueCriterion> = new Set<ValueCriterion>([
  'cost_of_waiting',
  'evidence_sufficiency',
])

/**
 * Declared expectation classes that may invoke the override. A closed union, set
 * at the integration boundary from the originating expectation — never computed,
 * never inferred, and never reachable from a model output.
 */
export type VigilanceClass = 'dropped_commitment' | 'passed_deadline' | 'cadence_break'

// ─────────────────────────────── inputs ─────────────────────────────────────

/** Business-day bounds, computed once by the caller. The bar never reads a clock. */
export interface ValueClock {
  nowMs: number
  dayStart: number
  dayEnd: number
}

/**
 * The deterministic facts the bar decides over.
 *
 * EVERY member is server-derived. None is model-writable, and there is
 * deliberately no urgency, severity, priority, importance or delivery field —
 * not as a policy but as an absence: there is no field to put them in
 * (DA-001 §9.1 condition 8).
 */
export interface ValueContext {
  /**
   * The subject's qualifying business state from the State Engine
   * (`lib/today/classify.ts`), or null when nothing is owed. Opaque here on
   * purpose: `classifyLead` is the single authority and already returns null for
   * terminal leads, so terminality needs no separate field.
   */
  state: string | null
  /** True when a deterministic notification type already owns this expectation. */
  ownedByDeterministicNotification: boolean
  /** The moment the violated expectation named (epoch ms), or null. */
  expectedByMs: number | null
  /** Business-day bounds from the repository's sole time authority. */
  clock: ValueClock
  /** Declared vigilance class for the originating expectation, or null. */
  vigilance: VigilanceClass | null
}

/** Everything the bar evaluates. Assembled by the gate, never by a caller. */
export interface ValueInput {
  subject: SubjectRef
  /** The settled conclusions the gate would surface. */
  settled: readonly ReasonedQuestion[]
  /** Distinct underlying traces across the whole understanding. */
  observationCount: number
  /** Gate 1's classification. The bar never re-classifies safety. */
  reversibility: ReversibilityClass
  context: ValueContext
}

// ─────────────────────────────── verdict ────────────────────────────────────

export type ValueVerdict =
  | { surface: true; failed: readonly []; waived: readonly ValueCriterion[] }
  | { surface: false; failed: readonly ValueCriterion[]; waived: readonly ValueCriterion[] }

/** Every criterion failed. The shape a malformed or throwing evaluation collapses to. */
function hardFail(): ValueVerdict {
  return { surface: false, failed: [...VALUE_CRITERIA], waived: [] }
}

// ─────────────────────────────── criteria ───────────────────────────────────

/** C1 — a qualifying state IS the owed work. `null` covers terminal and idle alike. */
function qualifyingState(c: ValueContext): boolean {
  return typeof c.state === 'string' && c.state.length > 0
}

/**
 * C2 — subject-scale actionability. A relationship has one deep-linkable owed
 * action; a portfolio aggregate has none, so a portfolio conclusion can never be
 * surfaced as an unprompted interruption in this phase.
 */
function subjectActionable(subject: SubjectRef): boolean {
  return subject.subjectType === 'lead'
}

/** C3 — the named moment has passed, in business-day terms. Pure arithmetic. */
function costOfWaiting(c: ValueContext): boolean {
  const { expectedByMs, clock } = c
  if (typeof expectedByMs !== 'number' || !Number.isFinite(expectedByMs)) return false
  if (!Number.isFinite(clock?.dayStart)) return false
  return expectedByMs < clock.dayStart
}

/** C4 — DA-001 condition 13, structural. Ownership is resolved, never guessed. */
function notificationNovelty(c: ValueContext): boolean {
  return c.ownedByDeterministicNotification === false
}

/**
 * C5 — every surfaced conclusion rests on at least one real trace.
 *
 * Strictly stronger than the provenance seam, which accepts an honest
 * absence-derived conclusion carrying no traces at all. That is the right bar for
 * *honesty*; it is not the right bar for *interrupting someone*. No threshold is
 * invented here — the rule is "≥ 1 trace", read straight off the contract.
 */
function evidenceSufficiency(input: ValueInput): boolean {
  if (!Number.isFinite(input.observationCount) || input.observationCount <= 0) return false
  if (input.settled.length === 0) return false
  return input.settled.every((q) => (q.provenance?.traceRefs?.length ?? 0) > 0)
}

/** C6 — some surfaced conclusion walks back to the subject itself. */
function subjectAnchoring(input: ValueInput): boolean {
  const { subjectType, subjectId } = input.subject
  return input.settled.some((q) =>
    (q.provenance?.traceRefs ?? []).some((r) => r?.type === subjectType && String(r?.id) === String(subjectId)),
  )
}

/** C7 — Gate 1 is the sole safety authority; the bar only refuses to override it. */
function safeEffect(input: ValueInput): boolean {
  return input.reversibility === 'reversible'
}

// ─────────────────────────────── evaluation ─────────────────────────────────

/**
 * Evaluate the bar. Pure, total, and never throws: any unexpected shape or error
 * collapses to a hard failure of every criterion, so a defect can only ever cause
 * silence.
 */
export function evaluateValue(input: ValueInput): ValueVerdict {
  try {
    if (!input || !input.subject || !Array.isArray(input.settled) || !input.context) return hardFail()

    const c = input.context
    const results: Record<ValueCriterion, boolean> = {
      qualifying_state: qualifyingState(c),
      subject_actionable: subjectActionable(input.subject),
      cost_of_waiting: costOfWaiting(c),
      notification_novelty: notificationNovelty(c),
      evidence_sufficiency: evidenceSufficiency(input),
      subject_anchoring: subjectAnchoring(input),
      safe_effect: safeEffect(input),
    }

    const failed = VALUE_CRITERIA.filter((k) => results[k] !== true)
    if (failed.length === 0) return { surface: true, failed: [], waived: [] }

    // The vigilance override. Available only to a declared expectation class, and
    // only over the two waivable criteria — every other failure stands.
    const eligible = c.vigilance === 'dropped_commitment' || c.vigilance === 'passed_deadline' || c.vigilance === 'cadence_break'
    if (!eligible) return { surface: false, failed, waived: [] }

    const blocking = failed.filter((k) => !VIGILANCE_WAIVABLE.has(k))
    if (blocking.length > 0) return { surface: false, failed: blocking, waived: [] }

    return { surface: true, failed: [], waived: failed }
  } catch {
    // A throwing bar must never become a surfacing bar.
    return hardFail()
  }
}
