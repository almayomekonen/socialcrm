/**
 * Unit tests for the Copilot → AI Runtime cognition bridge (pure, no DB).
 * Injects the Runtime's reason/decide/recall interfaces, so the mapping,
 * grounding honesty, guarded fallback, and the LLM cognition block are all tested
 * without a database. Proves the Copilot consumes Runtime cognition and never
 * invents it.
 */
import { describe, it, expect } from 'vitest'
import {
  getRuntimeCognitionForLead,
  formatRuntimeCognitionBlock,
  formatRuntimeCognitionForCandidates,
  type RuntimeCognitionDeps,
} from '@/lib/copilot/general/runtimeCognition'
import type { ReasonedUnderstanding, ReasonedQuestion } from '@/lib/ai/runtime/reasoning'
import type { GateDecision } from '@/lib/ai/runtime/toolAction'
import type { Scope } from '@/db/ai/stateManagement'

const SCOPE: Scope = { agencyId: 7 }
const ASOF = '2026-07-14T00:00:00.000Z'
const NOW = new Date(ASOF)

function question(o: Partial<{ key: string; credence: number; groundedness: number; decisionStable: boolean; distance: 'low' | 'medium' | 'high'; traceType: string; live: boolean }> = {}): ReasonedQuestion {
  const distance = o.distance ?? 'low'
  const leading = {
    label: 'holds', credence: o.credence ?? 0.9, groundedness: o.groundedness ?? 0.7,
    evidenceForCount: 2, evidenceAgainstCount: 0, live: o.live ?? false,
  }
  return {
    key: o.key ?? 'intent', hypotheses: [leading], leading, margin: 0.8,
    decisionStable: o.decisionStable ?? true, discriminator: null, uncertaintyKind: 'epistemic',
    calibratable: true, inferentialDistance: distance,
    provenance: { traceRefs: [{ type: o.traceType ?? 'conversation', id: '555' }], inferentialDistance: distance, isAbsenceDerived: false },
    freshness: { ageMs: 0, isStale: false },
  } as ReasonedQuestion
}

function understanding(qs: ReasonedQuestion[], over: Partial<ReasonedUnderstanding> = {}): ReasonedUnderstanding {
  const open = qs.filter((q) => !q.decisionStable).map((q) => q.key)
  return {
    scope: SCOPE, subject: { subjectType: 'lead', subjectId: '100' }, scale: 'relationship',
    lens: { tier: 2, reason: 'inbound', sufficiencyMargin: 0.25 }, asOf: ASOF,
    observationCount: qs.length, beliefCount: qs.length, questions: qs,
    decisionStable: open.length === 0, openQuestions: open,
    uncertainty: { anyUncalibratable: false, anyHighInference: qs.some((q) => q.inferentialDistance === 'high'), anyStale: false },
    isGrounded: qs.length > 0, ...over,
  } as ReasonedUnderstanding
}

const RECOMMEND = { emitted: true, outcome: 'recommend', recommendation: { rationale: 'surface 1 settled conclusion for human authorization' } } as unknown as GateDecision
const STAY_SILENT = { emitted: true, outcome: 'stay_silent' } as unknown as GateDecision

function deps(u: ReasonedUnderstanding, d: GateDecision): RuntimeCognitionDeps {
  return {
    reason: (async () => u) as RuntimeCognitionDeps['reason'],
    decide: (() => d) as RuntimeCognitionDeps['decide'],
    recall: (async () => ({ episodic: [{}], semantic: [{}, {}] })) as unknown as RuntimeCognitionDeps['recall'],
  }
}

