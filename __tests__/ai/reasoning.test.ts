/**
 * Unit tests for the M5 Reasoning Runtime (pure, no DB).
 * Runs under `test:unit` (VITEST_NO_DB=1): every test calls the pure entry
 * points (`reasonOverRelationship` / `reasonOverPortfolio`) over hand-built
 * World Model literals, so there is no database dependency.
 */
import { describe, it, expect } from 'vitest'
import {
  reasonOverRelationship,
  reasonOverPortfolio,
  type ReasonedUnderstanding,
} from '@/lib/ai/runtime/reasoning'
import type { CognitionRequest, AdmissionReason, CognitionTier } from '@/lib/ai/runtime/scheduler'
import type { RelationshipWorldModel, PortfolioWorldModel } from '@/lib/ai/runtime/worldModel'
import type { StoredBelief, InferentialDistance, UncertaintyKind, TraceRef, Scope } from '@/db/ai/stateManagement'

const SCOPE: Scope = { agencyId: 7 }
const ASOF = '2026-07-14T00:00:00.000Z'

interface BeliefOverrides {
  key?: string
  decayedConfidence?: number
  groundedness?: number
  calibratable?: boolean
  uncertaintyKind?: UncertaintyKind
  evidenceFor?: TraceRef[]
  evidenceAgainst?: TraceRef[]
  isAbsenceDerived?: boolean
  inferentialDistance?: InferentialDistance
  traceRefs?: TraceRef[]
  ageMs?: number
  isStale?: boolean
}

function belief(o: BeliefOverrides = {}): StoredBelief {
  const distance = o.inferentialDistance ?? 'low'
  return {
    id: 1,
    agencyId: SCOPE.agencyId,
    subjectType: 'lead',
    subjectId: '100',
    key: o.key ?? 'intent',
    content: {},
    storedConfidence: o.decayedConfidence ?? 0.5,
    decayedConfidence: o.decayedConfidence ?? 0.5,
    groundedness: o.groundedness ?? 0.6,
    calibratable: o.calibratable ?? true,
    uncertaintyKind: o.uncertaintyKind ?? 'epistemic',
    evidenceFor: o.evidenceFor ?? [],
    evidenceAgainst: o.evidenceAgainst ?? [],
    isAbsenceDerived: o.isAbsenceDerived ?? false,
    version: 1,
    freshnessAt: ASOF,
    ageMs: o.ageMs ?? 0,
    isStale: o.isStale ?? false,
    provenance: { traceRefs: o.traceRefs ?? [], inferencePath: [], inferentialDistance: distance },
    createdAt: ASOF,
    updatedAt: ASOF,
  }
}

function relModel(beliefs: StoredBelief[], scope: Scope = SCOPE): RelationshipWorldModel {
  const beliefsByKey: Record<string, StoredBelief> = {}
  for (const b of beliefs) beliefsByKey[b.key] = b
  return {
    scope,
    subject: { subjectType: 'lead', subjectId: '100' },
    beliefs,
    beliefsByKey,
    narrative: [],
    narrativeByKind: { history: [], promise: [], outcome: [] },
    asOf: ASOF,
    isEmpty: beliefs.length === 0,
  }
}

function req(reason: AdmissionReason, tier: CognitionTier = 2): CognitionRequest {
  return { scope: SCOPE, subject: { subjectType: 'lead', subjectId: '100' }, tier, reason, admittedAt: ASOF }
}

const trace = (id: string): TraceRef => ({ type: 'message', id })
const q = (u: ReasonedUnderstanding, key: string) => u.questions.find((x) => x.key === key)!

describe('M5 Reasoning — grounding & empty state', () => {
  it('reports an honest "no understanding" over an empty model', () => {
    const u = reasonOverRelationship(req('coverage_sweep', 1), relModel([]))
    expect(u.isGrounded).toBe(false)
    expect(u.questions).toEqual([])
    expect(u.decisionStable).toBe(true)
    expect(u.observationCount).toBe(0)
    expect(u.beliefCount).toBe(0)
  })

  it('throws on a scope mismatch (scope isolation)', () => {
    expect(() => reasonOverRelationship(req('inbound'), relModel([belief()], { agencyId: 999 }))).toThrow(/scope mismatch/)
  })
})

describe('M5 Reasoning — competing hypotheses & evidence', () => {
  it('a well-supported belief makes "holds" lead and the question decision-stable', () => {
    const u = reasonOverRelationship(
      req('inbound'),
      relModel([belief({ decayedConfidence: 0.8, evidenceFor: [trace('m1'), trace('m2')] })]),
    )
    const question = q(u, 'intent')
    expect(question.leading.label).toBe('holds')
    expect(question.leading.credence).toBeGreaterThan(0.8)
    expect(question.decisionStable).toBe(true)
    expect(question.discriminator).toBeNull()
    expect(question.hypotheses.map((h) => h.label).sort()).toEqual(['holds', 'not_holds'])
  })

  it('weighs disconfirmation more heavily than confirmation', () => {
    // Prior 0.5, equal evidence both ways → "holds" must fall below 0.5.
    const u = reasonOverRelationship(
      req('inbound'),
      relModel([belief({ decayedConfidence: 0.5, evidenceFor: [trace('a')], evidenceAgainst: [trace('b')] })]),
    )
    const holds = q(u, 'intent').hypotheses.find((h) => h.label === 'holds')!
    expect(holds.credence).toBeLessThan(0.5)
  })

  it('flags a contested question as live and names the discriminating observation', () => {
    const u = reasonOverRelationship(req('absence'), relModel([belief({ decayedConfidence: 0.52 })]))
    const question = q(u, 'intent')
    expect(question.decisionStable).toBe(false)
    expect(question.leading.live).toBe(true)
    expect(question.discriminator).not.toBeNull()
    expect(question.discriminator!.key).toBe('intent')
    expect(question.discriminator!.betweenLabels).toHaveLength(2)
    expect(u.openQuestions).toContain('intent')
    expect(u.decisionStable).toBe(false)
  })

  it('does not chase irreducible (aleatoric) uncertainty — no discriminator', () => {
    const u = reasonOverRelationship(
      req('absence'),
      relModel([belief({ decayedConfidence: 0.52, uncertaintyKind: 'aleatoric' })]),
    )
    const question = q(u, 'intent')
    expect(question.decisionStable).toBe(true)
    expect(question.discriminator).toBeNull()
    expect(question.leading.live).toBe(false)
  })
})

