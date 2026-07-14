import {
  readNarrative as defaultReadNarrative,
  readBeliefs as defaultReadBeliefs,
  readBeliefVersions as defaultReadBeliefVersions,
  type Scope,
  type SubjectRef,
  type StoredBelief,
  type NarrativeRecord,
  type BeliefVersion,
  type TraceRef,
  type InferentialDistance,
  type UncertaintyKind,
} from '@/db/ai/stateManagement'
import type { DecayPolicy } from '@/db/ai/decay'

/**
 * W2-M2 — Memory Runtime (Wave 2). The recall services over the World Model,
 * kept separate from the live model (AI Runtime Architecture §3.3; Cognitive
 * Architecture G; Theory §3.11).
 *
 * It realizes three *distinct* memory services and makes them recallable so a
 * later reasoning episode can recognise a new situation as *like* a known one and
 * reach for priors — without collapsing memory into priors alone (§3.3 must-not):
 *
 *   • Episodic  — specific past cases: the relationship's recorded narrative
 *                 (history / promise / outcome) and the evolution of its beliefs
 *                 (their version history). Case-based recognition needs these
 *                 kept whole, not summarised away.
 *   • Semantic  — consolidated base rates over a cohort: deterministic frequency
 *                 priors (e.g. how often a belief key "holds" across peers).
 *   • Procedural— retained know-how about how a kind of belief typically behaves
 *                 across a cohort (its usual uncertainty kind, inferential
 *                 distance, and contested rate).
 *
 * It is read-only and deterministic: it recalls and consolidates what already
 * exists in State Management (M1); it never reasons, infers causation, updates a
 * belief, or fabricates a remembered fact. Consolidation here is a pure
 * recall-time aggregation — the persistent consolidation/forgetting *policy* and
 * learning belong to the Metacognition Runtime Layer (not built), and are not
 * performed here. Every remembered item carries its provenance/source so recall
 * stays traceable (§3.3 key concern).
 *
 * Continuity, not surveillance (Constitution Law 19): recall is bounded and
 * relevance-scoped — it surfaces the relevant past, never an exhaustive dossier.
 * Operator personal memory (what was recommended to whom, and how it landed) is
 * per-operator and belongs to a higher layer per the ratified scope tiers; its
 * slot is present here as a future-ready placeholder, unpopulated.
 *
 * It reads only through State Management's public read surface — never the
 * database directly, never around a runtime layer.
 */

// ─────────────────────────────── policy ─────────────────────────────────────

export interface MemoryPolicy {
  /** Max episodic cases recalled (bounded continuity, not a full transcript). */
  episodicCap: number
  /** Max cohort members consolidated into base rates / know-how. */
  cohortMemberCap: number
}

export const DEFAULT_MEMORY_POLICY: MemoryPolicy = {
  episodicCap: 50,
  cohortMemberCap: 200,
}

// ─────────────────────────────── recall shapes ──────────────────────────────

export type EpisodeKind = 'narrative' | 'belief_change'

/** One specific remembered case. Carried whole; traceable to its source. */
export interface EpisodicCase {
  kind: EpisodeKind
  subject: SubjectRef
  /** narrative kind (history/promise/outcome) or the belief key that changed. */
  label: string
  occurredAt: string
  content: Record<string, unknown>
  /** A stable reference back to the source record — recall stays traceable. */
  sourceRef: TraceRef
  /** Belief-change episodes carry the belief's provenance and its point-in-time state. */
  provenance: { traceRefs: TraceRef[]; inferentialDistance: InferentialDistance } | null
  version: number | null
  confidence: number | null
}

/** A consolidated frequency prior over a cohort. Deterministic; no inference. */
export interface BaseRate {
  /** The belief key the rate is about. */
  dimension: string
  /** The category measured — Wave 2 M2 measures the "holds" fraction. */
  category: 'holds'
  count: number
  total: number
  rate: number
}

