/**
 * Unit tests for the W2-M2 Memory Runtime (pure, no DB).
 * Runs under `test:unit` (VITEST_NO_DB=1): every test injects the State
 * Management read functions, so recall runs over hand-built episodic data with no
 * database. Proves the three distinct recall services (episodic / semantic /
 * procedural), bounded continuity with recorded exclusions, provenance
 * traceability, and that memory is never reduced to priors alone.
 */
import { describe, it, expect } from 'vitest'
import { recall, type MemoryDeps, type MemoryQuery } from '@/lib/ai/runtime/memory'
import type {
  Scope,
  SubjectRef,
  StoredBelief,
  NarrativeRecord,
  BeliefVersion,
  TraceRef,
  InferentialDistance,
  UncertaintyKind,
} from '@/db/ai/stateManagement'

const SCOPE: Scope = { agencyId: 7 }
const NOW = new Date('2026-07-14T00:00:00.000Z')
const SUBJECT: SubjectRef = { subjectType: 'lead', subjectId: '100' }
const trace = (id: string): TraceRef => ({ type: 'message', id })

function narr(id: number, kind: NarrativeRecord['kind'], occurredAt: string): NarrativeRecord {
  return { id, agencyId: 7, subjectType: 'lead', subjectId: '100', kind, content: { note: kind }, occurredAt, recordedAt: occurredAt }
}

function belief(o: { id?: number; key?: string; decayedConfidence?: number; uncertaintyKind?: UncertaintyKind; inferentialDistance?: InferentialDistance; evidenceFor?: TraceRef[]; evidenceAgainst?: TraceRef[] } = {}): StoredBelief {
  const distance = o.inferentialDistance ?? 'low'
  return {
    id: o.id ?? 1,
    agencyId: 7,
    subjectType: 'lead',
    subjectId: '100',
    key: o.key ?? 'intent',
    content: {},
    storedConfidence: o.decayedConfidence ?? 0.6,
    decayedConfidence: o.decayedConfidence ?? 0.6,
    groundedness: 0.6,
    calibratable: true,
    uncertaintyKind: o.uncertaintyKind ?? 'epistemic',
    evidenceFor: o.evidenceFor ?? [],
    evidenceAgainst: o.evidenceAgainst ?? [],
    isAbsenceDerived: false,
    version: 1,
    freshnessAt: NOW.toISOString(),
    ageMs: 0,
    isStale: false,
    provenance: { traceRefs: [trace('m1')], inferencePath: [], inferentialDistance: distance },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  }
}

function version(o: { id: number; beliefId: number; version: number; recordedAt: string; confidence?: number; traceRefs?: TraceRef[] }): BeliefVersion {
  return {
    id: o.id,
    beliefId: o.beliefId,
    agencyId: 7,
    version: o.version,
    content: { v: o.version },
    confidence: o.confidence ?? 0.6,
    groundedness: 0.6,
    calibratable: true,
    uncertaintyKind: 'epistemic',
    evidenceFor: [],
    evidenceAgainst: [],
    isAbsenceDerived: false,
    traceRefs: o.traceRefs ?? [trace('m1')],
    inferentialDistance: 'low',
    freshnessAt: o.recordedAt,
    recordedAt: o.recordedAt,
  }
}

function makeDeps(cfg: {
  narrative?: NarrativeRecord[]
  beliefsBySubject?: Record<string, StoredBelief[]>
  versionsByBelief?: Record<number, BeliefVersion[]>
}): MemoryDeps {
  return {
    readNarrative: async () => cfg.narrative ?? [],
    readBeliefs: async (_s, subject) => cfg.beliefsBySubject?.[subject.subjectId] ?? [],
    readBeliefVersions: async (_s, beliefId) => cfg.versionsByBelief?.[beliefId] ?? [],
  }
}

const q = (cohort?: SubjectRef[]): MemoryQuery => ({ scope: SCOPE, subject: SUBJECT, cohort })

