/**
 * Unit tests for the W2-M1 Context Assembly Runtime (pure, no DB).
 * Runs under `test:unit` (VITEST_NO_DB=1): every test calls the pure entry
 * points (`assembleFromRelationship` / `assembleFromPortfolio`) over hand-built
 * World Model literals. Proves epistemic bounding, trigger-relevance ordering,
 * uncertainty/provenance preservation, complete exclusion accounting, and
 * immutability — with no inference, ranking, or belief mutation.
 */
import { describe, it, expect } from 'vitest'
import {
  assembleFromRelationship,
  assembleFromPortfolio,
  DEFAULT_ASSEMBLY_POLICY,
  type AssemblyPolicy,
} from '@/lib/ai/runtime/contextAssembly'
import type { CognitionRequest, AdmissionReason, CognitionTier } from '@/lib/ai/runtime/scheduler'
import type { RelationshipWorldModel, PortfolioWorldModel } from '@/lib/ai/runtime/worldModel'
import type {
  StoredBelief,
  NarrativeRecord,
  TraceRef,
  InferentialDistance,
  UncertaintyKind,
  Scope,
} from '@/db/ai/stateManagement'

const SCOPE: Scope = { agencyId: 7 }
const ASOF = '2026-07-14T00:00:00.000Z'
const trace = (id: string): TraceRef => ({ type: 'message', id })

interface BeliefOverrides {
  key?: string
  ageMs?: number
  isStale?: boolean
  confidence?: number
  groundedness?: number
  calibratable?: boolean
  uncertaintyKind?: UncertaintyKind
  inferentialDistance?: InferentialDistance
  evidenceFor?: TraceRef[]
  evidenceAgainst?: TraceRef[]
  traceRefs?: TraceRef[]
}

function belief(o: BeliefOverrides = {}): StoredBelief {
  const distance = o.inferentialDistance ?? 'low'
  const ageMs = o.ageMs ?? 0
  return {
    id: 1,
    agencyId: SCOPE.agencyId,
    subjectType: 'lead',
    subjectId: '100',
    key: o.key ?? 'intent',
    content: {},
    storedConfidence: o.confidence ?? 0.6,
    decayedConfidence: o.confidence ?? 0.6,
    groundedness: o.groundedness ?? 0.6,
    calibratable: o.calibratable ?? true,
    uncertaintyKind: o.uncertaintyKind ?? 'epistemic',
    evidenceFor: o.evidenceFor ?? [],
    evidenceAgainst: o.evidenceAgainst ?? [],
    isAbsenceDerived: false,
    version: 1,
    freshnessAt: new Date(new Date(ASOF).getTime() - ageMs).toISOString(),
    ageMs,
    isStale: o.isStale ?? false,
    provenance: { traceRefs: o.traceRefs ?? [trace('m1')], inferencePath: [], inferentialDistance: distance },
    createdAt: ASOF,
    updatedAt: ASOF,
  }
}

function narrative(id: number, kind: NarrativeRecord['kind'], occurredAt: string): NarrativeRecord {
  return { id, agencyId: SCOPE.agencyId, subjectType: 'lead', subjectId: '100', kind, content: {}, occurredAt, recordedAt: occurredAt }
}

function relModel(beliefs: StoredBelief[], narr: NarrativeRecord[] = [], scope: Scope = SCOPE): RelationshipWorldModel {
  const beliefsByKey: Record<string, StoredBelief> = {}
  for (const b of beliefs) beliefsByKey[b.key] = b
  return {
    scope,
    subject: { subjectType: 'lead', subjectId: '100' },
    beliefs,
    beliefsByKey,
    narrative: narr,
    narrativeByKind: { history: [], promise: [], outcome: [] },
    asOf: ASOF,
    isEmpty: beliefs.length === 0 && narr.length === 0,
  }
}

function req(reason: AdmissionReason, tier: CognitionTier = 2): CognitionRequest {
  return { scope: SCOPE, subject: { subjectType: 'lead', subjectId: '100' }, tier, reason, admittedAt: ASOF }
}

const smallPolicy: AssemblyPolicy = {
  beliefCapByTier: { 1: 1, 2: 2 },
  narrativeCapByTier: { 1: 1, 2: 2 },
  memberReferenceCap: 2,
}

