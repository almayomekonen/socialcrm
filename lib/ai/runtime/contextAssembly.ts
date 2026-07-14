import {
  hydrateRelationship as defaultHydrateRelationship,
  hydratePortfolio as defaultHydratePortfolio,
  type RelationshipWorldModel,
  type PortfolioWorldModel,
} from './worldModel'
import type { CognitionRequest, CognitionTier, AdmissionReason } from './scheduler'
import type {
  Scope,
  SubjectRef,
  StoredBelief,
  NarrativeRecord,
  UncertaintyKind,
  InferentialDistance,
} from '@/db/ai/stateManagement'
import type { DecayPolicy } from '@/db/ai/decay'

/**
 * W2-M1 — Context Assembly Runtime (Wave 2). The bounding layer between the
 * Runtime Scheduler (M4) and the Reasoning Runtime (M5).
 *
 * It realizes Context Assembly (AI Runtime Architecture §3.5; Cognitive
 * Architecture D — the attention ration on the mind's own effort). Its single
 * responsibility is to answer one question for one cognition request:
 *
 *   "What information should the Reasoning Runtime receive?"
 *
 * It transforms the resident World Model into an **epistemically bounded working
 * context** — a {@link ContextPackage}. It reads the World Model through the
 * World Model Runtime's hydration surface (never the database directly, never
 * around a runtime layer) and selects a bounded working set on **structural and
 * temporal** grounds only.
 *
 * It does not reason, infer, plan, or update beliefs. It never ranks business
 * value, schedules cognition, classifies reversibility, generates
 * recommendations, or chooses actions. Crucially, it never **removes uncertainty**
 * and never **collapses competing evidence**: a belief is carried whole (its
 * graded confidence, second-order groundedness, epistemic/aleatoric kind,
 * evidence-for AND evidence-against, provenance, and inferential distance all
 * intact) or it is carried whole in the excluded set with a recorded reason.
 * Bounding limits what the working set *includes*; it discards nothing — every
 * excluded item stays in the package, explainable and traceable. Nothing
 * disappears silently.
 *
 * The attention ration is the episode's Scheduler-assigned **tier** (an attention
 * allocation already decided upstream), never a re-ranking of business value; the
 * ordering that decides what stays in-bounds is **trigger-relevance temporal**
 * (a staleness episode surfaces the stalest region first; every other trigger
 * surfaces the freshest first), never confidence, groundedness, or value.
 *
 * Operator context is a future-ready placeholder: per the ratified scope tiers,
 * operator-scoped cognition (goals, memory, autonomy) is a higher layer, and this
 * runtime is its designated Boundary-5 home (Runtime Arch Part 5, Boundary 5) —
 * so the shape exists now, unpopulated, to be filled without a retrofit.
 */

// ─────────────────────────────── policy ─────────────────────────────────────

/** Attention rations by tier. A bound on the working set, not a value ranking. */
export interface AssemblyPolicy {
  /** Max beliefs admitted to the working set, by Scheduler tier. */
  beliefCapByTier: Record<CognitionTier, number>
  /** Max narrative-floor records admitted to the working set, by tier. */
  narrativeCapByTier: Record<CognitionTier, number>
  /** Max portfolio member references carried (identity only; never ranked). */
  memberReferenceCap: number
}

export const DEFAULT_ASSEMBLY_POLICY: AssemblyPolicy = {
  beliefCapByTier: { 1: 8, 2: 24 },
  narrativeCapByTier: { 1: 5, 2: 20 },
  memberReferenceCap: 100,
}

/** The concrete caps actually applied for one episode (assembly metadata). */
export interface ResolvedAssemblyPolicy {
  tier: CognitionTier
  reason: AdmissionReason
  beliefCap: number
  narrativeCap: number
  memberReferenceCap: number
}

// ─────────────────────────────── package shapes ─────────────────────────────

export type ContextScale = 'relationship' | 'portfolio'

/** Why an item was bounded out of the working set. Never "not valuable enough". */
export type ExclusionReason = 'working_set_cap' | 'narrative_cap' | 'member_reference_cap'

/** An excluded belief — carried whole so nothing disappears; explainable + traceable. */
export interface ExcludedBelief {
  reason: ExclusionReason
  detail: string
  belief: StoredBelief
}

/** Future-ready operator context. Unpopulated in W2-M1 (operator scope is a higher layer). */
export interface OperatorContext {
  present: false
}

/** The immutable output: an epistemically bounded working context for one episode. */
export interface ContextPackage {
  scope: Scope
  subject: SubjectRef
  scale: ContextScale
  /** The cognition request that asked for this context (assembly metadata). */
  request: CognitionRequest
  assembledAt: string
  policy: ResolvedAssemblyPolicy