describe('M5 Reasoning — sufficiency scaled by stakes', () => {
  it('the same evidence can be stable under a low-stakes lens but live under a high-stakes lens', () => {
    // Choose a prior whose margin sits between the coverage bar (0.15) and the
    // absence bar (0.30): margin = |2*0.6 - 1| = 0.2.
    const b = () => relModel([belief({ decayedConfidence: 0.6 })])
    const low = reasonOverRelationship(req('coverage_sweep', 1), b())
    const high = reasonOverRelationship(req('absence'), b())
    expect(q(low, 'intent').decisionStable).toBe(true)
    expect(q(high, 'intent').decisionStable).toBe(false)
    expect(low.lens.sufficiencyMargin).toBe(0.15)
    expect(high.lens.sufficiencyMargin).toBe(0.3)
  })
})

describe('M5 Reasoning — provenance, distance & uncertainty layers', () => {
  it('merges and de-duplicates the trace walk-back and never lowers inferential distance', () => {
    const u = reasonOverRelationship(
      req('inbound'),
      relModel([
        belief({
          inferentialDistance: 'high',
          traceRefs: [trace('m1')],
          evidenceFor: [trace('m1'), trace('m2')],
          evidenceAgainst: [trace('m3')],
        }),
      ]),
    )
    const question = q(u, 'intent')
    expect(question.inferentialDistance).toBe('high')
    expect(question.provenance.inferentialDistance).toBe('high')
    expect(question.provenance.traceRefs.map((t) => t.id).sort()).toEqual(['m1', 'm2', 'm3'])
    expect(u.observationCount).toBe(3)
  })

  it('summarizes the uncertainty layer across questions', () => {
    const u = reasonOverRelationship(
      req('staleness', 1),
      relModel([
        belief({ key: 'a', calibratable: false }),
        belief({ key: 'b', inferentialDistance: 'high', evidenceFor: [trace('x')] }),
        belief({ key: 'c', isStale: true }),
      ]),
    )
    expect(u.uncertainty.anyUncalibratable).toBe(true)
    expect(u.uncertainty.anyHighInference).toBe(true)
    expect(u.uncertainty.anyStale).toBe(true)
    expect(q(u, 'a').calibratable).toBe(false)
  })

  it('distinguishes "confidently" from "cluelessly" via second-order groundedness', () => {
    const confident = reasonOverRelationship(
      req('inbound'),
      relModel([belief({ decayedConfidence: 0.6, inferentialDistance: 'low', evidenceFor: [trace('a'), trace('b'), trace('c')] })]),
    )
    const clueless = reasonOverRelationship(
      req('inbound'),
      relModel([belief({ decayedConfidence: 0.6, inferentialDistance: 'high', evidenceFor: [] })]),
    )
    expect(q(confident, 'intent').leading.groundedness).toBeGreaterThan(q(clueless, 'intent').leading.groundedness)
  })
})

describe('M5 Reasoning — determinism, portfolio scale & output purity', () => {
  it('orders questions deterministically by key', () => {
    const u = reasonOverRelationship(
      req('inbound'),
      relModel([belief({ key: 'zeta' }), belief({ key: 'alpha' }), belief({ key: 'mu' })]),
    )
    expect(u.questions.map((x) => x.key)).toEqual(['alpha', 'mu', 'zeta'])
  })

  it('reasons a portfolio over its own beliefs without ranking members', () => {
    const members: RelationshipWorldModel[] = [relModel([belief({ decayedConfidence: 0.9, evidenceFor: [trace('m')] })])]
    const port: PortfolioWorldModel = {
      scope: SCOPE,
      portfolioId: 'segment:new',
      beliefs: [belief({ key: 'health', decayedConfidence: 0.7 })],
      beliefsByKey: { health: belief({ key: 'health', decayedConfidence: 0.7 }) },
      narrative: [],
      narrativeByKind: { history: [], promise: [], outcome: [] },
      members,
      memberCount: members.length,
      asOf: ASOF,
      isEmpty: false,
    }
    const request: CognitionRequest = {
      scope: SCOPE,
      subject: { subjectType: 'portfolio', subjectId: 'segment:new' },
      tier: 2,
      reason: 'inbound',
      admittedAt: ASOF,
    }
    const u = reasonOverPortfolio(request, port)
    expect(u.scale).toBe('portfolio')
    expect(u.subject).toEqual({ subjectType: 'portfolio', subjectId: 'segment:new' })
    expect(u.questions.map((x) => x.key)).toEqual(['health'])
  })

  it('produces no action, recommendation, or priority in its output', () => {
    const u = reasonOverRelationship(req('inbound'), relModel([belief()]))
    const keys = Object.keys(u)
    expect(keys).not.toContain('action')
    expect(keys).not.toContain('recommendation')
    expect(keys).not.toContain('priority')
    expect(JSON.stringify(u)).not.toMatch(/recommend|execute/i)
  })
})
