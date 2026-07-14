import {
  hydrateRelationship as defaultHydrateRelationship,
  hydratePortfolio as defaultHydratePortfolio,
  type RelationshipWorldModel,
  type PortfolioWorldModel,
} from './worldModel'
import type { AdmissionReason, CognitionRequest, CognitionTier } from './scheduler'
import type { Scope, SubjectRef, StoredBelief, TraceRef, InferentialDistance, UncertaintyKind } from '@/db/ai/stateManagement'
import type { DecayPolicy } from '@/db/ai/decay'

/**
 * M5 — Reasoning Runtime (Wave 1). The first runtime responsible for cognition.
 *
 * It transforms one {@link CognitionRequest} into a *justified understanding of
 * the current world*. It realizes comprehension and the competing-hypothesis /
 * sufficiency machinery (Cognitive Architecture E, F; AI Runtime Architecture
 * §3.7): read the resident World Model, hold competing hypotheses scored by
 * disconfirmation, name the cheapest discriminating observation while a question
 * stays live, and stop at decision-stability scaled by (epistemic) stakes —
 * marking every conclusion calibratable or structurally-uncalibratable and
 * carrying provenance and inferential distance through intact.
 *
 * It owns the reasoning *lifecycle and contracts*, never a reasoning
 * *technology*: hypotheses are grounded in the resident beliefs (not invented by
 * a model), and the evidence calculus is a transparent, disconfirmation-weighted
 * accumulation (Theory §3.9) — no model, prompt, or proprietary inference engine
 * is chosen here (§3.7 must-not).
 *
 * The output is **reasoning only**. This runtime is read-only: it produces no
 * beliefs written back, no actions, no recommendations, and no execution
 * priority. It distinguishes four layers explicitly — observation (traces),
 * belief (resident World Model claims), inference (the reasoned hypotheses it
 * produces), and uncertainty (first- and second-order, epistemic vs aleatoric).
 *
 * Deferred by Wave 1 scope (documented, not built here): comparative portfolio
 * triage across the admitted set (that is the executive lens and borders on
 * prioritization); writing calibrated beliefs back to the World Model; and
 * Context-Assembly bounding of the working set (that Wave-1 system is not built,
 * so the resident model is read directly per M0 §4.3).
 */

// ─────────────────────────────── output shapes ──────────────────────────────

/** The four layers the output keeps distinct. */
export type ReasoningLayer = 'observation' | 'belief' | 'inference' | 'uncertainty'

/** One competing hypothesis within a question. */
export interface HypothesisView {
  label: string
  /** First-order posterior credence in [0,1]. */
  credence: number
  /** Second-order groundedness of that credence in [0,1]. */
  groundedness: number
  /** Observations supporting this hypothesis. */
  evidenceForCount: number
  /** Observations opposing this hypothesis. */
  evidenceAgainstCount: number
  /** Still contested (investigable and below the sufficiency bar). */
  live: boolean
}

/** The cheapest discriminating observation to seek while a question is live. */
export interface Discriminator {
  key: string
  description: string
  betweenLabels: [string, string]
}

/** The reasoned understanding of one question (one resident belief-key). */
export interface ReasonedQuestion {
  key: string
  hypotheses: HypothesisView[]
  leading: HypothesisView
  /** Credence gap between the leading and the runner-up hypothesis. */
  margin: number
  decisionStable: boolean
  discriminator: Discriminator | null
  uncertaintyKind: UncertaintyKind
  calibratable: boolean
  /** Max inferential distance of the evidence — never presented lower than reality. */
  inferentialDistance: InferentialDistance
  provenance: {
    traceRefs: TraceRef[]
    inferentialDistance: InferentialDistance
    isAbsenceDerived: boolean
  }
  freshness: { ageMs: number; isStale: boolean }
}

/** The lens the Scheduler admitted — the epistemic stakes of the episode. */
export interface ReasoningLens {
  tier: CognitionTier
  reason: AdmissionReason
  /** The decision-stability margin required at this stakes level. */
  sufficiencyMargin: number
}

/** The complete output of a bounded reasoning episode. Reasoning only. */
export interface ReasonedUnderstanding {
  scope: Scope
  subject: SubjectRef
  scale: 'relationship' | 'portfolio'
  lens: ReasoningLens
  asOf: string
  /** Distinct underlying traces (the observation layer). */
  observationCount: number
  /** Resident beliefs reasoned over (the belief layer). */
  beliefCount: number
  /** The reasoned questions (the inference layer). */
  questions: ReasonedQuestion[]
  /** Whole-episode sufficiency: every question is decision-stable. */
  decisionStable: boolean
  /** Keys of questions still live (investigable and unresolved). */
  openQuestions: string[]
  /** The uncertainty layer, summarized. */
  uncertainty: {
    anyUncalibratable: boolean
    anyHighInference: boolean
    anyStale: boolean
  }
  /** False when there is nothing resident to reason over — an honest "no understanding". */
  isGrounded: boolean
}