  /** The working set the Reasoning Runtime should receive — full, uncertainty intact. */
  includedBeliefs: StoredBelief[]
  includedNarrative: NarrativeRecord[]
  /** Portfolio member references (identity only, id-ordered, never ranked). */
  memberReferences: SubjectRef[]

  /** Temporal context of the working set (preserved, never derived into a verdict). */
  temporal: {
    asOf: string
    anyStale: boolean
    freshestAt: string | null
    stalestAt: string | null
  }
  /** Uncertainty of the working set (preserved — never removed or collapsed). */
  uncertainty: {
    anyUncalibratable: boolean
    anyHighInference: boolean
    anyAleatoric: boolean
    anyContested: boolean
  }
  operatorContext: OperatorContext | null

  /** Everything bounded out — nothing disappears silently. */
  excludedBeliefs: ExcludedBelief[]
  excludedNarrativeCount: number
  excludedMemberCount: number

  accounting: {
    totalBeliefs: number
    includedBeliefCount: number
    excludedBeliefCount: number
    totalNarrative: number
    includedNarrativeCount: number
    totalMembers: number
    includedMemberCount: number
  }
  isEmpty: boolean
}

export interface AssembleOptions {
  now?: Date
  policy?: AssemblyPolicy
}

export interface AssemblyDeps {
  hydrateRelationship?: typeof defaultHydrateRelationship
  hydratePortfolio?: typeof defaultHydratePortfolio
  portfolioMembers?: (scope: Scope, portfolioId: string) => Promise<string[]>
}

export interface AssembleContextOptions extends AssembleOptions {
  decayPolicy?: DecayPolicy
  deps?: AssemblyDeps
}

// ─────────────────────────────── pure helpers ───────────────────────────────

function byKey(a: StoredBelief, z: StoredBelief): number {
  return a.key < z.key ? -1 : a.key > z.key ? 1 : 0
}

/**
 * Trigger-relevance temporal ordering. A staleness episode exists *because* a
 * region went unobserved, so the stalest belief is the most relevant and must
 * stay in-bounds; every other trigger surfaces the freshest first. This is an
 * epistemic relevance axis (time), never a ranking of business value, confidence,
 * or groundedness.
 */
function orderBeliefsFor(reason: AdmissionReason, beliefs: StoredBelief[]): StoredBelief[] {
  if (reason === 'staleness') {
    return [...beliefs].sort((a, z) => z.ageMs - a.ageMs || byKey(a, z))
  }
  return [...beliefs].sort((a, z) => a.ageMs - z.ageMs || byKey(a, z))
}

/** Most-recent-first, for the working narrative. The M1 floor itself is never pruned. */
function orderNarrativeRecent(narrative: NarrativeRecord[]): NarrativeRecord[] {
  return [...narrative].sort((a, z) => (a.occurredAt < z.occurredAt ? 1 : a.occurredAt > z.occurredAt ? -1 : z.id - a.id))
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
  }
  return value
}

function assertSameScope(request: CognitionRequest, modelScope: Scope): void {
  if (request.scope.agencyId !== modelScope.agencyId) {
    throw new Error(
      `Context Assembly: scope mismatch — request agency ${request.scope.agencyId} vs model agency ${modelScope.agencyId}`,
    )
  }
}

function resolvePolicy(request: CognitionRequest, policy: AssemblyPolicy): ResolvedAssemblyPolicy {
  return {
    tier: request.tier,
    reason: request.reason,
    beliefCap: policy.beliefCapByTier[request.tier],
    narrativeCap: policy.narrativeCapByTier[request.tier],
    memberReferenceCap: policy.memberReferenceCap,
  }
}

function summarizeTemporal(asOf: string, included: StoredBelief[]): ContextPackage['temporal'] {
  if (included.length === 0) return { asOf, anyStale: false, freshestAt: null, stalestAt: null }
  let freshest = included[0]
  let stalest = included[0]
  for (const b of included) {
    if (b.ageMs < freshest.ageMs) freshest = b
    if (b.ageMs > stalest.ageMs) stalest = b
  }
  return {
    asOf,
    anyStale: included.some((b) => b.isStale),
    freshestAt: freshest.freshnessAt,
    stalestAt: stalest.freshnessAt,
  }
}

function summarizeUncertainty(included: StoredBelief[]): ContextPackage['uncertainty'] {
  return {
    anyUncalibratable: included.some((b) => !b.calibratable),
    anyHighInference: included.some((b) => b.provenance.inferentialDistance === 'high'),
    anyAleatoric: included.some((b) => (b.uncertaintyKind as UncertaintyKind) === 'aleatoric'),
    anyContested: included.some((b) => b.evidenceFor.length > 0 && b.evidenceAgainst.length > 0),
  }
}

