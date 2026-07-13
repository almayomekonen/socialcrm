import { db } from '@/config/db'
import type { Knex } from 'knex'
import { decayConfidence, DEFAULT_DECAY_POLICY, type DecayPolicy } from './decay'

export type SubjectType = 'lead' | 'portfolio'
export type UncertaintyKind = 'epistemic' | 'aleatoric'
export type InferentialDistance = 'low' | 'medium' | 'high'
export type NarrativeKind = 'history' | 'promise' | 'outcome'

export interface Scope {
  agencyId: number
}

export interface SubjectRef {
  subjectType: SubjectType
  subjectId: string
}

export interface TraceRef {
  type: string
  id: string
  [k: string]: unknown
}

export interface InferenceStep {
  step: string
  [k: string]: unknown
}

export interface ProvenanceInput {
  traceRefs: TraceRef[]
  inferencePath?: InferenceStep[]
  inferentialDistance: InferentialDistance
}

export interface ProvenanceView {
  traceRefs: TraceRef[]
  inferencePath: InferenceStep[]
  inferentialDistance: InferentialDistance
}

export interface BeliefWriteInput extends Scope, SubjectRef {
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

export interface StoredBelief extends SubjectRef {
  id: number
  agencyId: number
  key: string
  content: Record<string, unknown>
  storedConfidence: number
  decayedConfidence: number
  groundedness: number
  calibratable: boolean
  uncertaintyKind: UncertaintyKind
  evidenceFor: TraceRef[]
  evidenceAgainst: TraceRef[]
  isAbsenceDerived: boolean
  version: number
  freshnessAt: string
  ageMs: number
  isStale: boolean
  provenance: ProvenanceView
  createdAt: string
  updatedAt: string
}

export interface BeliefVersion extends ProvenanceMini {
  id: number
  beliefId: number
  agencyId: number
  version: number
  content: Record<string, unknown>
  confidence: number
  groundedness: number
  calibratable: boolean
  uncertaintyKind: UncertaintyKind
  evidenceFor: TraceRef[]
  evidenceAgainst: TraceRef[]
  isAbsenceDerived: boolean
  freshnessAt: string
  recordedAt: string
}

interface ProvenanceMini {
  traceRefs: TraceRef[]
  inferentialDistance: InferentialDistance
}

export interface NarrativeInput extends Scope, SubjectRef {
  kind: NarrativeKind
  content: Record<string, unknown>
  occurredAt?: Date
}

export interface NarrativeRecord extends SubjectRef {
  id: number
  agencyId: number
  kind: NarrativeKind
  content: Record<string, unknown>
  occurredAt: string
  recordedAt: string
}

export interface ReadOpts {
  now?: Date
  policy?: DecayPolicy
}

// ─────────────────────────────── helpers ────────────────────────────────

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString()
  return new Date(v as string).toISOString()
}

function toDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(v as string)
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T
    } catch {
      return fallback
    }
  }
  return v as T
}

function assertUnit(name: string, n: number): void {
  if (typeof n !== 'number' || Number.isNaN(n) || n < 0 || n > 1) {
    throw new RangeError(`State Management: ${name} must be a number in [0,1], got ${String(n)}`)
  }
}

const DISTANCES: readonly InferentialDistance[] = ['low', 'medium', 'high']

function normalizeProvenanceInput(p: ProvenanceInput, isAbsenceDerived: boolean): ProvenanceInput {
  if (!p || !Array.isArray(p.traceRefs)) {
    throw new TypeError('State Management: a belief requires a provenance with traceRefs')
  }
  if (!DISTANCES.includes(p.inferentialDistance)) {
    throw new RangeError(`State Management: inferentialDistance must be one of ${DISTANCES.join('|')}`)
  }
  if (!isAbsenceDerived && p.traceRefs.length === 0) {
    throw new Error('State Management: a non-absence belief must reference at least one trace')
  }
  return { traceRefs: p.traceRefs, inferencePath: p.inferencePath ?? [], inferentialDistance: p.inferentialDistance }
}