describe('W2-M1 Context Assembly — bounding & exclusion accounting', () => {
  it('includes everything under the cap and excludes nothing', () => {
    const pkg = assembleFromRelationship(req('inbound'), relModel([belief({ key: 'a' }), belief({ key: 'b' })]))
    expect(pkg.accounting.includedBeliefCount).toBe(2)
    expect(pkg.excludedBeliefs).toHaveLength(0)
    expect(pkg.isEmpty).toBe(false)
    expect(pkg.scale).toBe('relationship')
  })

  it('bounds the working set at the tier cap and records every exclusion — nothing disappears', () => {
    const beliefs = [belief({ key: 'a' }), belief({ key: 'b' }), belief({ key: 'c' }), belief({ key: 'd' })]
    const pkg = assembleFromRelationship(req('inbound'), relModel(beliefs), { policy: smallPolicy })
    expect(pkg.policy.beliefCap).toBe(2)
    expect(pkg.accounting.includedBeliefCount).toBe(2)
    expect(pkg.accounting.excludedBeliefCount).toBe(2)
    // included + excluded fully accounts for the total; nothing is lost.
    expect(pkg.includedBeliefs.length + pkg.excludedBeliefs.length).toBe(pkg.accounting.totalBeliefs)
    expect(pkg.excludedBeliefs.every((e) => e.reason === 'working_set_cap')).toBe(true)
  })

  it('drives the cap from the Scheduler tier (attention ration, not value)', () => {
    const beliefs = [belief({ key: 'a' }), belief({ key: 'b' }), belief({ key: 'c' })]
    const t1 = assembleFromRelationship(req('coverage_sweep', 1), relModel(beliefs), { policy: smallPolicy })
    const t2 = assembleFromRelationship(req('inbound', 2), relModel(beliefs), { policy: smallPolicy })
    expect(t1.accounting.includedBeliefCount).toBe(1)
    expect(t2.accounting.includedBeliefCount).toBe(2)
  })
})

describe('W2-M1 Context Assembly — trigger-relevance temporal ordering', () => {
  it('a staleness episode keeps the stalest region in-bounds', () => {
    const beliefs = [belief({ key: 'fresh', ageMs: 100 }), belief({ key: 'mid', ageMs: 200 }), belief({ key: 'stale', ageMs: 300 })]
    const pkg = assembleFromRelationship(req('staleness', 1), relModel(beliefs), { policy: { ...smallPolicy, beliefCapByTier: { 1: 2, 2: 2 } } })
    expect(pkg.includedBeliefs.map((b) => b.key)).toEqual(['stale', 'mid'])
    expect(pkg.excludedBeliefs.map((e) => e.belief.key)).toEqual(['fresh'])
  })

  it('every other trigger keeps the freshest region in-bounds', () => {
    const beliefs = [belief({ key: 'fresh', ageMs: 100 }), belief({ key: 'mid', ageMs: 200 }), belief({ key: 'stale', ageMs: 300 })]
    const pkg = assembleFromRelationship(req('inbound', 2), relModel(beliefs), { policy: { ...smallPolicy, beliefCapByTier: { 1: 2, 2: 2 } } })
    expect(pkg.includedBeliefs.map((b) => b.key)).toEqual(['fresh', 'mid'])
    expect(pkg.excludedBeliefs.map((e) => e.belief.key)).toEqual(['stale'])
  })
})

describe('W2-M1 Context Assembly — preserves uncertainty, evidence & provenance', () => {
  it('carries an included belief whole: both evidence sides, confidence, distance, provenance', () => {
    const b = belief({
      key: 'intent',
      confidence: 0.55,
      groundedness: 0.7,
      inferentialDistance: 'high',
      evidenceFor: [trace('m1'), trace('m2')],
      evidenceAgainst: [trace('m3')],
      traceRefs: [trace('m1')],
    })
    const pkg = assembleFromRelationship(req('inbound'), relModel([b]))
    const got = pkg.includedBeliefs[0]
    expect(got.evidenceFor).toHaveLength(2)
    expect(got.evidenceAgainst).toHaveLength(1) // competing evidence never collapsed
    expect(got.decayedConfidence).toBe(0.55) // uncertainty never removed
    expect(got.groundedness).toBe(0.7)
    expect(got.provenance.inferentialDistance).toBe('high') // distance preserved
    expect(got.provenance.traceRefs.map((t) => t.id)).toContain('m1')
  })

  it('summarizes uncertainty without resolving it', () => {
    const pkg = assembleFromRelationship(
      req('inbound'),
      relModel([
        belief({ key: 'a', calibratable: false }),
        belief({ key: 'b', inferentialDistance: 'high' }),
        belief({ key: 'c', uncertaintyKind: 'aleatoric' }),
        belief({ key: 'd', evidenceFor: [trace('x')], evidenceAgainst: [trace('y')] }),
      ]),
    )
    expect(pkg.uncertainty.anyUncalibratable).toBe(true)
    expect(pkg.uncertainty.anyHighInference).toBe(true)
    expect(pkg.uncertainty.anyAleatoric).toBe(true)
    expect(pkg.uncertainty.anyContested).toBe(true)
  })

  it('keeps every excluded belief explainable and fully traceable', () => {
    const beliefs = [belief({ key: 'a', ageMs: 10 }), belief({ key: 'b', ageMs: 20, traceRefs: [trace('mz')] }), belief({ key: 'c', ageMs: 30 })]
    const pkg = assembleFromRelationship(req('inbound'), relModel(beliefs), { policy: { ...smallPolicy, beliefCapByTier: { 1: 1, 2: 1 } } })
    expect(pkg.excludedBeliefs.length).toBeGreaterThan(0)
    const ex = pkg.excludedBeliefs.find((e) => e.belief.key === 'b')!
    expect(ex.reason).toBe('working_set_cap')
    expect(ex.detail.length).toBeGreaterThan(0)
    expect(ex.belief.provenance.traceRefs.map((t) => t.id)).toContain('mz') // still traceable
  })
})

