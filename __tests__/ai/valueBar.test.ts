/**
 * Phase 4.1 — the Value / Taste Bar (Cognitive Architecture J Gate 2).
 *
 * Pure, no DB, runs under `test:unit`. Every test targets a real guarantee: the
 * seam's position, its fail-closed default, the exact scope of the constitutional
 * vigilance override, and the structural impossibility of a model influencing
 * whether something is surfaced. Comments and doc strings are never the subject.
 *
 * The bar is exercised BOTH directly (`evaluateValue`) and through the gate
 * (`decide`), because the two guarantees are different: the policy must be right,
 * and it must be impossible to reach emission without passing it.
 */
import { describe, it, expect } from 'vitest'
import { decide, type GateContext } from '@/lib/ai/runtime/toolAction'
import {
  evaluateValue,
  VALUE_CRITERIA,
  VIGILANCE_WAIVABLE,
  type ValueContext,
  type ValueCriterion,
  type ValueInput,
} from '@/lib/ai/runtime/valueBar'
import {
  NOTIFICATION_OWNERSHIP,
  VIGILANCE_CLASS,
  isOwnedByDeterministicNotification,
  vigilanceClassFor,
} from '@/lib/ai/integration/notificationOwnership'
import { DETECTORS } from '@/lib/ai/integration/detectors/registry'
import type { ReasonedUnderstanding, ReasonedQuestion, HypothesisView } from '@/lib/ai/runtime/reasoning'
import type { Scope, TraceRef, SubjectRef } from '@/db/ai/stateManagement'

const SCOPE: Scope = { agencyId: 7 }
const SUBJECT: SubjectRef = { subjectType: 'lead', subjectId: '100' }
const ASOF = '2026-07-14T00:00:00.000Z'
const NOW = new Date('2026-07-14T09:00:00.000Z')

const DAY_START = Date.parse('2026-07-14T00:00:00.000Z')
const NOW_MS = Date.parse('2026-07-14T09:00:00.000Z')
const DAY_END = Date.parse('2026-07-15T00:00:00.000Z')
/** A deadline that genuinely passed before today began. */
const PASSED = DAY_START - 86_400_000

const leadTrace = (id = '100'): TraceRef => ({ type: 'lead', id })

function question(o: Partial<ReasonedQuestion> & { traceRefs?: TraceRef[] } = {}): ReasonedQuestion {
  const leading: HypothesisView = {
    label: 'holds',
    credence: 0.92,
    groundedness: 0.8,
    evidenceForCount: 2,
    evidenceAgainstCount: 0,
    live: false,
  }
  const runnerUp: HypothesisView = { ...leading, label: 'not_holds', credence: 0.08, live: false }
  const traceRefs = o.traceRefs ?? [leadTrace()]
  return {
    key: 'intent',
    hypotheses: [leading, runnerUp],
    leading,
    margin: 0.84,
    decisionStable: true,
    discriminator: null,
    uncertaintyKind: 'epistemic',
    calibratable: true,
    inferentialDistance: 'low',
    provenance: { traceRefs, inferentialDistance: 'low', isAbsenceDerived: false },
    freshness: { ageMs: 0, isStale: false },
    ...o,
  } as ReasonedQuestion
}

function understanding(qs: ReasonedQuestion[] = [question()], over: Partial<ReasonedUnderstanding> = {}): ReasonedUnderstanding {
  return {
    scope: SCOPE,
    subject: SUBJECT,
    scale: 'relationship',
    lens: { tier: 2, reason: 'absence', sufficiencyMargin: 0.3 },
    asOf: ASOF,
    observationCount: qs.reduce((n, q) => n + q.provenance.traceRefs.length, 0),
    beliefCount: qs.length,
    questions: qs,
    decisionStable: true,
    openQuestions: [],
    uncertainty: { anyUncalibratable: false, anyHighInference: false, anyStale: false },
    isGrounded: qs.length > 0,
    ...over,
  }
}

/** A ValueContext where every criterion passes. Each test breaks exactly one. */
function ctx(over: Partial<ValueContext> = {}): ValueContext {
  return {
    state: 'FOLLOWUP_OVERDUE',
    ownedByDeterministicNotification: false,
    expectedByMs: PASSED,
    clock: { nowMs: NOW_MS, dayStart: DAY_START, dayEnd: DAY_END },
    vigilance: null,
    ...over,
  }
}

