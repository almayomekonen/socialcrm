import type { ReasonedUnderstanding, ReasonedQuestion, ReasoningLens } from './reasoning'
import { evaluateValue } from './valueBar'
import type { Scope, SubjectRef, TraceRef, InferentialDistance } from '@/db/ai/stateManagement'

/**
 * M6 — Tool / Action Runtime (Wave 1). The mind's single gated effector boundary.
 *
 * It realizes the action gate and its four constitutional terminal outputs
 * (Cognitive Architecture J, M; AI Runtime Architecture §3.9). It receives one
 * {@link ReasonedUnderstanding} from the Reasoning Runtime (M5) and decides which
 * terminal output — if any — the mind takes, by passing the candidate through the
 * safety spine as an ordered set of seams that sit *on* the path, never beside it:
 *
 *   Scope → Provenance → Groundedness → Reversibility → Earned-Autonomy
 *
 * The four constitutional terminal outcomes are permanent and never change:
 *   • Act        — disabled in Wave 1 (structurally unreachable: autonomy is none,
 *                  there is no effector, and no reversible auto-crossing is built).
 *   • Recommend  — reachable: surface a settled, grounded understanding for the
 *                  human to authorize/act on. The human owns the irreversible doing.
 *   • Ask        — deferred in Wave 1 (never produced).
 *   • Stay Silent— reachable: an honest "nothing true and useful to say".
 *
 * **Reject is not a constitutional outcome.** When a safety seam fails, the
 * candidate is rejected *internally* and nothing is emitted (`emitted: false`);
 * the rejection is recorded with its reason for traceability, but it never becomes
 * a public terminal output. This is the difference between a boundary suppression
 * (Reject) and a deliberate judgment that there is nothing worth saying (Stay
 * Silent) — both reach the operator as silence, but only Stay Silent is a
 * constitutional outcome.
 *
 * This runtime is read-only and side-effect-free: it reads M5's output, writes no
 * belief, chooses no action mechanism, and — being Wave 1 — crosses no irreversible
 * line and executes nothing. It is the **sole authority** on reversibility at the
 * boundary; the irreversible line is permanent and cannot be relocated here
 * (Constitution VII.3, XI.2).
 *
 * Deferred by Wave 1 scope (documented, not built here): the dropped-ball vigilance
 * path (a minimal Action-descriptor from the Scheduler that fires without any
 * reasoning present, M0 §1.6); graded earned autonomy (M0 §1.7 stays fixed at
 * none); the effector that would carry out a reversible Act; value/cost economics;
 * and emitting the Outcome contract back for learning (Metacognition, Wave 2).
 */

import {
  WAVE1_AUTONOMY,
  WAVE1_REACHABLE_OUTCOMES,
  type BoundaryCheck,
  type CandidateEffect,
  type DecisionTraceStep,
  type GateContext,
  type GateDecision,
  type GateDecisionBase,
  type GateIntent,
  type ReasoningChainLink,
  type Recommendation,
  type ReversibilityClass,
  type SilenceReason,
  type TerminalOutcome,
} from './toolActionTypes'

/** Every declaration stays importable from this module — the Phase 4.1 extraction is invisible to callers. */
export * from './toolActionTypes'

const INSPECT: GateIntent = Object.freeze({ mode: 'inspect' })

// ─────────────────────────────── pure helpers ───────────────────────────────

function mergeTraceRefs(refs: TraceRef[]): TraceRef[] {
  const seen = new Set<string>()
  const out: TraceRef[] = []
  for (const r of refs) {
    const id = `${r.type}:${r.id}`
    if (!seen.has(id)) {
      seen.add(id)
      out.push(r)
    }
  }
  return out
}

/** A conclusion is walkable iff it rests on ≥1 trace or is an honest absence. */
function hasWalkableProvenance(q: ReasonedQuestion): boolean {
  return q.provenance.traceRefs.length > 0 || q.provenance.isAbsenceDerived
}

