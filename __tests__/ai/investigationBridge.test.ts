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

  it('a metric ref has no trace identity, so a metric-only claim carries none', () => {
    const u = build([observation(['today.total'])], [metricEv])
    expect(u.questions[0]!.provenance.traceRefs).toEqual([])
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