function input(over: Partial<ValueInput> = {}, c: Partial<ValueContext> = {}): ValueInput {
  return {
    subject: SUBJECT,
    settled: [question()],
    observationCount: 1,
    reversibility: 'reversible',
    context: ctx(c),
    ...over,
  }
}

const surfaceCtx = (c: Partial<ValueContext> = {}): GateContext => ({
  scope: SCOPE,
  now: NOW,
  intent: { mode: 'surface', value: ctx(c) },
})

const boundaries = (d: ReturnType<typeof decide>) => d.trace.map((s) => s.boundary)

// ─────────────────────────── 1. seam position ───────────────────────────────

describe('Gate 2 sits at the approved seam', () => {
  it('runs after earned_autonomy and immediately before emission', () => {
    const d = decide(understanding(), surfaceCtx())
    expect(boundaries(d)).toEqual(['scope', 'provenance', 'groundedness', 'reversibility', 'earned_autonomy', 'value'])
    expect(d.outcome).toBe('recommend')
  })

  it('is the LAST seam — nothing is traced after it', () => {
    const d = decide(understanding(), surfaceCtx())
    expect(d.trace[d.trace.length - 1]!.boundary).toBe('value')
  })
})

// ─────────────────── 2. only a valid Recommend reaches Gate 2 ───────────────

describe('only a candidate that would be emitted as Recommend reaches Gate 2', () => {
  it('an ungrounded understanding never reaches the value seam', () => {
    const d = decide(understanding([], { isGrounded: false }), surfaceCtx())
    expect(d.outcome).toBe('stay_silent')
    expect(d.emitted && d.outcome === 'stay_silent' && d.silence.reason).toBe('no_grounded_understanding')
    expect(boundaries(d)).not.toContain('value')
  })

  it('a grounded but unsettled understanding never reaches the value seam', () => {
    const unsettled = question({ decisionStable: false })
    const d = decide(understanding([unsettled], { decisionStable: false, openQuestions: ['intent'] }), surfaceCtx())
    expect(d.emitted && d.outcome === 'stay_silent' && d.silence.reason).toBe('no_settled_conclusion')
    expect(boundaries(d)).not.toContain('value')
  })

  it('a scope breach is rejected before the value seam', () => {
    const d = decide(understanding(), { ...surfaceCtx(), scope: { agencyId: 999 } })
    expect(d.emitted).toBe(false)
    expect(boundaries(d)).not.toContain('value')
  })

  it('a provenance breach is rejected before the value seam', () => {
    const broken = question({ traceRefs: [], provenance: { traceRefs: [], inferentialDistance: 'low', isAbsenceDerived: false } })
    const d = decide(understanding([broken]), surfaceCtx())
    expect(d.emitted).toBe(false)
    expect(boundaries(d)).not.toContain('value')
  })
})

// ───────────────────── 3 & 4. intent modes ──────────────────────────────────

describe('surface mode requires ValueContext; inspect mode is unchanged', () => {
  it('surface mode cannot be constructed without a ValueContext', () => {
    // @ts-expect-error — `value` is mandatory on the surface branch of GateIntent.
    const bad: GateContext = { scope: SCOPE, intent: { mode: 'surface' } }
    expect(bad).toBeTruthy()
  })

  it('an omitted intent behaves exactly as before Phase 4.1', () => {
    const u = understanding()
    const legacy = decide(u, { scope: SCOPE, now: NOW })
    const explicit = decide(u, { scope: SCOPE, now: NOW, intent: { mode: 'inspect' } })
    expect(legacy).toEqual(explicit)
    expect(legacy.outcome).toBe('recommend')
    expect(boundaries(legacy)).toEqual(['scope', 'provenance', 'groundedness', 'reversibility', 'earned_autonomy'])
    expect(legacy.value).toBeUndefined()
  })

  it('inspect mode surfaces a Recommend that surface mode would suppress', () => {
    // Owned by a deterministic notification ⇒ C4 fails under surface.
    const u = understanding()
    expect(decide(u, { scope: SCOPE, now: NOW }).outcome).toBe('recommend')
    expect(decide(u, surfaceCtx({ ownedByDeterministicNotification: true })).outcome).toBe('stay_silent')
  })
})

// ───────────────── 5. no model-controlled input ─────────────────────────────