export interface ReasoningDeps {
  hydrateRelationship?: typeof defaultHydrateRelationship
  hydratePortfolio?: typeof defaultHydratePortfolio
  /** Member subject ids for a portfolio subject (context only; never ranked). */
  portfolioMembers?: (scope: Scope, portfolioId: string) => Promise<string[]>
}

export interface ReasoningOptions {
  now?: Date
  policy?: DecayPolicy
  deps?: ReasoningDeps
}

// ─────────────────────────────── policy / stakes ────────────────────────────

/**
 * Decision-stability bar by trigger lens. These are *epistemic* stakes — how
 * stable an understanding must be before the episode stops — scaled by the kind
 * of trigger (a vigilance absence demands more than a routine coverage sweep).
 * They are never a comparative ranking of business value.
 */
const SUFFICIENCY_MARGIN: Record<AdmissionReason, number> = {
  coverage_sweep: 0.15,
  staleness: 0.2,
  inbound: 0.25,
  absence: 0.3,
}

/** Disconfirmation weighs more than confirmation (Theory §3.9). */
const CONFIRM_WEIGHT = 0.35
const DISCONFIRM_WEIGHT = 0.6

const DISTANCE_PENALTY: Record<InferentialDistance, number> = { low: 1, medium: 0.75, high: 0.5 }

// ─────────────────────────────── pure helpers ───────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function clamp01(n: number): number {
  return Number.isNaN(n) ? 0 : clamp(n, 0, 1)
}