function mapBelief(row: Record<string, unknown>, provenance: ProvenanceView, now: Date, policy: DecayPolicy): StoredBelief {
  const storedConfidence = Number(row.confidence)
  const freshnessDate = toDate(row.freshnessAt)
  const decay = decayConfidence(storedConfidence, freshnessDate, now, policy)
  return {
    id: Number(row.id),
    agencyId: Number(row.agencyId),
    subjectType: row.subjectType as SubjectType,
    subjectId: String(row.subjectId),
    key: String(row.key),
    content: parseJson<Record<string, unknown>>(row.content, {}),
    storedConfidence,
    decayedConfidence: decay.decayedConfidence,
    groundedness: Number(row.groundedness),
    calibratable: Boolean(row.calibratable),
    uncertaintyKind: row.uncertaintyKind as UncertaintyKind,
    evidenceFor: parseJson<TraceRef[]>(row.evidenceFor, []),
    evidenceAgainst: parseJson<TraceRef[]>(row.evidenceAgainst, []),
    isAbsenceDerived: Boolean(row.isAbsenceDerived),
    version: Number(row.version),
    freshnessAt: toIso(row.freshnessAt),
    ageMs: decay.ageMs,
    isStale: decay.isStale,
    provenance,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  }
}

async function loadProvenance(
  runner: Knex | Knex.Transaction,
  agencyId: number,
  beliefIds: number[],
): Promise<Map<number, ProvenanceView>> {
  const map = new Map<number, ProvenanceView>()
  if (beliefIds.length === 0) return map
  const rows = await runner('ai_provenance').where({ agencyId }).whereIn('beliefId', beliefIds)
  for (const r of rows as Record<string, unknown>[]) {
    map.set(Number(r.beliefId), {
      traceRefs: parseJson<TraceRef[]>(r.traceRefs, []),
      inferencePath: parseJson<InferenceStep[]>(r.inferencePath, []),
      inferentialDistance: r.inferentialDistance as InferentialDistance,
    })
  }
  return map
}

// ───────────────────────────── belief writes ─────────────────────────────

export async function writeBelief(input: BeliefWriteInput): Promise<StoredBelief> {
  assertUnit('confidence', input.confidence)
  assertUnit('groundedness', input.groundedness)
  const isAbsenceDerived = input.isAbsenceDerived ?? false
  const provenance = normalizeProvenanceInput(input.provenance, isAbsenceDerived)

  const calibratable = input.calibratable ?? true
  const uncertaintyKind: UncertaintyKind = input.uncertaintyKind ?? 'epistemic'
  const evidenceFor = input.evidenceFor ?? []
  const evidenceAgainst = input.evidenceAgainst ?? []
  const freshnessAt = input.freshnessAt ?? new Date()

  const now = new Date()

  return db.transaction(async (trx) => {
    const shared = {
      content: JSON.stringify(input.content ?? {}),
      confidence: input.confidence,
      groundedness: input.groundedness,
      calibratable,
      uncertaintyKind,
      evidenceFor: JSON.stringify(evidenceFor),
      evidenceAgainst: JSON.stringify(evidenceAgainst),
      isAbsenceDerived,
      freshnessAt,
    }

    const inserted = await trx('ai_beliefs')
      .insert({
        agencyId: input.agencyId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        key: input.key,
        version: 1,
        updatedAt: trx.fn.now(),
        ...shared,
      })
      .onConflict(['agencyId', 'subjectType', 'subjectId', 'key'])
      .merge({
        ...shared,
        version: trx.raw('ai_beliefs.version + 1'),
        updatedAt: trx.fn.now(),
      })
      .returning('*')

    const row = inserted[0] as Record<string, unknown>
    const beliefId = Number(row.id)

    await trx('ai_provenance')
      .insert({
        beliefId,
        agencyId: input.agencyId,
        traceRefs: JSON.stringify(provenance.traceRefs),
        inferencePath: JSON.stringify(provenance.inferencePath ?? []),
        inferentialDistance: provenance.inferentialDistance,
        updatedAt: trx.fn.now(),
      })
      .onConflict('beliefId')
      .merge({
        traceRefs: JSON.stringify(provenance.traceRefs),
        inferencePath: JSON.stringify(provenance.inferencePath ?? []),
        inferentialDistance: provenance.inferentialDistance,
        updatedAt: trx.fn.now(),
      })

    await trx('ai_belief_versions').insert({
      beliefId,
      agencyId: input.agencyId,
      version: Number(row.version),
      content: JSON.stringify(input.content ?? {}),
      confidence: input.confidence,
      groundedness: input.groundedness,
      calibratable,
      uncertaintyKind,
      evidenceFor: JSON.stringify(evidenceFor),
      evidenceAgainst: JSON.stringify(evidenceAgainst),
      isAbsenceDerived,
      traceRefs: JSON.stringify(provenance.traceRefs),
      inferentialDistance: provenance.inferentialDistance,
      freshnessAt,
    })

    return mapBelief(
      row,
      {
        traceRefs: provenance.traceRefs,
        inferencePath: provenance.inferencePath ?? [],
        inferentialDistance: provenance.inferentialDistance,
      },
      now,
      DEFAULT_DECAY_POLICY,
    )
  })
}