describe('the model cannot influence the verdict', () => {
  it('ValueContext exposes no urgency / severity / priority / delivery field', () => {
    const keys = Object.keys(ctx())
    expect(keys.sort()).toEqual(['clock', 'expectedByMs', 'ownedByDeterministicNotification', 'state', 'vigilance'].sort())
    for (const banned of ['urgency', 'severity', 'priority', 'importance', 'confidence', 'deliver', 'notify']) {
      expect(keys.some((k) => k.toLowerCase().includes(banned))).toBe(false)
    }
  })

  it('a smuggled model field cannot rescue a FAILING conclusion', () => {
    // The guarantee only bites where the verdict would otherwise be silence: a
    // baseline that already passes cannot distinguish "ignored" from "obeyed".
    const smuggle = { urgency: 'critical', severity: 10, priority: 'high', surface: true } as unknown as Partial<ValueContext>
    for (const breaking of [
      { state: null },
      { ownedByDeterministicNotification: true },
      { expectedByMs: null },
    ] as Partial<ValueContext>[]) {
      const withoutSmuggle = evaluateValue(input({}, breaking))
      const withSmuggle = evaluateValue(input({}, { ...breaking, ...smuggle }))
      expect(withoutSmuggle.surface).toBe(false)
      expect(withSmuggle.surface).toBe(false)
      expect(withSmuggle).toEqual(withoutSmuggle)
    }
  })

  it('a smuggled model field cannot alter a PASSING verdict either', () => {
    const smuggle = { urgency: 'critical', severity: 10 } as unknown as Partial<ValueContext>
    expect(evaluateValue(input({}, smuggle))).toEqual(evaluateValue(input()))
  })

  it('a high model credence cannot rescue a failed criterion', () => {
    const confident = question({
      leading: { label: 'holds', credence: 1, groundedness: 1, evidenceForCount: 99, evidenceAgainstCount: 0, live: false },
    })
    const d = decide(understanding([confident]), surfaceCtx({ state: null }))
    expect(d.outcome).toBe('stay_silent')
  })
})

// ─────────────────── 6–12. each criterion fails closed ──────────────────────

describe('every criterion, failing alone, produces silence', () => {
  const cases: Array<[ValueCriterion, () => ReturnType<typeof decide>]> = [
    ['qualifying_state', () => decide(understanding(), surfaceCtx({ state: null }))],
    [
      'subject_actionable',
      () =>
        decide(
          understanding([], {
            subject: { subjectType: 'portfolio', subjectId: 'p1' },
            questions: [question()],
            isGrounded: true,
          }),
          surfaceCtx(),
        ),
    ],
    ['cost_of_waiting', () => decide(understanding(), surfaceCtx({ expectedByMs: null }))],
    ['notification_novelty', () => decide(understanding(), surfaceCtx({ ownedByDeterministicNotification: true }))],
    [
      'evidence_sufficiency',
      () =>
        decide(
          understanding(
            [question({ traceRefs: [], provenance: { traceRefs: [], inferentialDistance: 'low', isAbsenceDerived: true } })],
            { observationCount: 0 },
          ),
          surfaceCtx(),
        ),
    ],
    ['subject_anchoring', () => decide(understanding([question({ traceRefs: [{ type: 'message', id: 'm9' }] })]), surfaceCtx())],
  ]

  for (const [criterion, run] of cases) {
    it(`C:${criterion} → stay_silent, recorded`, () => {
      const d = run()
      expect(d.outcome).toBe('stay_silent')
      expect(d.emitted && d.outcome === 'stay_silent' && d.silence.reason).toBe('below_value_bar')
      expect(d.value?.surface).toBe(false)
      expect(d.value?.failed).toContain(criterion)
    })
  }

  it('C:safe_effect → silence when Gate 1 did not classify reversible', () => {
    const v = evaluateValue(input({ reversibility: 'irreversible' }))
    expect(v.surface).toBe(false)
    expect(v.failed).toContain('safe_effect')
  })
})

// ─────────────────────── 13. fail-closed on anything odd ────────────────────