/** Retained know-how about how a belief key typically behaves across a cohort. */
export interface ProceduralAssociation {
  key: string
  typicalUncertaintyKind: UncertaintyKind
  typicalInferentialDistance: InferentialDistance
  /** Fraction of cohort cases where the belief carried evidence on both sides. */
  contestedRate: number
  support: number
}

/** Future-ready operator personal memory. Unpopulated in W2-M2 (higher layer). */
export interface OperatorMemoryContext {
  present: false
}

export interface MemoryQuery {
  scope: Scope
  subject: SubjectRef
  /** Optional peers whose history consolidates into base rates / know-how. */
  cohort?: SubjectRef[]
}

/** The immutable result of one recall. Kept separate from the live world model. */
export interface MemoryRecall {
  scope: Scope
  subject: SubjectRef
  asOf: string
  episodic: EpisodicCase[]
  semantic: BaseRate[]
  procedural: ProceduralAssociation[]
  operatorContext: OperatorMemoryContext | null
  excluded: { episodicExcludedCount: number; cohortExcludedCount: number; reason: string }
  accounting: {
    totalEpisodic: number
    includedEpisodicCount: number
    cohortSize: number
    consolidatedCohortCount: number
  }
  isEmpty: boolean
}

export interface MemoryDeps {
  readNarrative?: typeof defaultReadNarrative
  readBeliefs?: typeof defaultReadBeliefs
  readBeliefVersions?: typeof defaultReadBeliefVersions
}

export interface RecallOptions {
  now?: Date
  decayPolicy?: DecayPolicy
  policy?: MemoryPolicy
  deps?: MemoryDeps
}

// ─────────────────────────────── pure helpers ───────────────────────────────

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
  }
  return value
}

function narrativeEpisode(r: NarrativeRecord): EpisodicCase {
  return {
    kind: 'narrative',
    subject: { subjectType: r.subjectType, subjectId: r.subjectId },
    label: r.kind,
    occurredAt: r.occurredAt,
    content: r.content,
    sourceRef: { type: 'narrative_floor', id: String(r.id) },
    provenance: null,
    version: null,
    confidence: null,
  }
}

function beliefChangeEpisode(subject: SubjectRef, key: string, v: BeliefVersion): EpisodicCase {
  return {
    kind: 'belief_change',
    subject,
    label: key,
    occurredAt: v.recordedAt,
    content: v.content,
    sourceRef: { type: 'belief_version', id: String(v.id) },
    provenance: { traceRefs: v.traceRefs, inferentialDistance: v.inferentialDistance },
    version: v.version,
    confidence: v.confidence,
  }
}

/** Most-recent-first, deterministic. Recall surfaces the relevant recent past. */
function orderRecent(a: EpisodicCase, z: EpisodicCase): number {
  if (a.occurredAt !== z.occurredAt) return a.occurredAt < z.occurredAt ? 1 : -1
  return a.sourceRef.id < z.sourceRef.id ? 1 : a.sourceRef.id > z.sourceRef.id ? -1 : 0
}

/** Consolidate a cohort's current beliefs into per-key base rates (priors). */
function consolidateSemantic(cohortBeliefs: StoredBelief[]): BaseRate[] {
  const byKey = new Map<string, { holds: number; total: number }>()
  for (const b of cohortBeliefs) {
    const agg = byKey.get(b.key) ?? { holds: 0, total: 0 }
    agg.total += 1
    if (b.decayedConfidence >= 0.5) agg.holds += 1
    byKey.set(b.key, agg)
  }
  return [...byKey.entries()]
    .sort((a, z) => (a[0] < z[0] ? -1 : 1))
    .map(([dimension, agg]) => ({ dimension, category: 'holds' as const, count: agg.holds, total: agg.total, rate: agg.holds / agg.total }))
}