export async function refreshFreshness(scope: Scope, beliefId: number, at?: Date): Promise<StoredBelief | null> {
  const freshnessAt = at ?? new Date()
  const now = new Date()
  return db.transaction(async (trx) => {
    const updated = await trx('ai_beliefs')
      .where({ id: beliefId, agencyId: scope.agencyId })
      .update({ freshnessAt, version: trx.raw('version + 1'), updatedAt: trx.fn.now() })
      .returning('*')
    if (updated.length === 0) return null
    const row = updated[0] as Record<string, unknown>

    const prov = (await loadProvenance(trx, scope.agencyId, [beliefId])).get(beliefId) ?? {
      traceRefs: [],
      inferencePath: [],
      inferentialDistance: 'low' as InferentialDistance,
    }

    await trx('ai_belief_versions').insert({
      beliefId,
      agencyId: scope.agencyId,
      version: Number(row.version),
      content: JSON.stringify(parseJson<Record<string, unknown>>(row.content, {})),
      confidence: Number(row.confidence),
      groundedness: Number(row.groundedness),
      calibratable: Boolean(row.calibratable),
      uncertaintyKind: row.uncertaintyKind as UncertaintyKind,
      evidenceFor: JSON.stringify(parseJson<TraceRef[]>(row.evidenceFor, [])),
      evidenceAgainst: JSON.stringify(parseJson<TraceRef[]>(row.evidenceAgainst, [])),
      isAbsenceDerived: Boolean(row.isAbsenceDerived),
      traceRefs: JSON.stringify(prov.traceRefs),
      inferentialDistance: prov.inferentialDistance,
      freshnessAt,
    })

    return mapBelief(row, prov, now, DEFAULT_DECAY_POLICY)
  })
}

// ───────────────────────────── belief reads ──────────────────────────────

export async function readBelief(
  scope: Scope,
  subject: SubjectRef,
  key: string,
  opts: ReadOpts = {},
): Promise<StoredBelief | null> {
  const row = (await db('ai_beliefs')
    .where({ agencyId: scope.agencyId, subjectType: subject.subjectType, subjectId: subject.subjectId, key })
    .first()) as Record<string, unknown> | undefined
  if (!row) return null
  const prov = (await loadProvenance(db, scope.agencyId, [Number(row.id)])).get(Number(row.id)) ?? {
    traceRefs: [],
    inferencePath: [],
    inferentialDistance: 'low' as InferentialDistance,
  }
  return mapBelief(row, prov, opts.now ?? new Date(), opts.policy ?? DEFAULT_DECAY_POLICY)
}

export async function readBeliefs(scope: Scope, subject: SubjectRef, opts: ReadOpts = {}): Promise<StoredBelief[]> {
  const rows = (await db('ai_beliefs')
    .where({ agencyId: scope.agencyId, subjectType: subject.subjectType, subjectId: subject.subjectId })
    .orderBy('key')) as Record<string, unknown>[]
  const provMap = await loadProvenance(
    db,
    scope.agencyId,
    rows.map((r) => Number(r.id)),
  )
  const now = opts.now ?? new Date()
  const policy = opts.policy ?? DEFAULT_DECAY_POLICY
  return rows.map((r) =>
    mapBelief(r, provMap.get(Number(r.id)) ?? { traceRefs: [], inferencePath: [], inferentialDistance: 'low' }, now, policy),
  )
}

