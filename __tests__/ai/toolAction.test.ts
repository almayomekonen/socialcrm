/**
 * Unit tests for the M6 Tool / Action Runtime (pure, no DB).
 * Runs under `test:unit` (VITEST_NO_DB=1): every test calls the pure gate
 * (`decide`) over hand-built ReasonedUnderstanding literals, so there is no
 * database dependency. Proves the constitutional terminal model, the ordered
 * safety seams, internal rejection (nothing emitted), and full explainability /
 * traceability of every recommendation.
 */
import { describe, it, expect } from 'vitest'
import {
  decide,
  WAVE1_REACHABLE_OUTCOMES,
  WAVE1_AUTONOMY,
  type GateContext,
} from '@/lib/ai/runtime/toolAction'
import type {
  ReasonedUnderstanding,
  ReasonedQuestion,
  HypothesisView,
} from '@/lib/ai/runtime/reasoning'
import type { Scope, TraceRef, InferentialDistance, UncertaintyKind } from '@/db/ai/stateManagement'

const SCOPE: Scope = { agencyId: 7 }
const ASOF = '2026-07-14T00:00:00.000Z'
const NOW = new Date('2026-07-14T01:00:00.000Z')
const CTX: GateContext = { scope: SCOPE, now: NOW }

const trace = (id: string): TraceRef => ({ type: 'message', id })

interface QOverrides {
  key?: string
  credence?: number
  groundedness?: number
  decisionStable?: boolean
  inferentialDistance?: InferentialDistance
  isAbsenceDerived?: boolean
  traceRefs?: TraceRef[]
  uncertaintyKind?: UncertaintyKind
  calibratable?: boolean
  isStale?: boolean
}

function question(o: QOverrides = {}): ReasonedQuestion {
  const distance = o.inferentialDistance ?? 'low'
  const leading: HypothesisView = {
    label: 'holds',
    credence: o.credence ?? 0.9,
    groundedness: o.groundedness ?? 0.7,
    evidenceForCount: 2,
    evidenceAgainstCount: 0,
    live: !(o.decisionStable ?? true),
  }
  const runnerUp: HypothesisView = {
    label: 'not_holds',
    credence: 1 - (o.credence ?? 0.9),
    groundedness: o.groundedness ?? 0.7,
    evidenceForCount: 0,
    evidenceAgainstCount: 2,
    live: !(o.decisionStable ?? true),
  }
  const isAbsenceDerived = o.isAbsenceDerived ?? false
  const traceRefs = o.traceRefs ?? (isAbsenceDerived ? [] : [trace('m1')])
  return {
    key: o.key ?? 'intent',
    hypotheses: [leading, runnerUp],
    leading,
    margin: leading.credence - runnerUp.credence,
    decisionStable: o.decisionStable ?? true,
    discriminator: null,
    uncertaintyKind: o.uncertaintyKind ?? 'epistemic',
    calibratable: o.calibratable ?? true,
    inferentialDistance: distance,
    provenance: { traceRefs, inferentialDistance: distance, isAbsenceDerived },
    freshness: { ageMs: 0, isStale: o.isStale ?? false },
  }
}

function understanding(questions: ReasonedQuestion[], over: Partial<ReasonedUnderstanding> = {}): ReasonedUnderstanding {
  const open = questions.filter((q) => !q.decisionStable).map((q) => q.key)
  return {
    scope: SCOPE,
    subject: { subjectType: 'lead', subjectId: '100' },
    scale: 'relationship',
    lens: { tier: 2, reason: 'inbound', sufficiencyMargin: 0.25 },
    asOf: ASOF,
    observationCount: questions.reduce((n, q) => n + q.provenance.traceRefs.length, 0),
    beliefCount: questions.length,
    questions,
    decisionStable: open.length === 0,
    openQuestions: open,
    uncertainty: {
      anyUncalibratable: questions.some((q) => !q.calibratable),
      anyHighInference: questions.some((q) => q.inferentialDistance === 'high'),
      anyStale: questions.some((q) => q.freshness.isStale),
    },
    isGrounded: questions.length > 0,
    ...over,
  }
}

describe('M6 Tool/Action — the constitutional terminal model', () => {
  it('a grounded, settled understanding is Recommended for the human', () => {
    const d = decide(understanding([question({ traceRefs: [trace('m1'), trace('m2')] })]), CTX)
    expect(d.emitted).toBe(true)
    expect(d.outcome).toBe('recommend')
    if (!d.emitted || d.outcome !== 'recommend') throw new Error('expected recommend')
    expect(d.recommendation.reversibility).toBe('reversible')
    expect(d.recommendation.autonomy).toEqual(WAVE1_AUTONOMY)
  })

  it('never emits Act or Ask across any input (Wave 1 reachability)', () => {
    const inputs = [
      understanding([question()]),
      understanding([]),
      understanding([question({ decisionStable: false })]),
      understanding([question({ isAbsenceDerived: true })]),
    ]
    for (const u of inputs) {
      const d = decide(u, CTX)
      if (d.outcome !== null) expect(WAVE1_REACHABLE_OUTCOMES.has(d.outcome)).toBe(true)
      expect(d.outcome).not.toBe('act')
      expect(d.outcome).not.toBe('ask')
    }
    expect(WAVE1_REACHABLE_OUTCOMES.has('act')).toBe(false)
    expect(WAVE1_REACHABLE_OUTCOMES.has('ask')).toBe(false)
  })

  it('Act is structurally unreachable even with a granted autonomy stub', () => {
    // Autonomy is a stub fixed at none; passing it changes nothing — still Recommend.
    const d = decide(understanding([question()]), { scope: SCOPE, now: NOW, autonomy: WAVE1_AUTONOMY })
    expect(d.outcome).toBe('recommend')
  })
})