/**
 * Reversibility classification — the gate is the SOLE authority (Constitution
 * VII.3). It classifies from the effect itself and inherits no advisory hint.
 * Surfacing a recommendation to a human commits nothing to the outside world, so
 * it is reversible; no Wave-1 effect crosses the irreversible line.
 */
function classifyReversibility(effect: CandidateEffect): ReversibilityClass {
  switch (effect) {
    case 'surface_recommendation':
      return 'reversible'
  }
}

function chainLink(q: ReasonedQuestion): ReasoningChainLink {
  return {
    key: q.key,
    leading: { label: q.leading.label, credence: q.leading.credence, groundedness: q.leading.groundedness },
    evidenceForCount: q.leading.evidenceForCount,
    evidenceAgainstCount: q.leading.evidenceAgainstCount,
    inferentialDistance: q.inferentialDistance,
    isAbsenceDerived: q.provenance.isAbsenceDerived,
    traceRefs: q.provenance.traceRefs,
  }
}

function rejectedDecision(base: GateDecisionBase, boundary: BoundaryCheck, reason: string): GateDecision {
  base.trace.push({ boundary, passed: false, detail: reason })
  return { ...base, emitted: false, outcome: null, rejection: { boundary, reason } }
}

function silentDecision(base: GateDecisionBase, reason: SilenceReason, detail: string): GateDecision {
  base.trace.push({ boundary: 'groundedness', passed: true, detail })
  return { ...base, emitted: true, outcome: 'stay_silent', silence: { reason } }
}

// ─────────────────────────────── the gate ───────────────────────────────────

/**
 * Decide the terminal outcome for one reasoned understanding. Pure; no I/O, no
 * writes, no execution. Guaranteed to return only a Wave-1-reachable terminal
 * outcome (recommend / stay_silent) or an internal rejection that emits nothing.
 */
