import { claimRefs, type Claim, type EvidenceRef } from '@/lib/agent/types'
import type { ReasonedUnderstanding, ReasonedQuestion, HypothesisView } from '@/lib/ai/runtime/reasoning'
import type { AdmissionReason, CognitionTier } from '@/lib/ai/runtime/scheduler'
import type { InferentialDistance, Scope, SubjectRef, TraceRef } from '@/db/ai/stateManagement'

/**
 * The bridge — validated Agent claims → a ReasonedUnderstanding the gate can judge.
 *
 * PURE. No I/O, no clock, no model, no database. It is the ONLY place this mapping
 * exists, because a second one would be a second answer to the hardest question
 * in Phase 4.3.
 *
 * ── THE PROBLEM THIS SOLVES ────────────────────────────────────────────────────
 *
 * The two contracts are not isomorphic, and the gap is a number. A
 * `ReasonedQuestion` requires `credence` and `groundedness`; an `AgentAnswer`
 * produces classified claims with citations and NO confidence whatsoever. The
 * Agent never estimates how likely it is to be right, and it must not start:
 * a confident number over an outcome the world will never resolve is, in the
 * Constitution's words, the lie with a number attached (IX, XI.3).
 *
 * What makes the mapping possible is a verified fact about the gate: **`decide()`
 * never thresholds on `credence` or `groundedness`.** They appear only inside
 * `chainLink()`, which carries them into the recommendation for explainability.
 * Every decision the gate makes runs on `isGrounded`, `decisionStable`, walkable
 * provenance, and inferential distance — all of which the Agent's own contract
 * genuinely supplies.
 *
 * So this module does not invent confidence. It refuses to, in the exact shape
 * Cognitive Architecture E prescribes for a belief whose outcome will never
 * resolve: mark it **structurally-uncalibratable**, hold groundedness low, widen
 * the uncertainty, and say so. `calibratable` is `false` on every question this
 * module produces, without exception and without a code path that could make it
 * true.
 *
 * The two numeric fields are filled from a single declared constant — never
 * per-claim, never derived from anything the model wrote. They are inert by
 * construction, and an invariant test asserts no gate seam and no Value Bar
 * criterion may ever branch on them. If that test is ever deleted, the constant
 * stops being inert and this module stops being honest.
 *
 * ── WHAT IS CARRIED, AND FROM WHERE ───────────────────────────────────────────
 *
 * `traceRefs` come only from refs that SURVIVED `validateAgentAnswer`, resolved
 * against the evidence the TOOLS collected. A claim the validator stripped cannot
 * contribute a trace, because there is nothing left to resolve. A metric ref has
 * no trace identity, so an OBSERVATION citing only metrics yields a question with
 * zero traces — which the Value Bar's evidence criterion then suppresses. That
 * falls out of the contract rather than needing a rule of its own.
 *
 * Inferential distance is read from the claim class, which the validator has
 * already enforced: FACT and OBSERVATION are low (read from rows and
 * measurements), INFERENCE and RECOMMENDATION are high (judgements). Mislabelling
 * one as the other is what the discriminated union and the class-specific
 * evidence fields exist to make expensive.
 */

/**
 * The single declared value for the two contract fields the gate never reads.
 *
 * Deliberately ONE constant rather than a per-class scale: a scale would look
 * like a calibrated judgement and would tempt a future reader to threshold on it.
 * A flat, low, obviously-uniform number reads as what it is — a placeholder in a
 * contract slot, carrying no claim about the world.
 */
export const UNCALIBRATED = 0.5

/** The lens an autonomous investigation runs under. Tier 2 by definition. */
const AUTONOMOUS_TIER: CognitionTier = 2

export interface BridgeInput {
  scope: Scope
  subject: SubjectRef
  /** Claims that SURVIVED validateAgentAnswer. Never the raw model output. */
  claims: readonly Claim[]
  /** Evidence the TOOLS produced. The model never writes here. */
  evidence: readonly EvidenceRef[]
  /** The admission reason from the originating signal. */
  reason: AdmissionReason
  /** ISO instant the investigation concluded. */
  asOf: string
}