describe('Copilot Runtime bridge — grounding honesty', () => {
  it('returns grounded=false when the Runtime holds no belief (Copilot must say so)', async () => {
    const c = await getRuntimeCognitionForLead(SCOPE, 100, { now: NOW, deps: deps(understanding([], { isGrounded: false }), STAY_SILENT) })
    expect(c.grounded).toBe(false)
    expect(c.confidence).toBeNull()
    expect(formatRuntimeCognitionBlock(c)).toBeNull() // nothing to add → answer stays on CRM facts
  })

  it('maps a grounded, decision-stable read into structured cognition', async () => {
    const c = await getRuntimeCognitionForLead(SCOPE, 100, {
      now: NOW,
      deps: deps(understanding([question({ key: 'intent', credence: 0.9 })]), RECOMMEND),
    })
    expect(c.grounded).toBe(true)
    expect(c.confidence).toBe('high')
    expect(c.provenanceSources).toEqual(['WhatsApp conversation']) // provenance walked back, humanized
    expect(c.recommendation).toEqual({ outcome: 'recommend', rationale: expect.stringContaining('surface') })
    expect(c.reasoningChain).toEqual([{ key: 'intent', leaning: 'holds', credence: 0.9 }])
    expect(c.memory).toEqual({ episodicCount: 1, baseRateCount: 2 })
  })

  it('never presents a high-inference read as high confidence', async () => {
    const c = await getRuntimeCognitionForLead(SCOPE, 100, {
      now: NOW,
      deps: deps(understanding([question({ credence: 0.95, distance: 'high' })]), RECOMMEND),
    })
    expect(c.confidence).toBe('medium') // downgraded from high
  })

  it('surfaces open questions and a stay-silent recommendation honestly', async () => {
    const c = await getRuntimeCognitionForLead(SCOPE, 100, {
      now: NOW,
      deps: deps(understanding([question({ key: 'budget', decisionStable: false, live: true })]), STAY_SILENT),
    })
    expect(c.openQuestions).toEqual(['budget'])
    expect(c.recommendation.outcome).toBe('stay_silent')
  })
})

describe('Copilot Runtime bridge — guarded fallback', () => {
  it('returns grounded=false (never throws) when the Runtime errors', async () => {
    const throwing: RuntimeCognitionDeps = {
      reason: (async () => { throw new Error('runtime down') }) as RuntimeCognitionDeps['reason'],
    }
    const c = await getRuntimeCognitionForLead(SCOPE, 100, { now: NOW, deps: throwing })
    expect(c.grounded).toBe(false)
  })
})

describe('Copilot Runtime bridge — LLM cognition block', () => {
  it('renders an authoritative, grounded block the LLM must not exceed', async () => {
    const c = await getRuntimeCognitionForLead(SCOPE, 100, {
      now: NOW,
      deps: deps(understanding([question({ key: 'intent', credence: 0.9 }), question({ key: 'budget', decisionStable: false, live: true })]), RECOMMEND),
    })
    const block = formatRuntimeCognitionBlock(c)!
    expect(block).toContain('AI Runtime cognition')
    expect(block).toContain('Confidence: high')
    expect(block).toContain('Grounded in: WhatsApp conversation')
    expect(block).toContain('Still unknown / unresolved: budget')
    expect(block).toContain('Reasoning:')
    expect(block).toContain('do not invent beyond it')
  })
})

describe('Copilot Runtime bridge — General-Mode aggregation (per-candidate, no ranking)', () => {
  it('aggregates grounded candidates, omits ungrounded, and forbids ranking', async () => {
    const david = await getRuntimeCognitionForLead(SCOPE, 1, { now: NOW, deps: deps(understanding([question({ key: 'intent', credence: 0.9 })]), RECOMMEND) })
    const sarah = await getRuntimeCognitionForLead(SCOPE, 2, { now: NOW, deps: deps(understanding([], { isGrounded: false }), STAY_SILENT) })
    const block = formatRuntimeCognitionForCandidates([
      { label: 'David', cognition: david },
      { label: 'Sarah', cognition: sarah },
    ])!
    expect(block).toContain('understanding only')
    expect(block).toContain('do NOT rank')
    expect(block).toContain('• David:')
    expect(block).not.toContain('• Sarah:') // ungrounded candidate omitted, not guessed
  })

  it('returns null when no candidate is grounded', async () => {
    const c = await getRuntimeCognitionForLead(SCOPE, 3, { now: NOW, deps: deps(understanding([], { isGrounded: false }), STAY_SILENT) })
    expect(formatRuntimeCognitionForCandidates([{ label: 'X', cognition: c }])).toBeNull()
  })
})