function build(
  request: CognitionRequest,
  subject: SubjectRef,
  scale: ContextScale,
  beliefs: StoredBelief[],
  narrative: NarrativeRecord[],
  memberSubjects: SubjectRef[],
  policy: ResolvedAssemblyPolicy,
  asOf: string,
): ContextPackage {
  const orderedBeliefs = orderBeliefsFor(request.reason, beliefs)
  const includedBeliefs = orderedBeliefs.slice(0, policy.beliefCap)
  const excludedBeliefs: ExcludedBelief[] = orderedBeliefs.slice(policy.beliefCap).map((belief) => ({
    reason: 'working_set_cap',
    detail: `beyond the tier-${policy.tier} working-set cap of ${policy.beliefCap} beliefs`,
    belief,
  }))

  const orderedNarrative = orderNarrativeRecent(narrative)
  const includedNarrative = orderedNarrative.slice(0, policy.narrativeCap)
  const excludedNarrativeCount = Math.max(0, orderedNarrative.length - policy.narrativeCap)

  const orderedMembers = [...memberSubjects].sort((a, z) => (a.subjectId < z.subjectId ? -1 : a.subjectId > z.subjectId ? 1 : 0))
  const memberReferences = orderedMembers.slice(0, policy.memberReferenceCap)
  const excludedMemberCount = Math.max(0, orderedMembers.length - policy.memberReferenceCap)

  const pkg: ContextPackage = {
    scope: request.scope,
    subject,
    scale,
    request,
    assembledAt: asOf,
    policy,
    includedBeliefs,
    includedNarrative,
    memberReferences,
    temporal: summarizeTemporal(asOf, includedBeliefs),
    uncertainty: summarizeUncertainty(includedBeliefs),
    operatorContext: null,
    excludedBeliefs,
    excludedNarrativeCount,
    excludedMemberCount,
    accounting: {
      totalBeliefs: beliefs.length,
      includedBeliefCount: includedBeliefs.length,
      excludedBeliefCount: excludedBeliefs.length,
      totalNarrative: narrative.length,
      includedNarrativeCount: includedNarrative.length,
      totalMembers: orderedMembers.length,
      includedMemberCount: memberReferences.length,
    },
    isEmpty: beliefs.length === 0 && narrative.length === 0 && memberSubjects.length === 0,
  }
  return deepFreeze(pkg)
}

// ─────────────────────────────── pure entry points ──────────────────────────

/** Assemble a bounded context from an already-hydrated relationship model. Pure. */
export function assembleFromRelationship(
  request: CognitionRequest,
  model: RelationshipWorldModel,
  opts: AssembleOptions = {},
): ContextPackage {
  assertSameScope(request, model.scope)
  const policy = resolvePolicy(request, opts.policy ?? DEFAULT_ASSEMBLY_POLICY)
  return build(request, model.subject, 'relationship', model.beliefs, model.narrative, [], policy, model.asOf)
}

/**
 * Assemble a bounded context from an already-hydrated portfolio model. Reasons
 * over the portfolio's own aggregate beliefs; members are carried as identity
 * references only (never ranked — comparative triage is not this runtime's job).
 */
export function assembleFromPortfolio(
  request: CognitionRequest,
  model: PortfolioWorldModel,
  opts: AssembleOptions = {},
): ContextPackage {
  assertSameScope(request, model.scope)
  const policy = resolvePolicy(request, opts.policy ?? DEFAULT_ASSEMBLY_POLICY)
  const subject: SubjectRef = { subjectType: 'portfolio', subjectId: model.portfolioId }
  const memberSubjects = model.members.map((m) => m.subject)
  return build(request, subject, 'portfolio', model.beliefs, model.narrative, memberSubjects, policy, model.asOf)
}

// ─────────────────────────────── async entry point ──────────────────────────

/**
 * Read the resident World Model for the request's subject (via the World Model
 * Runtime — never the database directly) and assemble a bounded Context Package.
 * Read-only: no belief is written, no cognition is scheduled.
 */
export async function assembleContext(request: CognitionRequest, opts: AssembleContextOptions = {}): Promise<ContextPackage> {
  const now = opts.now ?? new Date()
  const readOpts = { now, policy: opts.decayPolicy }
  const pureOpts: AssembleOptions = { now, policy: opts.policy }

  if (request.subject.subjectType === 'portfolio') {
    const hydratePortfolio = opts.deps?.hydratePortfolio ?? defaultHydratePortfolio
    const members = opts.deps?.portfolioMembers ? await opts.deps.portfolioMembers(request.scope, request.subject.subjectId) : []
    const model = await hydratePortfolio(request.scope, request.subject.subjectId, members, readOpts)
    return assembleFromPortfolio(request, model, pureOpts)
  }

  const hydrateRelationship = opts.deps?.hydrateRelationship ?? defaultHydrateRelationship
  const model = await hydrateRelationship(request.scope, request.subject.subjectId, readOpts)
  return assembleFromRelationship(request, model, pureOpts)
}