/** Consolidate a cohort's current beliefs into per-key retained know-how. */
function consolidateProcedural(cohortBeliefs: StoredBelief[]): ProceduralAssociation[] {
  const byKey = new Map<string, StoredBelief[]>()
  for (const b of cohortBeliefs) {
    const list = byKey.get(b.key) ?? []
    list.push(b)
    byKey.set(b.key, list)
  }
  const modal = <T>(values: T[]): T => {
    const counts = new Map<T, number>()
    let best = values[0]
    let bestN = 0
    for (const v of values) {
      const n = (counts.get(v) ?? 0) + 1
      counts.set(v, n)
      if (n > bestN) {
        bestN = n
        best = v
      }
    }
    return best
  }
  return [...byKey.entries()]
    .sort((a, z) => (a[0] < z[0] ? -1 : 1))
    .map(([key, list]) => ({
      key,
      typicalUncertaintyKind: modal(list.map((b) => b.uncertaintyKind as UncertaintyKind)),
      typicalInferentialDistance: modal(list.map((b) => b.provenance.inferentialDistance)),
      contestedRate: list.filter((b) => b.evidenceFor.length > 0 && b.evidenceAgainst.length > 0).length / list.length,
      support: list.length,
    }))
}

// ─────────────────────────────── the recall entry ───────────────────────────

/**
 * Recall the relevant memory for one subject: its specific episodes, and — when a
 * cohort is given — consolidated base rates and retained know-how across peers.
 * Read-only; writes nothing; kept separate from the live world model.
 */
export async function recall(query: MemoryQuery, opts: RecallOptions = {}): Promise<MemoryRecall> {
  const now = opts.now ?? new Date()
  const asOf = now.toISOString()
  const policy = opts.policy ?? DEFAULT_MEMORY_POLICY
  const readOpts = { now, policy: opts.decayPolicy }
  const readNarrative = opts.deps?.readNarrative ?? defaultReadNarrative
  const readBeliefs = opts.deps?.readBeliefs ?? defaultReadBeliefs
  const readBeliefVersions = opts.deps?.readBeliefVersions ?? defaultReadBeliefVersions

  // — Episodic: the subject's own recorded narrative + belief-version history. —
  const narrative = await readNarrative(query.scope, query.subject)
  const subjectBeliefs = await readBeliefs(query.scope, query.subject, readOpts)
  const versionEpisodes: EpisodicCase[] = []
  for (const b of subjectBeliefs) {
    const versions = await readBeliefVersions(query.scope, b.id)
    for (const v of versions) versionEpisodes.push(beliefChangeEpisode(query.subject, b.key, v))
  }
  const allEpisodes = [...narrative.map(narrativeEpisode), ...versionEpisodes].sort(orderRecent)
  const episodic = allEpisodes.slice(0, policy.episodicCap)
  const episodicExcludedCount = Math.max(0, allEpisodes.length - policy.episodicCap)

  // — Semantic + Procedural: consolidated over a bounded cohort (priors + know-how). —
  const cohort = (query.cohort ?? []).slice(0, policy.cohortMemberCap)
  const cohortExcludedCount = Math.max(0, (query.cohort?.length ?? 0) - cohort.length)
  const cohortBeliefs: StoredBelief[] = []
  for (const member of cohort) {
    const beliefs = await readBeliefs(query.scope, member, readOpts)
    cohortBeliefs.push(...beliefs)
  }
  const semantic = consolidateSemantic(cohortBeliefs)
  const procedural = consolidateProcedural(cohortBeliefs)

  const recallResult: MemoryRecall = {
    scope: query.scope,
    subject: query.subject,
    asOf,
    episodic,
    semantic,
    procedural,
    operatorContext: null,
    excluded: {
      episodicExcludedCount,
      cohortExcludedCount,
      reason: 'bounded recall (episodic cap / cohort member cap) — full history remains in State Management',
    },
    accounting: {
      totalEpisodic: allEpisodes.length,
      includedEpisodicCount: episodic.length,
      cohortSize: query.cohort?.length ?? 0,
      consolidatedCohortCount: cohort.length,
    },
    isEmpty: episodic.length === 0 && semantic.length === 0 && procedural.length === 0,
  }
  return deepFreeze(recallResult)
}