describe('fail-closed', () => {
  it('a throwing accessor fails every criterion rather than surfacing', () => {
    const hostile = input()
    Object.defineProperty(hostile, 'settled', {
      get() {
        throw new Error('boom')
      },
    })
    const v = evaluateValue(hostile)
    expect(v.surface).toBe(false)
    expect(v.failed).toEqual([...VALUE_CRITERIA])
  })

  it('a malformed input fails closed', () => {
    for (const bad of [null, undefined, {}, { subject: SUBJECT }, { subject: SUBJECT, settled: [] }]) {
      expect(evaluateValue(bad as unknown as ValueInput).surface).toBe(false)
    }
  })

  it('a non-boolean ownership value is treated as owned (silence)', () => {
    const v = evaluateValue(input({}, { ownedByDeterministicNotification: 'no' as unknown as boolean }))
    expect(v.surface).toBe(false)
    expect(v.failed).toContain('notification_novelty')
  })

  it('a NaN / missing clock fails cost_of_waiting', () => {
    expect(evaluateValue(input({}, { clock: { nowMs: NaN, dayStart: NaN, dayEnd: NaN } })).failed).toContain('cost_of_waiting')
    expect(evaluateValue(input({}, { clock: undefined as unknown as ValueContext['clock'] })).surface).toBe(false)
  })
})

// ───────────────────────── 14 & 15. vigilance scope ─────────────────────────

describe('the vigilance override is exactly as narrow as the Constitution allows', () => {
  it('waives only cost_of_waiting and evidence_sufficiency', () => {
    expect([...VIGILANCE_WAIVABLE].sort()).toEqual(['cost_of_waiting', 'evidence_sufficiency'])
  })

  it('waives a stale deadline for a declared class', () => {
    const v = evaluateValue(input({}, { expectedByMs: null, vigilance: 'passed_deadline' }))
    expect(v.surface).toBe(true)
    expect(v.waived).toContain('cost_of_waiting')
  })

  it('waives thin evidence for a declared class', () => {
    const absence = question({
      traceRefs: [leadTrace()],
      provenance: { traceRefs: [leadTrace()], inferentialDistance: 'low', isAbsenceDerived: true },
    })
    const v = evaluateValue(input({ settled: [absence], observationCount: 0 }, { vigilance: 'cadence_break' }))
    expect(v.surface).toBe(true)
    expect(v.waived).toContain('evidence_sufficiency')
  })

  it('can NEVER bypass notification ownership (DA-001 §13)', () => {
    for (const cls of ['dropped_commitment', 'passed_deadline', 'cadence_break'] as const) {
      const v = evaluateValue(input({}, { ownedByDeterministicNotification: true, vigilance: cls }))
      expect(v.surface).toBe(false)
      expect(v.failed).toContain('notification_novelty')
      expect(v.waived).toEqual([])
    }
  })

  it('can NEVER bypass C1, C2, C6 or C7', () => {
    const blocked: Array<[ValueCriterion, ValueInput]> = [
      ['qualifying_state', input({}, { state: null, vigilance: 'passed_deadline' })],
      ['subject_actionable', input({ subject: { subjectType: 'portfolio', subjectId: 'p1' } }, { vigilance: 'passed_deadline' })],
      [
        'subject_anchoring',
        input({ settled: [question({ traceRefs: [{ type: 'message', id: 'm9' }] })] }, { vigilance: 'passed_deadline' }),
      ],
      ['safe_effect', input({ reversibility: 'irreversible' }, { vigilance: 'passed_deadline' })],
    ]
    for (const [criterion, i] of blocked) {
      const v = evaluateValue(i)
      expect(v.surface).toBe(false)
      expect(v.failed).toContain(criterion)
    }
  })

  it('an undeclared or forged vigilance class waives nothing', () => {
    for (const forged of [null, 'urgent', 'CRITICAL', '', 0, true]) {
      const v = evaluateValue(input({}, { expectedByMs: null, vigilance: forged as unknown as ValueContext['vigilance'] }))
      expect(v.surface).toBe(false)
      expect(v.failed).toContain('cost_of_waiting')
    }
  })
})

// ───────────────── 16. Condition 13 is compiler-enforced ────────────────────