describe('W2-M2 Memory — episodic recall (specific cases)', () => {
  it('recalls narrative and belief-change episodes, most-recent-first, traceable to source', async () => {
    const deps = makeDeps({
      narrative: [narr(1, 'promise', '2026-05-01T00:00:00.000Z'), narr(2, 'outcome', '2026-07-01T00:00:00.000Z')],
      beliefsBySubject: { '100': [belief({ id: 9, key: 'intent' })] },
      versionsByBelief: { 9: [version({ id: 900, beliefId: 9, version: 1, recordedAt: '2026-06-01T00:00:00.000Z', traceRefs: [trace('mv')] })] },
    })
    const r = await recall(q(), { now: NOW, deps })
    expect(r.episodic.map((e) => e.occurredAt)).toEqual([
      '2026-07-01T00:00:00.000Z',
      '2026-06-01T00:00:00.000Z',
      '2026-05-01T00:00:00.000Z',
    ])
    const beliefEp = r.episodic.find((e) => e.kind === 'belief_change')!
    expect(beliefEp.label).toBe('intent')
    expect(beliefEp.provenance!.traceRefs.map((t) => t.id)).toContain('mv') // provenance of remembered items
    expect(r.episodic.every((e) => e.sourceRef.id.length > 0)).toBe(true) // every case traceable
  })

  it('bounds episodic recall and records the exclusion (nothing lost)', async () => {
    const deps = makeDeps({
      narrative: [narr(1, 'history', '2026-01-01T00:00:00.000Z'), narr(2, 'history', '2026-02-01T00:00:00.000Z'), narr(3, 'history', '2026-03-01T00:00:00.000Z')],
    })
    const r = await recall(q(), { now: NOW, deps, policy: { episodicCap: 2, cohortMemberCap: 200 } })
    expect(r.accounting.totalEpisodic).toBe(3)
    expect(r.accounting.includedEpisodicCount).toBe(2)
    expect(r.excluded.episodicExcludedCount).toBe(1)
    expect(r.excluded.reason).toMatch(/remains in State Management/)
  })
})

describe('W2-M2 Memory — semantic base rates (priors) & procedural know-how', () => {
  it('consolidates per-key base rates across a cohort', async () => {
    const deps = makeDeps({
      beliefsBySubject: {
        a: [belief({ key: 'intent', decayedConfidence: 0.8 })],
        b: [belief({ key: 'intent', decayedConfidence: 0.9 })],
        c: [belief({ key: 'intent', decayedConfidence: 0.2 })], // does not hold
      },
    })
    const cohort: SubjectRef[] = [
      { subjectType: 'lead', subjectId: 'a' },
      { subjectType: 'lead', subjectId: 'b' },
      { subjectType: 'lead', subjectId: 'c' },
    ]
    const r = await recall(q(cohort), { now: NOW, deps })
    const intent = r.semantic.find((s) => s.dimension === 'intent')!
    expect(intent.total).toBe(3)
    expect(intent.count).toBe(2) // two of three hold
    expect(intent.rate).toBeCloseTo(2 / 3)
  })

  it('consolidates per-key retained know-how (modal uncertainty, distance, contested rate)', async () => {
    const deps = makeDeps({
      beliefsBySubject: {
        a: [belief({ key: 'objection', inferentialDistance: 'high', evidenceFor: [trace('x')], evidenceAgainst: [trace('y')] })],
        b: [belief({ key: 'objection', inferentialDistance: 'high' })],
      },
    })
    const cohort: SubjectRef[] = [
      { subjectType: 'lead', subjectId: 'a' },
      { subjectType: 'lead', subjectId: 'b' },
    ]
    const r = await recall(q(cohort), { now: NOW, deps })
    const proc = r.procedural.find((p) => p.key === 'objection')!
    expect(proc.typicalInferentialDistance).toBe('high')
    expect(proc.typicalUncertaintyKind).toBe('epistemic')
    expect(proc.contestedRate).toBeCloseTo(0.5) // one of two contested
    expect(proc.support).toBe(2)
  })

  it('never reduces memory to priors alone: episodic and semantic coexist', async () => {
    const deps = makeDeps({
      narrative: [narr(1, 'outcome', '2026-07-01T00:00:00.000Z')],
      beliefsBySubject: { '100': [], a: [belief({ key: 'intent', decayedConfidence: 0.8 })] },
    })
    const r = await recall(q([{ subjectType: 'lead', subjectId: 'a' }]), { now: NOW, deps })
    expect(r.episodic.length).toBeGreaterThan(0) // specific cases retained
    expect(r.semantic.length).toBeGreaterThan(0) // priors also present
  })
})

describe('W2-M2 Memory — no cohort, empty, immutability', () => {
  it('has no base rates without a cohort (a single case has no population)', async () => {
    const deps = makeDeps({ narrative: [narr(1, 'history', '2026-07-01T00:00:00.000Z')] })
    const r = await recall(q(), { now: NOW, deps })
    expect(r.semantic).toHaveLength(0)
    expect(r.procedural).toHaveLength(0)
    expect(r.episodic.length).toBe(1)
  })

  it('recalls an empty memory honestly', async () => {
    const r = await recall(q(), { now: NOW, deps: makeDeps({}) })
    expect(r.isEmpty).toBe(true)
    expect(r.episodic).toHaveLength(0)
  })

  it('returns a deeply immutable recall', async () => {
    const r = await recall(q(), { now: NOW, deps: makeDeps({ narrative: [narr(1, 'history', '2026-07-01T00:00:00.000Z')] }) })
    expect(Object.isFrozen(r)).toBe(true)
    expect(Object.isFrozen(r.episodic)).toBe(true)
    expect(() => {
      ;(r as { isEmpty: boolean }).isEmpty = true
    }).toThrow()
  })
})
