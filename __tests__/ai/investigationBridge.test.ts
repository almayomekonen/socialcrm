/**
 * Phase 4.3 — the bridge from validated Agent claims to a ReasonedUnderstanding.
 *
 * The whole reason this module needs its own suite is that it sits on the one
 * seam where a dishonest number could enter the system. Every test here is about
 * what the bridge REFUSES to say.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { bridgeInvestigation, distanceForClaim, UNCALIBRATED } from '@/lib/ai/integration/investigationBridge'
import { decide } from '@/lib/ai/runtime/toolAction'
import { evaluateValue, VIGILANCE_WAIVABLE } from '@/lib/ai/runtime/valueBar'
import { createEvidenceCollector } from '@/lib/agent/evidence'
import { validateAgentAnswer } from '@/lib/agent/validate'
import { INVESTIGATION_OBJECTIVE, objectiveFor } from '@/lib/ai/integration/investigationObjective'
import { DETECTORS } from '@/lib/ai/integration/detectors/registry'
import type { Claim, EvidenceRef } from '@/lib/agent/types'

const SCOPE = { agencyId: 7 }
const SUBJECT = { subjectType: 'lead' as const, subjectId: '100' }
const ASOF = '2026-08-25T10:00:00.000Z'

const fact = (refs: string[] = ['100']): Claim => ({ claimClass: 'FACT', text: 'f', entityEvidence: refs })
const observation = (refs: string[] = ['today.total']): Claim => ({ claimClass: 'OBSERVATION', text: 'o', metricEvidence: refs })
const inference = (refs: string[] = ['100']): Claim => ({ claimClass: 'INFERENCE', text: 'ייתכן ש', evidence: refs })
const recommendation = (refs: string[] = ['100']): Claim => ({ claimClass: 'RECOMMENDATION', text: 'r', evidence: refs })

const leadEv: EvidenceRef = { kind: 'lead', refId: '100' }
const metricEv: EvidenceRef = { kind: 'metric', metric: 'today.total', window: { from: ASOF, to: ASOF }, n: 5 }

const build = (claims: Claim[], evidence: EvidenceRef[] = [leadEv]) =>
  bridgeInvestigation({ scope: SCOPE, subject: SUBJECT, claims, evidence, reason: 'absence', asOf: ASOF })

// ───────────── B4 · never calibratable ─────────────

describe('B4 · every Agent-derived conclusion is structurally uncalibratable', () => {
  it('marks calibratable false on every question, for every claim class', () => {
    const u = build([fact(), observation(), inference(), recommendation()], [leadEv, metricEv])
    expect(u.questions).toHaveLength(4)
    for (const q of u.questions) expect(q.calibratable).toBe(false)
    expect(u.uncertainty.anyUncalibratable).toBe(true)
  })

  it('has no code path that can set it true', () => {
    const src = readFileSync('lib/ai/integration/investigationBridge.ts', 'utf8')
    expect(src).toMatch(/\bcalibratable: false/)
    // Word-anchored: `anyUncalibratable: true` legitimately contains the
    // substring `calibratable: true`, and matching it would fail on correct code.
    expect(src).not.toMatch(/(^|[^a-zA-Z])calibratable: true/)
  })
})

// ───────────── B2 · the number is inert ─────────────

describe('B2 · confidence is never invented and never load-bearing', () => {
  it('uses ONE declared constant, never a per-claim scale', () => {
    const u = build([fact(), inference(), recommendation()])
    const values = new Set(u.questions.flatMap((q) => [q.leading.credence, q.leading.groundedness]))
    expect([...values]).toEqual([UNCALIBRATED])
  })

  it('derives nothing from the model — identical claims of different classes score identically', () => {
    const a = build([fact()])
    const b = build([inference()])
    expect(a.questions[0]!.leading.credence).toBe(b.questions[0]!.leading.credence)
    expect(a.questions[0]!.leading.groundedness).toBe(b.questions[0]!.leading.groundedness)
  })

  it('NO gate seam or Value Bar criterion branches on credence or groundedness', () => {
    // The invariant that keeps the constant inert. If this ever fails, the number
    // has become a claim about the world and the bridge has stopped being honest.
    const strip = (p: string) =>
      readFileSync(p, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
    for (const f of ['lib/ai/runtime/toolAction.ts', 'lib/ai/runtime/valueBar.ts']) {
      const code = strip(f)
      // Carrying the value into the output is fine; comparing it is not.
      expect(code).not.toMatch(/credence\s*[<>=!]=?[^=]/)
      expect(code).not.toMatch(/groundedness\s*[<>]=?/)
      expect(code).not.toMatch(/(credence|groundedness)\s*(>=|<=|>|<)\s*[\d.]/)
    }
  })

  it('the gate reaches the same verdict whatever the constant is', () => {
    const u = build([fact()])
    const value = {
      state: 'FOLLOWUP_OVERDUE',
      ownedByDeterministicNotification: false,
      expectedByMs: Date.parse('2026-08-23T00:00:00.000Z'),
      clock: {
        nowMs: Date.parse(ASOF),
        dayStart: Date.parse('2026-08-25T00:00:00.000Z'),
        dayEnd: Date.parse('2026-08-26T00:00:00.000Z'),
      },
      vigilance: null,
    }
    const ctx = { scope: SCOPE, now: new Date(ASOF), intent: { mode: 'surface' as const, value } }
    const normal = decide(u, ctx)
    // Tampered to the EXTREMES, so ANY threshold a future change might introduce
    // is crossed in one direction or the other. If the verdict moves, some seam
    // has started reading a number that carries no claim about the world.
    const at = (v: number) => {
      const t = structuredClone(u)
      for (const q of t.questions) {
        q.leading.credence = v
        q.leading.groundedness = v
        q.hypotheses[0]!.credence = v
      }
      return decide(t, ctx).outcome
    }
    expect(at(0)).toBe(normal.outcome)
    expect(at(1)).toBe(normal.outcome)
    expect(at(0)).toBe(at(1))
  })
})

// ───────────── B5 · inferential-distance honesty ─────────────

describe('B5 · inferential distance follows the claim class', () => {
  it('FACT and OBSERVATION are low; INFERENCE and RECOMMENDATION are high', () => {
    expect(distanceForClaim(fact())).toBe('low')
    expect(distanceForClaim(observation())).toBe('low')
    expect(distanceForClaim(inference())).toBe('high')
    expect(distanceForClaim(recommendation())).toBe('high')
  })

  it('carries the same distance into the provenance, never a lower one', () => {
    const u = build([inference()])
    expect(u.questions[0]!.inferentialDistance).toBe('high')
    expect(u.questions[0]!.provenance.inferentialDistance).toBe('high')
    expect(u.uncertainty.anyHighInference).toBe(true)
  })
})

// ───────────── B3 · only validated evidence becomes a trace ─────────────

describe('B3 · only evidence the TOOLS produced becomes a trace', () => {
  it('a ref with no matching evidence contributes nothing', () => {
    const u = build([fact(['999'])], [leadEv])
    expect(u.questions[0]!.provenance.traceRefs).toEqual([])
  })

  // Revised deliberately by the Design A fix. A metric still has no trace
  // identity OF ITS OWN; what changed is that a metric measured over one entity
  // now resolves to THAT entity, which is a real openable row. A metric measured
  // over no single subject — every portfolio metric — still carries nothing.
  it('a metric measured over no single entity still carries no trace', () => {
    const u = build([observation(['today.total'])], [metricEv])
    expect(u.questions[0]!.provenance.traceRefs).toEqual([])
  })

  it('a metric measured on a lead resolves to THAT lead, never to a metric trace', () => {
    const lead1696: EvidenceRef = { kind: 'lead', refId: '1696' }
    const measured: EvidenceRef = {
      kind: 'metric',
      metric: 'lead.overdueTaskCount',
      window: { from: ASOF, to: ASOF },
      n: 0,
      measuredOn: { kind: 'lead', refId: '1696' },
    }
    const u = build([observation(['lead.overdueTaskCount'])], [lead1696, measured])
    expect(u.questions[0]!.provenance.traceRefs).toEqual([{ type: 'lead', id: '1696' }])
  })

  it('an entity ref the tools produced becomes exactly one trace', () => {
    const u = build([fact(['100'])], [leadEv])
    expect(u.questions[0]!.provenance.traceRefs).toEqual([{ type: 'lead', id: '100' }])
  })

  it('duplicate refs collapse', () => {
    const u = build([fact(['100', '100'])], [leadEv])
    expect(u.questions[0]!.provenance.traceRefs).toHaveLength(1)
  })

  it('never marks a claim absence-derived, so a traceless claim cannot slip the provenance seam', () => {
    const u = build([observation(['today.total'])], [metricEv])
    expect(u.questions[0]!.provenance.isAbsenceDerived).toBe(false)
  })

  it('is ungrounded when nothing survived, or when the tools produced nothing', () => {
    expect(build([]).isGrounded).toBe(false)
    expect(build([fact()], []).isGrounded).toBe(false)
    expect(build([fact()], [leadEv]).isGrounded).toBe(true)
  })

  it('counts distinct traces, not claims', () => {
    const u = build([fact(['100']), inference(['100'])], [leadEv])
    expect(u.observationCount).toBe(1)
    expect(u.beliefCount).toBe(2)
  })
})

// ───────────── the objective is system-authored ─────────────

describe('the investigation objective is system-authored and total', () => {
  it('declares one objective per declared detector', () => {
    expect(Object.keys(INVESTIGATION_OBJECTIVE).sort()).toEqual(Object.keys(DETECTORS).sort())
  })

  it('is the exact approved text for followup.overdue', () => {
    expect(objectiveFor('followup.overdue')).toBe(
      'Investigate this overdue follow-up. Determine what the lead was waiting for, what the latest conversation/context indicates, whether the expected follow-up is still relevant, and what concrete action the business should take now. Base every conclusion on cited CRM evidence. Do not invent missing facts.',
    )
  })

  it('interpolates no lead data — identity reaches the Agent through scope and tools only', () => {
    for (const text of Object.values(INVESTIGATION_OBJECTIVE)) {
      expect(text).not.toMatch(/\$\{|\{\{|%s/)
    }
  })

  it('throws rather than inventing an objective for an undeclared expectation', () => {
    expect(() => objectiveFor('cadence.break')).toThrow(/no declared objective/)
  })
})

// ───────── PROD-7 · subject-bound metric provenance (Design A) ─────────
//
// Production investigation 7 (lead 1696, agency 103) returned a schema-valid,
// correctly subject-targeted answer and was rejected at the PROVENANCE seam —
// two seams before the Value Bar. `ai_shadow_coverage` row 58 recorded
// rejectionBoundary "provenance" with trace [scope:pass, provenance:fail].
//
// Root cause: the metric EvidenceRef was subject-less. `get_lead(1696)` measured
// `lead.overdueTaskCount` OVER lead 1696 and then discarded that binding, so the
// number named nothing openable and no provenance could be walked.
//
// Design A binds the measurement to its subject. These tests assert the fixed
// behaviour AND the safety bounds that keep the fix from becoming a loophole.

describe('PROD-7 · a metric measured on the subject carries that subject as provenance', () => {
  const SUBJ = { subjectType: 'lead' as const, subjectId: '1696' }
  const lead1696: EvidenceRef = { kind: 'lead', refId: '1696' }
  const overdueMetric: EvidenceRef = {
    kind: 'metric',
    metric: 'lead.overdueTaskCount',
    window: { from: ASOF, to: ASOF },
    n: 0,
    measuredOn: { kind: 'lead', refId: '1696' },
  }
  /** Exactly what get_lead(1696) now puts in the pool. */
  const POOL: EvidenceRef[] = [lead1696, overdueMetric]

  const prodBuild = (claims: Claim[], evidence: EvidenceRef[] = POOL) =>
    bridgeInvestigation({ scope: SCOPE, subject: SUBJ, claims, evidence, reason: 'absence', asOf: ASOF })

  const prodCtx = {
    scope: SCOPE,
    now: new Date('2026-08-30T10:12:40.816Z'),
    intent: {
      mode: 'surface' as const,
      value: {
        state: 'OPEN_LOOP_SLA',
        ownedByDeterministicNotification: false,
        expectedByMs: Date.parse('2026-08-30T09:12:11.219Z'),
        clock: {
          nowMs: Date.parse('2026-08-30T10:12:40.816Z'),
          dayStart: Date.parse('2026-08-30T00:00:00.000Z'),
          dayEnd: Date.parse('2026-08-31T00:00:00.000Z'),
        },
        vigilance: null,
      },
    },
  }

  /** Narrow the way production does — a Recommend decision carries no rejection. */
  const rejectionOf = (d: ReturnType<typeof decide>) => ('rejection' in d ? d.rejection : undefined)

  /** The verbatim claim investigation 7 produced. */
  const prodClaim: Claim = {
    claimClass: 'OBSERVATION',
    text: 'מספר המשימות שבאיחור הוא 0.',
    metricEvidence: ['lead.overdueTaskCount'],
  }

  it('resolves the metric-only claim to the SUBJECT lead trace', () => {
    const q = prodBuild([prodClaim]).questions[0]!
    expect(q.key).toBe('agent.claim.0')
    expect(q.provenance.traceRefs).toEqual([{ type: 'lead', id: '1696' }])
    expect(q.provenance.isAbsenceDerived).toBe(false)
  })

  it('passes the provenance seam and reaches the Value Bar', () => {
    const d = decide(prodBuild([prodClaim]), prodCtx)
    expect(rejectionOf(d)).toBeUndefined()
    const boundaries = d.trace.map((s) => s.boundary)
    expect(boundaries).toContain('provenance')
    expect(d.trace.find((s) => s.boundary === 'provenance')!.passed).toBe(true)
    expect(boundaries).toContain('value')
    expect(d.value).toBeDefined()
  })

  it('satisfies C5 evidence_sufficiency and C6 subject_anchoring', () => {
    const u = prodBuild([prodClaim])
    expect(u.observationCount).toBeGreaterThan(0)
    const v = evaluateValue({
      subject: SUBJ,
      settled: u.questions,
      observationCount: u.observationCount,
      reversibility: 'reversible',
      context: prodCtx.intent.value,
    })
    expect(v.failed).not.toContain('evidence_sufficiency')
    expect(v.failed).not.toContain('subject_anchoring')
  })

  it('mixed FACT + metric OBSERVATION is no longer rejected for the OBSERVATION', () => {
    const d = decide(prodBuild([{ claimClass: 'FACT', text: 'f', entityEvidence: ['1696'] }, prodClaim]), prodCtx)
    expect(rejectionOf(d)).toBeUndefined()
    expect(d.value).toBeDefined()
  })

  it('FACT/entityEvidence behaviour is unchanged', () => {
    const q = prodBuild([{ claimClass: 'FACT', text: 'f', entityEvidence: ['1696'] }]).questions[0]!
    expect(q.provenance.traceRefs).toEqual([{ type: 'lead', id: '1696' }])
    // An entity ref with no matching evidence still contributes nothing.
    expect(prodBuild([{ claimClass: 'FACT', text: 'f', entityEvidence: ['999'] }]).questions[0]!.provenance.traceRefs).toEqual([])
  })

  // ─────────────────────────── safety bounds ───────────────────────────

  it('SAFETY · a portfolio metric (no measuredOn) remains non-walkable', () => {
    const portfolio: EvidenceRef = { kind: 'metric', metric: 'today.total', window: { from: ASOF, to: ASOF }, n: 5 }
    const u = prodBuild([observation(['today.total'])], [lead1696, portfolio])
    expect(u.questions[0]!.provenance.traceRefs).toEqual([])
    expect(rejectionOf(decide(u, prodCtx))?.boundary).toBe('provenance')
  })

  it('SAFETY · a metric measured on a DIFFERENT lead does not satisfy C6 for lead 1696', () => {
    const other: EvidenceRef = { kind: 'lead', refId: '4242' }
    const onOther: EvidenceRef = {
      kind: 'metric',
      metric: 'lead.overdueTaskCount',
      window: { from: ASOF, to: ASOF },
      n: 0,
      measuredOn: { kind: 'lead', refId: '4242' },
    }
    const u = prodBuild([prodClaim], [other, onOther])
    // It walks — to lead 4242, honestly — but it is not the subject.
    expect(u.questions[0]!.provenance.traceRefs).toEqual([{ type: 'lead', id: '4242' }])
    const v = evaluateValue({
      subject: SUBJ,
      settled: u.questions,
      observationCount: u.observationCount,
      reversibility: 'reversible',
      context: prodCtx.intent.value,
    })
    expect(v.failed).toContain('subject_anchoring')
    expect(v.surface).toBe(false)
  })

  it('SAFETY · measuredOn naming an entity no tool returned yields no trace', () => {
    const orphan: EvidenceRef = {
      kind: 'metric',
      metric: 'lead.overdueTaskCount',
      window: { from: ASOF, to: ASOF },
      n: 0,
      measuredOn: { kind: 'lead', refId: '9999' },
    }
    expect(prodBuild([prodClaim], [orphan]).questions[0]!.provenance.traceRefs).toEqual([])
  })

  it('SAFETY · no trace is ever of type "metric"', () => {
    const u = prodBuild([prodClaim])
    for (const q of u.questions) for (const t of q.provenance.traceRefs) expect(t.type).not.toBe('metric')
    // Source guard against a future "just give metrics their own trace type".
    // Comments are stripped first: the doc comment legitimately NAMES the shape
    // it forbids, and matching prose would fail on correct code.
    const code = readFileSync('lib/ai/integration/investigationBridge.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(code).not.toMatch(/type:\s*['"]metric['"]/)
  })

  it('SAFETY · agent claims are never marked absence-derived', () => {
    for (const q of prodBuild([prodClaim]).questions) expect(q.provenance.isAbsenceDerived).toBe(false)
    const src = readFileSync('lib/ai/integration/investigationBridge.ts', 'utf8')
    expect(src).toMatch(/isAbsenceDerived: false/)
    expect(src).not.toMatch(/isAbsenceDerived: true/)
  })

  it('SAFETY · subject_anchoring is not vigilance-waivable', () => {
    expect(VIGILANCE_WAIVABLE.has('subject_anchoring')).toBe(false)
    expect([...VIGILANCE_WAIVABLE].sort()).toEqual(['cost_of_waiting', 'evidence_sufficiency'])
  })

  it('SAFETY · hasWalkableProvenance is unchanged (traces OR absence, nothing more)', () => {
    const src = readFileSync('lib/ai/runtime/toolAction.ts', 'utf8')
    expect(src).toMatch(/return q\.provenance\.traceRefs\.length > 0 \|\| q\.provenance\.isAbsenceDerived/)
  })

  it('SAFETY · an OBSERVATION still cannot cite an entity id — the validator strips it', () => {
    const ev = createEvidenceCollector()
    ev.add(lead1696)
    ev.add(overdueMetric)
    const answer = {
      headline: 'h',
      claims: [{ claimClass: 'OBSERVATION' as const, text: 'o', metricEvidence: ['1696'] }],
      unknown: null,
    }
    // '1696' is a real entity in the pool, but it is not a metric name, so the
    // OBSERVATION cannot borrow it — the claim loses its only ref and is dropped.
    const out = validateAgentAnswer(answer as never, ev)
    expect(out?.claims ?? []).toHaveLength(0)
  })

  it('SAFETY · one metric measured on two leads is two evidence records, not one', () => {
    const ev = createEvidenceCollector()
    ev.add({ ...overdueMetric })
    ev.add({ ...overdueMetric, measuredOn: { kind: 'lead', refId: '4242' } })
    const metrics = ev.all().filter((e) => e.kind === 'metric')
    expect(metrics).toHaveLength(2)
  })

  it('SAFETY · two metrics measured on ONE lead collapse to a single trace', () => {
    const second: EvidenceRef = {
      kind: 'metric',
      metric: 'lead.daysSinceLastInteraction',
      window: { from: ASOF, to: ASOF },
      n: 8,
      measuredOn: { kind: 'lead', refId: '1696' },
    }
    const claim: Claim = {
      claimClass: 'OBSERVATION',
      text: 'o',
      metricEvidence: ['lead.overdueTaskCount', 'lead.daysSinceLastInteraction'],
    }
    const u = prodBuild([claim], [lead1696, overdueMetric, second])
    expect(u.questions[0]!.provenance.traceRefs).toEqual([{ type: 'lead', id: '1696' }])
    expect(u.observationCount).toBe(1)
  })
})