describe('deterministic notification ownership is a total, typed registry', () => {
  it('declares an ownership verdict for every expectation that exists', () => {
    expect(Object.keys(NOTIFICATION_OWNERSHIP).sort()).toEqual(Object.keys(DETECTORS).sort())
    expect(Object.keys(VIGILANCE_CLASS).sort()).toEqual(Object.keys(DETECTORS).sort())
  })

  it('has no entry for an expectation that does not exist', () => {
    // The COMPILE-TIME guarantee (a new ExpectationKind with no entry fails tsc)
    // cannot be asserted from inside a passing test file — it is verified by the
    // compile-time mutation in the Phase 4.1 report: deleting the key below makes
    // `npx tsc --noEmit` fail with TS2741. What is checkable here is that no
    // undeclared expectation has silently acquired a verdict.
    expect((NOTIFICATION_OWNERSHIP as Record<string, unknown>)['cadence.break']).toBeUndefined()
  })

  it('followup.overdue is owned, so the AI stays silent about it', () => {
    expect(NOTIFICATION_OWNERSHIP['followup.overdue']).toBe('followup.overdue')
    expect(isOwnedByDeterministicNotification('followup.overdue')).toBe(true)
    const d = decide(
      understanding(),
      surfaceCtx({ ownedByDeterministicNotification: isOwnedByDeterministicNotification('followup.overdue') }),
    )
    expect(d.outcome).toBe('stay_silent')
  })

  it('a declared vigilance class still cannot rescue an owned expectation', () => {
    expect(vigilanceClassFor('followup.overdue')).toBe('passed_deadline')
    const v = evaluateValue(
      input({}, { ownedByDeterministicNotification: true, vigilance: vigilanceClassFor('followup.overdue') }),
    )
    expect(v.surface).toBe(false)
  })
})

// ───────────────────── 17. the trace records the verdict ────────────────────

describe('the decision trace records the Value Bar result', () => {
  it('names the suppressing criterion on failure', () => {
    const d = decide(understanding(), surfaceCtx({ state: null, ownedByDeterministicNotification: true }))
    const step = d.trace.find((s) => s.boundary === 'value')!
    expect(step.passed).toBe(false)
    expect(step.detail).toContain('qualifying_state')
    expect(step.detail).toContain('notification_novelty')
    expect(d.value).toEqual({ surface: false, failed: expect.arrayContaining(['qualifying_state']), waived: [] })
  })

  it('records a clear pass, and names any waived criterion', () => {
    expect(decide(understanding(), surfaceCtx()).trace.find((s) => s.boundary === 'value')!.detail).toBe('cleared')
    const waived = decide(understanding(), surfaceCtx({ expectedByMs: null, vigilance: 'passed_deadline' }))
    expect(waived.trace.find((s) => s.boundary === 'value')!.detail).toContain('vigilance waived: cost_of_waiting')
    expect(waived.outcome).toBe('recommend')
  })
})

// ─────────────── 18–20. Phase 4.1 introduces no side effects ────────────────

describe('Phase 4.1 introduces no provider, CRM write, or notification', () => {
  const read = (p: string) => require('node:fs').readFileSync(p, 'utf8')
  const FILES = [
    'lib/ai/runtime/valueBar.ts',
    'lib/ai/runtime/toolAction.ts',
    'lib/ai/runtime/toolActionTypes.ts',
    'lib/ai/integration/notificationOwnership.ts',
  ]

  it('imports no AI provider or router', () => {
    for (const f of FILES) {
      expect(read(f)).not.toMatch(/@ai-sdk|from 'ai'|openai|anthropic|runStructured|admitAiRun|generateText/i)
    }
  })

  it('performs no database or CRM write', () => {
    for (const f of FILES) {
      expect(read(f)).not.toMatch(/@\/config\/db|knex|\.insert\(|\.update\(|\.delete\(|writeBelief/)
    }
  })

  it('emits no notification — the ownership map imports a TYPE only', () => {
    const own = read('lib/ai/integration/notificationOwnership.ts')
    expect(own).toMatch(/import type \{ NotificationType \} from '@\/lib\/notifications\/types'/)
    expect(own).not.toMatch(/notifyEvent|enqueueNotification|deliverWebPush/)
    for (const f of FILES) expect(read(f)).not.toMatch(/notifyEvent|enqueueNotification|deliverWebPush/)
  })

  it('the runtime still depends only on its siblings and @/db/ai', () => {
    for (const f of ['lib/ai/runtime/valueBar.ts', 'lib/ai/runtime/toolActionTypes.ts']) {
      // Anchored to real import statements: a doc comment that merely mentions a
      // module path is prose, not a dependency.
      const imports = [...read(f).matchAll(/^import[^']*from '([^']+)'/gm)].map((m) => m[1]!)
      expect(imports.length).toBeGreaterThan(0)
      for (const i of imports) expect(i.startsWith('./') || i.startsWith('@/db/ai/')).toBe(true)
    }
  })

  it('signalWorker is NOT wired to surface mode', () => {
    const worker = read('lib/ai/integration/signalWorker.ts')
    expect(worker).not.toMatch(/mode: 'surface'|ValueContext|valueBar/)
  })
})