export async function readBeliefVersions(scope: Scope, beliefId: number): Promise<BeliefVersion[]> {
  const rows = (await db('ai_belief_versions')
    .where({ agencyId: scope.agencyId, beliefId })
    .orderBy('version', 'desc')) as Record<string, unknown>[]
  return rows.map((r) => ({
    id: Number(r.id),
    beliefId: Number(r.beliefId),
    agencyId: Number(r.agencyId),
    version: Number(r.version),
    content: parseJson<Record<string, unknown>>(r.content, {}),
    confidence: Number(r.confidence),
    groundedness: Number(r.groundedness),
    calibratable: Boolean(r.calibratable),
    uncertaintyKind: r.uncertaintyKind as UncertaintyKind,
    evidenceFor: parseJson<TraceRef[]>(r.evidenceFor, []),
    evidenceAgainst: parseJson<TraceRef[]>(r.evidenceAgainst, []),
    isAbsenceDerived: Boolean(r.isAbsenceDerived),
    traceRefs: parseJson<TraceRef[]>(r.traceRefs, []),
    inferentialDistance: r.inferentialDistance as InferentialDistance,
    freshnessAt: toIso(r.freshnessAt),
    recordedAt: toIso(r.recordedAt),
  }))
}

export async function listStaleBeliefs(scope: Scope, opts: ReadOpts = {}): Promise<StoredBelief[]> {
  const now = opts.now ?? new Date()
  const policy = opts.policy ?? DEFAULT_DECAY_POLICY
  const cutoff = new Date(now.getTime() - policy.staleAfterMs)
  const rows = (await db('ai_beliefs')
    .where({ agencyId: scope.agencyId })
    .where('freshnessAt', '<=', cutoff)
    .orderBy('freshnessAt', 'asc')) as Record<string, unknown>[]
  const provMap = await loadProvenance(
    db,
    scope.agencyId,
    rows.map((r) => Number(r.id)),
  )
  return rows.map((r) =>
    mapBelief(r, provMap.get(Number(r.id)) ?? { traceRefs: [], inferencePath: [], inferentialDistance: 'low' }, now, policy),
  )
}

// ─────────────────────────── narrative floor ────────────────────────────

export async function recordNarrative(input: NarrativeInput): Promise<NarrativeRecord> {
  const occurredAt = input.occurredAt ?? new Date()
  const inserted = await db('ai_narrative_floor')
    .insert({
      agencyId: input.agencyId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      kind: input.kind,
      content: JSON.stringify(input.content ?? {}),
      occurredAt,
    })
    .returning('*')
  const r = inserted[0] as Record<string, unknown>
  return {
    id: Number(r.id),
    agencyId: Number(r.agencyId),
    subjectType: r.subjectType as SubjectType,
    subjectId: String(r.subjectId),
    kind: r.kind as NarrativeKind,
    content: parseJson<Record<string, unknown>>(r.content, {}),
    occurredAt: toIso(r.occurredAt),
    recordedAt: toIso(r.recordedAt),
  }
}

/** Read a subject's narrative floor, oldest first. Scoped. */
export async function readNarrative(scope: Scope, subject: SubjectRef): Promise<NarrativeRecord[]> {
  const rows = (await db('ai_narrative_floor')
    .where({ agencyId: scope.agencyId, subjectType: subject.subjectType, subjectId: subject.subjectId })
    .orderBy('occurredAt', 'asc')) as Record<string, unknown>[]
  return rows.map((r) => ({
    id: Number(r.id),
    agencyId: Number(r.agencyId),
    subjectType: r.subjectType as SubjectType,
    subjectId: String(r.subjectId),
    kind: r.kind as NarrativeKind,
    content: parseJson<Record<string, unknown>>(r.content, {}),
    occurredAt: toIso(r.occurredAt),
    recordedAt: toIso(r.recordedAt),
  }))
}

// ─────────────────────────────── pruning ─────────────────────────────────

export interface PruneOpts {
  /** How many most-recent version snapshots to retain per belief. Default 20. */
  keepVersionsPerBelief?: number
}

export async function pruneBeliefVersions(scope: Scope, opts: PruneOpts = {}): Promise<{ deletedVersions: number }> {
  const keep = Math.max(1, opts.keepVersionsPerBelief ?? 20)
  const beliefs = (await db('ai_beliefs').where({ agencyId: scope.agencyId }).select('id')) as { id: unknown }[]
  let deletedVersions = 0
  for (const b of beliefs) {
    const beliefId = Number(b.id)
    const survivors = (await db('ai_belief_versions')
      .where({ agencyId: scope.agencyId, beliefId })
      .orderBy('version', 'desc')
      .limit(keep)
      .select('id')) as { id: unknown }[]
    const keepIds = survivors.map((s) => Number(s.id))
    const q = db('ai_belief_versions').where({ agencyId: scope.agencyId, beliefId })
    if (keepIds.length > 0) q.whereNotIn('id', keepIds)
    deletedVersions += await q.del()
  }
  return { deletedVersions }
}