describe('M6 Tool/Action — Stay Silent (a constitutional outcome, not a rejection)', () => {
  it('stays silent with an honest reason over an ungrounded understanding', () => {
    const d = decide(understanding([], { isGrounded: false, beliefCount: 0 }), CTX)
    expect(d.emitted).toBe(true)
    expect(d.outcome).toBe('stay_silent')
    if (!d.emitted || d.outcome !== 'stay_silent') throw new Error('expected stay_silent')
    expect(d.silence.reason).toBe('no_grounded_understanding')
  })

  it('stays silent when grounded but no conclusion is decision-stable', () => {
    const d = decide(understanding([question({ decisionStable: false })]), CTX)
    expect(d.outcome).toBe('stay_silent')
    if (!d.emitted || d.outcome !== 'stay_silent') throw new Error('expected stay_silent')
    expect(d.silence.reason).toBe('no_settled_conclusion')
  })

  it('surfaces only the settled conclusions and stays silent on the live ones', () => {
    const d = decide(
      understanding([question({ key: 'a', decisionStable: true }), question({ key: 'b', decisionStable: false })]),
      CTX,
    )
    expect(d.outcome).toBe('recommend')
    if (!d.emitted || d.outcome !== 'recommend') throw new Error('expected recommend')
    expect(d.recommendation.reasoningChain.map((l) => l.key)).toEqual(['a'])
  })
})

describe('M6 Tool/Action — internal rejection emits nothing', () => {
  it('rejects internally on a scope mismatch and emits no outcome', () => {
    const foreign = understanding([question()], { scope: { agencyId: 999 } })
    const d = decide(foreign, CTX)
    expect(d.emitted).toBe(false)
    expect(d.outcome).toBeNull()
    if (!('rejection' in d)) throw new Error('expected internal rejection')
    expect(d.rejection.boundary).toBe('scope')
    expect(d.rejection.reason).toMatch(/scope/i)
  })

  it('rejects a settled conclusion with a broken provenance chain', () => {
    const d = decide(understanding([question({ traceRefs: [], isAbsenceDerived: false })]), CTX)
    expect(d.emitted).toBe(false)
    if (!('rejection' in d)) throw new Error('expected internal rejection')
    expect(d.rejection.boundary).toBe('provenance')
    expect(d.rejection.reason).toContain('intent')
  })

  it('every rejection carries its reason and a failed trace step', () => {
    const d = decide(understanding([question()], { scope: { agencyId: 999 } }), CTX)
    if (!('rejection' in d)) throw new Error('expected internal rejection')
    expect(d.rejection.reason.length).toBeGreaterThan(0)
    const failed = d.trace.find((s) => !s.passed)
    expect(failed).toBeDefined()
    expect(failed!.boundary).toBe('scope')
  })

  it('accepts an absence-derived conclusion (honest absence walks back, no trace required)', () => {
    const d = decide(understanding([question({ isAbsenceDerived: true, traceRefs: [] })]), CTX)
    expect(d.outcome).toBe('recommend')
  })
})

describe('M6 Tool/Action — explainability & traceability', () => {
  it('a recommendation carries the exact reasoning chain and merged provenance', () => {
    const d = decide(
      understanding([
        question({ key: 'a', traceRefs: [trace('m1'), trace('m2')] }),
        question({ key: 'b', inferentialDistance: 'high', traceRefs: [trace('m2'), trace('m3')] }),
      ]),
      CTX,
    )
    if (!d.emitted || d.outcome !== 'recommend') throw new Error('expected recommend')
    const r = d.recommendation
    expect(r.reasoningChain.map((l) => l.key)).toEqual(['a', 'b'])
    expect(r.reasoningChain[0].leading.credence).toBeGreaterThan(0)
    // Provenance is merged and de-duplicated across conclusions.
    expect(r.provenance.traceRefs.map((t) => t.id).sort()).toEqual(['m1', 'm2', 'm3'])
    expect(r.provenance.anyHighInference).toBe(true)
    expect(r.rationale).toMatch(/human authorization/)
    expect(r.lens.reason).toBe('inbound')
  })

  it('every decision records the ordered seam walk it took', () => {
    const d = decide(understanding([question()]), CTX)
    const boundaries = d.trace.filter((s) => s.passed).map((s) => s.boundary)
    expect(boundaries).toEqual(['scope', 'provenance', 'groundedness', 'reversibility', 'earned_autonomy'])
  })

  it('is read-only: the input understanding is never mutated', () => {
    const u = understanding([question()])
    const snapshot = JSON.stringify(u)
    decide(u, CTX)
    expect(JSON.stringify(u)).toBe(snapshot)
  })

  it('stamps the decision time from the injected clock', () => {
    const d = decide(understanding([question()]), CTX)
    expect(d.decidedAt).toBe(NOW.toISOString())
  })
})