export function decide(understanding: ReasonedUnderstanding, ctx: GateContext): GateDecision {
  const autonomy = ctx.autonomy ?? WAVE1_AUTONOMY
  const base: GateDecisionBase = {
    scope: understanding.scope,
    subject: understanding.subject,
    decidedAt: (ctx.now ?? new Date()).toISOString(),
    trace: [],
  }

  // — Seam 1: Scope. Isolation is re-checked at egress; no cross-operator leak. —
  if (understanding.scope.agencyId !== ctx.scope.agencyId) {
    return rejectedDecision(
      base,
      'scope',
      `understanding scope ${understanding.scope.agencyId} does not match gate scope ${ctx.scope.agencyId}`,
    )
  }
  base.trace.push({ boundary: 'scope', passed: true, detail: `scope ${ctx.scope.agencyId}` })

  // The candidate: the settled conclusions worth surfacing. An ungrounded model,
  // or one with nothing decision-stable, yields no candidate — an honest silence,
  // not a boundary breach.
  const settled = understanding.isGrounded ? understanding.questions.filter((q) => q.decisionStable) : []
  if (settled.length === 0) {
    const reason: SilenceReason = understanding.isGrounded ? 'no_settled_conclusion' : 'no_grounded_understanding'
    const detail = understanding.isGrounded
      ? 'grounded, but no conclusion is decision-stable enough to surface'
      : 'no resident understanding to surface'
    return silentDecision(base, reason, detail)
  }

  // — Seam 2: Provenance. Every surfaced conclusion must carry a walkable handle;
  //   a broken chain cannot pass egress (M0 §1.3). —
  const broken = settled.find((q) => !hasWalkableProvenance(q))
  if (broken) {
    return rejectedDecision(
      base,
      'provenance',
      `conclusion '${broken.key}' has no walkable provenance and is not absence-derived`,
    )
  }
  base.trace.push({ boundary: 'provenance', passed: true, detail: `${settled.length} conclusion(s) walkable` })

  // — Seam 3: Groundedness (egress non-fabrication). Nothing is surfaced unless the
  //   understanding is grounded in resident observation and no conclusion overstates
  //   its inferential distance (Constitution XI.1, XI.8; §3.9 egress seam). —
  if (!understanding.isGrounded) {
    return rejectedDecision(base, 'groundedness', 'candidate conclusions present but understanding is not grounded')
  }
  const overstated = settled.find((q) => !hasWalkableProvenance(q) && q.inferentialDistance === 'low')
  if (overstated) {
    return rejectedDecision(base, 'groundedness', `conclusion '${overstated.key}' presents inference as observed fact`)
  }
  base.trace.push({ boundary: 'groundedness', passed: true, detail: 'every surfaced conclusion walks back to traces' })

  // — Seam 4: Reversibility. The gate is the sole authority; it classifies the
  //   candidate independently. An irreversible effect could never be auto-taken —
  //   it would route to Recommend, never Act (Constitution VII.3). —
  const effect: CandidateEffect = 'surface_recommendation'
  const reversibility = classifyReversibility(effect)
  base.trace.push({ boundary: 'reversibility', passed: true, detail: `classified ${reversibility} (sole authority)` })

  // — Seam 5: Earned-autonomy (stub = none). With no earned autonomy, the gate may
  //   only Recommend or Stay Silent — never Act (M0 §1.7; Constitution VIII.5). —
  base.trace.push({ boundary: 'earned_autonomy', passed: true, detail: `autonomy ${autonomy.level} → recommend only` })

  // — Seam 6: the Value / Taste Bar (Cog J Gate 2; Constitution XI.5, XIII;
  //   DA-001 §9.1). Everything above establishes that this COULD be said; this
  //   seam decides whether it has earned the right to be. Reached only by a
  //   candidate that would otherwise be emitted as Recommend — every earlier exit
  //   has already returned — so "only a valid Recommend reaches Gate 2" is
  //   structural, not asserted.
  //
  //   Applied ONLY in surface mode. Under inspect the caller is reading the
  //   standing decision and surfacing nothing, which DA-001 does not govern. —
  const intent = ctx.intent ?? INSPECT
  if (intent.mode === 'surface') {
    const verdict = evaluateValue({
      subject: understanding.subject,
      settled,
      observationCount: understanding.observationCount,
      reversibility,
      context: intent.value,
    })
    base.value = verdict
    if (verdict.surface !== true) {
      base.trace.push({
        boundary: 'value',
        passed: false,
        detail: `below the value bar: ${verdict.failed.join(', ')}`,
      })
      // A failed bar is STAY SILENT — a constitutional terminal outcome, not a
      // boundary rejection. Nothing was breached; there was simply nothing worth
      // spending the operator's attention on.
      const silent: GateDecision = { ...base, emitted: true, outcome: 'stay_silent', silence: { reason: 'below_value_bar' } }
      assertWave1Reachable(silent.outcome)
      return silent
    }
    base.trace.push({
      boundary: 'value',
      passed: true,
      detail: verdict.waived.length > 0 ? `cleared (vigilance waived: ${verdict.waived.join(', ')})` : 'cleared',
    })
  }

  const provenanceTraces = mergeTraceRefs(settled.flatMap((q) => q.provenance.traceRefs))
  const recommendation: Recommendation = {
    effect,
    scope: understanding.scope,
    subject: understanding.subject,
    asOf: understanding.asOf,
    lens: understanding.lens,
    reversibility,
    autonomy,
    provenance: {
      traceRefs: provenanceTraces,
      anyHighInference: settled.some((q) => q.inferentialDistance === 'high'),
      anyAbsenceDerived: settled.some((q) => q.provenance.isAbsenceDerived),
    },
    reasoningChain: settled.map(chainLink),
    rationale: `surface ${settled.length} settled conclusion(s) for human authorization; the mind never crosses the irreversible line alone`,
  }

  const decision: GateDecision = { ...base, emitted: true, outcome: 'recommend', recommendation }
  assertWave1Reachable(decision.outcome)
  return decision
}

/** Guard: Wave 1 must never emit Act or Ask. Defends the terminal model structurally. */
function assertWave1Reachable(outcome: TerminalOutcome): void {
  if (!WAVE1_REACHABLE_OUTCOMES.has(outcome)) {
    throw new Error(`Tool/Action Runtime: outcome '${outcome}' is not reachable in Wave 1`)
  }
}