describe('W2-M1 Context Assembly — narrative, portfolio, empty & scope', () => {
  it('bounds the working narrative most-recent-first without touching the floor', () => {
    const narr = [
      narrative(1, 'history', '2026-01-01T00:00:00.000Z'),
      narrative(2, 'promise', '2026-05-01T00:00:00.000Z'),
      narrative(3, 'outcome', '2026-07-01T00:00:00.000Z'),
    ]
    const pkg = assembleFromRelationship(req('inbound'), relModel([belief()], narr), { policy: smallPolicy })
    expect(pkg.includedNarrative.map((n) => n.id)).toEqual([3, 2]) // most recent first
    expect(pkg.excludedNarrativeCount).toBe(1)
    expect(pkg.accounting.totalNarrative).toBe(3)
  })

  it('assembles a portfolio: own beliefs bounded, members carried as id-ordered references, never ranked', () => {
    const members: RelationshipWorldModel[] = [
      relModel([belief({ key: 'x' })]),
      relModel([belief({ key: 'y' })]),
      relModel([belief({ key: 'z' })]),
    ]
    members[0].subject = { subjectType: 'lead', subjectId: 'c' }
    members[1].subject = { subjectType: 'lead', subjectId: 'a' }
    members[2].subject = { subjectType: 'lead', subjectId: 'b' }
    const port: PortfolioWorldModel = {
      scope: SCOPE,
      portfolioId: 'segment:new',
      beliefs: [belief({ key: 'health' })],
      beliefsByKey: { health: belief({ key: 'health' }) },
      narrative: [],
      narrativeByKind: { history: [], promise: [], outcome: [] },
      members,
      memberCount: members.length,
      asOf: ASOF,
      isEmpty: false,
    }
    const request: CognitionRequest = { scope: SCOPE, subject: { subjectType: 'portfolio', subjectId: 'segment:new' }, tier: 2, reason: 'inbound', admittedAt: ASOF }
    const pkg = assembleFromPortfolio(request, port, { policy: smallPolicy })
    expect(pkg.scale).toBe('portfolio')
    expect(pkg.memberReferences.map((m) => m.subjectId)).toEqual(['a', 'b']) // id-ordered, capped at 2
    expect(pkg.excludedMemberCount).toBe(1)
    expect(pkg.includedBeliefs.map((b) => b.key)).toEqual(['health'])
  })

  it('assembles an empty model into an empty, honest package', () => {
    const pkg = assembleFromRelationship(req('coverage_sweep', 1), relModel([]))
    expect(pkg.isEmpty).toBe(true)
    expect(pkg.includedBeliefs).toHaveLength(0)
    expect(pkg.excludedBeliefs).toHaveLength(0)
    expect(pkg.temporal.freshestAt).toBeNull()
  })

  it('throws on a scope mismatch (scope isolation)', () => {
    expect(() => assembleFromRelationship(req('inbound'), relModel([belief()], [], { agencyId: 999 }))).toThrow(/scope mismatch/)
  })
})

describe('W2-M1 Context Assembly — output purity & immutability', () => {
  it('produces no inference, recommendation, ranking, or action in its output', () => {
    const pkg = assembleFromRelationship(req('inbound'), relModel([belief()]))
    const keys = Object.keys(pkg)
    expect(keys).not.toContain('recommendation')
    expect(keys).not.toContain('hypotheses')
    expect(keys).not.toContain('action')
    expect(keys).not.toContain('priority')
    expect(JSON.stringify(pkg)).not.toMatch(/recommend|hypothes|reversib|schedule/i)
  })

  it('returns a deeply immutable package', () => {
    const pkg = assembleFromRelationship(req('inbound'), relModel([belief()]))
    expect(Object.isFrozen(pkg)).toBe(true)
    expect(Object.isFrozen(pkg.includedBeliefs)).toBe(true)
    expect(Object.isFrozen(pkg.includedBeliefs[0])).toBe(true)
    expect(() => {
      ;(pkg as { isEmpty: boolean }).isEmpty = true
    }).toThrow()
  })
})
