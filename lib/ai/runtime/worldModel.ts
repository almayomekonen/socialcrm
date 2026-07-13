import {
  readBeliefs,
  readNarrative,
  writeBelief,
  recordNarrative,
  type Scope,
  type SubjectRef,
  type StoredBelief,
  type NarrativeRecord,
  type NarrativeKind,
  type UncertaintyKind,
  type TraceRef,
  type ProvenanceInput,
} from '@/db/ai/stateManagement'
import type { DecayPolicy } from '@/db/ai/decay'

export interface WorldModelReadOpts {
  now?: Date
  policy?: DecayPolicy
}

export interface NarrativeByKind {
  history: NarrativeRecord[]
  promise: NarrativeRecord[]
  outcome: NarrativeRecord[]
}

export interface RelationshipWorldModel {
  scope: Scope
  subject: SubjectRef
  beliefs: StoredBelief[]
  beliefsByKey: Record<string, StoredBelief>
  narrative: NarrativeRecord[]
  narrativeByKind: NarrativeByKind
  asOf: string
  isEmpty: boolean
}

export interface PortfolioWorldModel {
  scope: Scope
  portfolioId: string
  beliefs: StoredBelief[]
  beliefsByKey: Record<string, StoredBelief>
  narrative: NarrativeRecord[]
  narrativeByKind: NarrativeByKind
  members: RelationshipWorldModel[]
  memberCount: number
  asOf: string
  isEmpty: boolean
}

export interface RelationshipBeliefInput {
  key: string
  content: Record<string, unknown>
  confidence: number
  groundedness: number
  calibratable?: boolean
  uncertaintyKind?: UncertaintyKind
  evidenceFor?: TraceRef[]
  evidenceAgainst?: TraceRef[]
  isAbsenceDerived?: boolean
  provenance: ProvenanceInput
  freshnessAt?: Date
}

/** A fully-formed belief update at portfolio scale. */
export type PortfolioBeliefInput = RelationshipBeliefInput

/** A narrative-floor entry for a relationship. */
export interface RelationshipNarrativeInput {
  kind: NarrativeKind
  content: Record<string, unknown>
  occurredAt?: Date
}

/** An immutable, point-in-time capture of a world model. */
export interface WorldModelSnapshot<T> {
  snapshotAt: string
  signature: string
  model: T
}

// ─────────────────────────────── helpers ────────────────────────────────

const EMPTY_KINDS: NarrativeKind[] = ['history', 'promise', 'outcome']

function groupNarrative(records: NarrativeRecord[]): NarrativeByKind {
  const out: NarrativeByKind = { history: [], promise: [], outcome: [] }
  for (const r of records) {
    // Kinds are constrained by M1's CHECK; guard defensively without inventing kinds.
    if (EMPTY_KINDS.includes(r.kind)) out[r.kind].push(r)
  }
  return out
}

function indexByKey(beliefs: StoredBelief[]): Record<string, StoredBelief> {
  const map: Record<string, StoredBelief> = {}
  for (const b of beliefs) map[b.key] = b
  return map
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

// ──────────────────────────── read (hydration) ───────────────────────────

export async function hydrateRelationship(
  scope: Scope,
  subjectId: string,
  opts: WorldModelReadOpts = {},
): Promise<RelationshipWorldModel> {
  const now = opts.now ?? new Date()
  const subject: SubjectRef = { subjectType: 'lead', subjectId }
  const readOpts = { now, policy: opts.policy }
  const beliefs = await readBeliefs(scope, subject, readOpts)
  const narrative = await readNarrative(scope, subject)
  return {
    scope,
    subject,
    beliefs,
    beliefsByKey: indexByKey(beliefs),
    narrative,
    narrativeByKind: groupNarrative(narrative),
    asOf: now.toISOString(),
    isEmpty: beliefs.length === 0 && narrative.length === 0,
  }
}

export async function hydrateRelationships(
  scope: Scope,
  subjectIds: string[],
  opts: WorldModelReadOpts = {},
): Promise<RelationshipWorldModel[]> {
  const now = opts.now ?? new Date()
  const pinned = { now, policy: opts.policy }
  return Promise.all(subjectIds.map((id) => hydrateRelationship(scope, id, pinned)))
}

export async function hydratePortfolio(
  scope: Scope,
  portfolioId: string,
  memberSubjectIds: string[],
  opts: WorldModelReadOpts = {},
): Promise<PortfolioWorldModel> {
  const now = opts.now ?? new Date()
  const pinned = { now, policy: opts.policy }
  const subject: SubjectRef = { subjectType: 'portfolio', subjectId: portfolioId }
  const beliefs = await readBeliefs(scope, subject, pinned)
  const narrative = await readNarrative(scope, subject)
  const members = await hydrateRelationships(scope, memberSubjectIds, pinned)
  return {
    scope,
    portfolioId,
    beliefs,
    beliefsByKey: indexByKey(beliefs),
    narrative,
    narrativeByKind: groupNarrative(narrative),
    members,
    memberCount: members.length,
    asOf: now.toISOString(),
    isEmpty: beliefs.length === 0 && narrative.length === 0 && members.length === 0,
  }
}

// ─────────────────────────── write (update pipeline) ─────────────────────

export async function applyRelationshipBelief(
  scope: Scope,
  subjectId: string,
  belief: RelationshipBeliefInput,
  opts: WorldModelReadOpts = {},
): Promise<RelationshipWorldModel> {
  await writeBelief({ agencyId: scope.agencyId, subjectType: 'lead', subjectId, ...belief })
  return hydrateRelationship(scope, subjectId, opts)
}

export async function applyPortfolioBelief(
  scope: Scope,
  portfolioId: string,
  belief: PortfolioBeliefInput,
): Promise<StoredBelief> {
  return writeBelief({ agencyId: scope.agencyId, subjectType: 'portfolio', subjectId: portfolioId, ...belief })
}

export async function recordRelationshipNarrative(
  scope: Scope,
  subjectId: string,
  narrative: RelationshipNarrativeInput,
): Promise<NarrativeRecord> {
  return recordNarrative({ agencyId: scope.agencyId, subjectType: 'lead', subjectId, ...narrative })
}

// ─────────────────────────── consistency & snapshots ─────────────────────

export function worldModelSignature(model: RelationshipWorldModel | PortfolioWorldModel): string {
  const rel = (m: RelationshipWorldModel): string => {
    const b = m.beliefs
      .map((x) => `${x.key}@${x.version}`)
      .sort()
      .join(',')
    const n = m.narrative
      .map((x) => x.id)
      .sort((a, z) => a - z)
      .join(',')
    return `R(${m.subject.subjectId})[b:${b}][n:${n}]`
  }
  if ('portfolioId' in model) {
    const own = (() => {
      const b = model.beliefs
        .map((x) => `${x.key}@${x.version}`)
        .sort()
        .join(',')
      const n = model.narrative
        .map((x) => x.id)
        .sort((a, z) => a - z)
        .join(',')
      return `[b:${b}][n:${n}]`
    })()
    const members = model.members.map(rel).sort().join(';')
    return `P(${model.portfolioId})${own}{${members}}`
  }
  return rel(model)
}

export function snapshotRelationship(model: RelationshipWorldModel): WorldModelSnapshot<RelationshipWorldModel> {
  return deepFreeze({ snapshotAt: model.asOf, signature: worldModelSignature(model), model })
}

export function snapshotPortfolio(model: PortfolioWorldModel): WorldModelSnapshot<PortfolioWorldModel> {
  return deepFreeze({ snapshotAt: model.asOf, signature: worldModelSignature(model), model })
}