function logit(p: number): number {
  const c = clamp(p, 1e-6, 1 - 1e-6)
  return Math.log(c / (1 - c))
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

function dedupeTraceRefs(refs: TraceRef[]): TraceRef[] {
  const seen = new Set<string>()
  const out: TraceRef[] = []
  for (const r of refs) {
    const key = `${r.type}:${r.id}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(r)
    }
  }
  return out
}

/**
 * Reason one resident belief into a competing-hypothesis question. Grounds the
 * two hypotheses in the belief itself (the claim holds vs it does not), scores
 * them by disconfirmation-weighted evidence, and tests decision-stability.
 */
function reasonBelief(belief: StoredBelief, sufficiencyMargin: number): ReasonedQuestion {
  const confirming = belief.evidenceFor.length
  const disconfirming = belief.evidenceAgainst.length

  // Prior credence in "holds" is the time-adjusted first-order credence.
  const prior = clamp01(belief.decayedConfidence)
  const holds = clamp01(sigmoid(logit(prior) + CONFIRM_WEIGHT * confirming - DISCONFIRM_WEIGHT * disconfirming))

  // Second-order groundedness: rises with evidence volume, falls with inferential
  // distance, and is anchored by the belief's own groundedness. This keeps a
  // "confidently 60%" distinct from a "cluelessly 60%" (M0 §1.2).
  const totalEvidence = confirming + disconfirming
  const volumeFactor = totalEvidence / (totalEvidence + 2)
  const distance = belief.provenance.inferentialDistance
  const groundedness = clamp01(belief.groundedness * (0.4 + 0.6 * volumeFactor) * DISTANCE_PENALTY[distance])

  const investigable = belief.uncertaintyKind === 'epistemic'
  const margin = Math.abs(2 * holds - 1)
  const decisionStable = margin >= sufficiencyMargin || !investigable
  const live = !decisionStable

  const holdsHyp: HypothesisView = {
    label: 'holds',
    credence: holds,
    groundedness,
    evidenceForCount: confirming,
    evidenceAgainstCount: disconfirming,
    live,
  }
  const notHyp: HypothesisView = {
    label: 'not_holds',
    credence: clamp01(1 - holds),
    groundedness,
    evidenceForCount: disconfirming,
    evidenceAgainstCount: confirming,
    live,
  }

  const hypotheses = [holdsHyp, notHyp].sort((a, z) => z.credence - a.credence || (a.label < z.label ? -1 : 1))
  const [leading, runnerUp] = hypotheses

  const discriminator: Discriminator | null = live
    ? {
        key: belief.key,
        description: `seek a discriminating observation on '${belief.key}' to separate '${leading.label}' from '${runnerUp.label}'`,
        betweenLabels: [leading.label, runnerUp.label],
      }
    : null

  const traceRefs = dedupeTraceRefs([...belief.provenance.traceRefs, ...belief.evidenceFor, ...belief.evidenceAgainst])

  return {
    key: belief.key,
    hypotheses,
    leading,
    margin: leading.credence - runnerUp.credence,
    decisionStable,
    discriminator,
    uncertaintyKind: belief.uncertaintyKind,
    calibratable: belief.calibratable,
    inferentialDistance: distance,
    provenance: { traceRefs, inferentialDistance: distance, isAbsenceDerived: belief.isAbsenceDerived },
    freshness: { ageMs: belief.ageMs, isStale: belief.isStale },
  }
}

function buildUnderstanding(
  request: CognitionRequest,
  subject: SubjectRef,
  scale: 'relationship' | 'portfolio',
  beliefs: StoredBelief[],
  asOf: string,
): ReasonedUnderstanding {
  const sufficiencyMargin = SUFFICIENCY_MARGIN[request.reason]
  const lens: ReasoningLens = { tier: request.tier, reason: request.reason, sufficiencyMargin }

  // Deterministic order so an understanding is reproducible.
  const ordered = [...beliefs].sort((a, z) => (a.key < z.key ? -1 : a.key > z.key ? 1 : 0))
  const questions = ordered.map((b) => reasonBelief(b, sufficiencyMargin))

  const allTraces = dedupeTraceRefs(questions.flatMap((q) => q.provenance.traceRefs))
  const openQuestions = questions.filter((q) => !q.decisionStable).map((q) => q.key)

  const uncertainty = {
    anyUncalibratable: questions.some((q) => !q.calibratable),
    anyHighInference: questions.some((q) => q.inferentialDistance === 'high'),
    anyStale: questions.some((q) => q.freshness.isStale),
  }

  return {
    scope: request.scope,
    subject,
    scale,
    lens,
    asOf,
    observationCount: allTraces.length,
    beliefCount: beliefs.length,
    questions,
    decisionStable: openQuestions.length === 0,
    openQuestions,
    uncertainty,
    isGrounded: beliefs.length > 0,
  }
}

function assertSameScope(request: CognitionRequest, modelScope: Scope): void {
  if (request.scope.agencyId !== modelScope.agencyId) {
    throw new Error(
      `Reasoning Runtime: scope mismatch — request agency ${request.scope.agencyId} vs model agency ${modelScope.agencyId}`,
    )
  }
}

// ─────────────────────────────── pure entry points ──────────────────────────

/** Reason over an already-hydrated relationship model. Pure; no I/O. */
export function reasonOverRelationship(request: CognitionRequest, model: RelationshipWorldModel): ReasonedUnderstanding {
  assertSameScope(request, model.scope)
  return buildUnderstanding(request, model.subject, 'relationship', model.beliefs, model.asOf)
}

/**
 * Reason over an already-hydrated portfolio model. Reasons over the portfolio's
 * own aggregate beliefs only; members are context and are never ranked against
 * one another (comparative triage is out of M5 scope).
 */
export function reasonOverPortfolio(request: CognitionRequest, model: PortfolioWorldModel): ReasonedUnderstanding {
  assertSameScope(request, model.scope)
  const subject: SubjectRef = { subjectType: 'portfolio', subjectId: model.portfolioId }
  return buildUnderstanding(request, subject, 'portfolio', model.beliefs, model.asOf)
}

// ─────────────────────────────── async entry point ──────────────────────────

/**
 * Read the resident World Model for the request's subject and reason it into a
 * justified understanding. Read-only: no state is written.
 */
export async function reason(request: CognitionRequest, opts: ReasoningOptions = {}): Promise<ReasonedUnderstanding> {
  const now = opts.now ?? new Date()
  const readOpts = { now, policy: opts.policy }

  if (request.subject.subjectType === 'portfolio') {
    const hydratePortfolio = opts.deps?.hydratePortfolio ?? defaultHydratePortfolio
    const members = opts.deps?.portfolioMembers ? await opts.deps.portfolioMembers(request.scope, request.subject.subjectId) : []
    const model = await hydratePortfolio(request.scope, request.subject.subjectId, members, readOpts)
    return reasonOverPortfolio(request, model)
  }

  const hydrateRelationship = opts.deps?.hydrateRelationship ?? defaultHydrateRelationship
  const model = await hydrateRelationship(request.scope, request.subject.subjectId, readOpts)
  return reasonOverRelationship(request, model)
}