/** FACT/OBSERVATION are read; INFERENCE/RECOMMENDATION are judged. */
export function distanceForClaim(claim: Claim): InferentialDistance {
  return claim.claimClass === 'FACT' || claim.claimClass === 'OBSERVATION' ? 'low' : 'high'
}

/**
 * Resolve a claim's surviving refs to traces.
 *
 * Only ENTITY evidence has a trace identity. A metric is a measurement, not a
 * thing the rep can open, so it deliberately yields nothing — and a claim resting
 * only on metrics therefore carries no provenance for the gate to walk.
 */
function tracesFor(claim: Claim, evidence: readonly EvidenceRef[]): TraceRef[] {
  const entities = new Map<string, TraceRef>()
  for (const ref of evidence) {
    if (ref.kind === 'metric') continue
    entities.set(ref.refId, { type: ref.kind, id: ref.refId })
  }
  const out: TraceRef[] = []
  const seen = new Set<string>()
  for (const raw of claimRefs(claim)) {
    const hit = entities.get(raw)
    if (hit && !seen.has(raw)) {
      seen.add(raw)
      out.push(hit)
    }
  }
  return out
}

/** One validated claim, expressed in the Reasoning Runtime's contract. */
function questionForClaim(claim: Claim, index: number, evidence: readonly EvidenceRef[]): ReasonedQuestion {
  const distance = distanceForClaim(claim)
  const traceRefs = tracesFor(claim, evidence)

  const leading: HypothesisView = {
    label: claim.claimClass.toLowerCase(),
    credence: UNCALIBRATED,
    groundedness: UNCALIBRATED,
    evidenceForCount: traceRefs.length,
    evidenceAgainstCount: 0,
    live: false,
  }

  return {
    key: `agent.claim.${index}`,
    hypotheses: [leading],
    leading,
    // Zero margin: there is no runner-up, because the Agent does not hold
    // competing hypotheses. Stating a margin would be stating a comparison that
    // was never made.
    margin: 0,
    // The claim survived the validator. That IS sufficiency here: supportable,
    // grounded, and hedged where the class requires it.
    decisionStable: true,
    discriminator: null,
    uncertaintyKind: 'epistemic',
    // Structurally uncalibratable, always. No path sets this true.
    calibratable: false,
    inferentialDistance: distance,
    provenance: {
      traceRefs,
      inferentialDistance: distance,
      // Never absence-derived: an Agent claim rests on what it read, and an
      // absence-derived marker would let a claim with no traces pass the gate's
      // provenance seam on an honesty exemption it has not earned.
      isAbsenceDerived: false,
    },
    freshness: { ageMs: 0, isStale: false },
  }
}

/**
 * Build the understanding. Total and pure: an empty or fully-stripped claim set
 * yields an ungrounded understanding, which the gate answers with silence.
 */
export function bridgeInvestigation(input: BridgeInput): ReasonedUnderstanding {
  const questions = input.claims.map((c, i) => questionForClaim(c, i, input.evidence))

  const distinctTraces = new Set<string>()
  for (const q of questions) for (const t of q.provenance.traceRefs) distinctTraces.add(`${t.type}:${t.id}`)

  return {
    scope: input.scope,
    subject: input.subject,
    scale: 'relationship',
    lens: {
      tier: AUTONOMOUS_TIER,
      reason: input.reason,
      // The Agent's own budget decided when to stop; there is no margin bar to
      // report. Zero states that honestly rather than implying a threshold.
      sufficiencyMargin: 0,
    },
    asOf: input.asOf,
    observationCount: distinctTraces.size,
    beliefCount: questions.length,
    questions,
    decisionStable: questions.length > 0,
    openQuestions: [],
    uncertainty: {
      // Always true: every Agent-derived conclusion is structurally uncalibratable.
      anyUncalibratable: true,
      anyHighInference: questions.some((q) => q.inferentialDistance === 'high'),
      anyStale: false,
    },
    // Grounded only when something survived validation AND the tools produced
    // evidence. Either alone is not enough.
    isGrounded: questions.length > 0 && input.evidence.length > 0,
  }
}
