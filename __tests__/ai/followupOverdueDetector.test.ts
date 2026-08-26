/**
 * Phase-1 detector — `followup.overdue`. Pure unit tests, no DB, no model.
 *
 * Proves the detector produces a signal the RATIFIED ingress accepts, that it
 * stays silent on every lead that is not overdue, that it defers to
 * `lib/today/classify.ts` for what "overdue" means (priority order included),
 * and that a signal carries no customer, user or permission identity.
 *
 * Runs under `test:unit` (VITEST_NO_DB=1).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { detectFollowupOverdue, FOLLOWUP_OVERDUE_EXPECTATION } from '@/lib/ai/integration/detectors/followupOverdue'
import { DETECTORS, DETECTOR_LIST } from '@/lib/ai/integration/detectors/registry'
import { interpret } from '@/lib/ai/runtime/eventInterpretation'
import { businessDayBounds } from '@/lib/today/time'
import { NO_CONVERSATION_FACTS } from '@/db/ai/conversationFacts'
import type { LeadFact } from '@/lib/today/types'
import type { Scope } from '@/db/ai/stateManagement'

const NOW = new Date('2026-08-25T09:00:00.000Z')
const ctx = businessDayBounds(NOW.getTime())
const SCOPE: Scope = { agencyId: 103 }
const DAY = 86_400_000

function fact(over: Partial<LeadFact> = {}): LeadFact {
  return {
    id: 77,
    name: null,
    phone: null,
    status: 'contacted',
    leadSource: 'manual',
    createdAt: ctx.nowMs - 30 * DAY,
    nextFollowUpAt: null,
    lastActivityAt: ctx.nowMs - 5 * DAY,
    lastInboundAt: null,
    lastHumanOutboundAt: null,
    hasOpenTask: false,
    earliestOpenTaskDueAt: null,
    ...over,
  }
}

/** A follow-up date before today's business-day start. */
const OVERDUE = { nextFollowUpAt: ctx.dayStart - 2 * DAY }

// ── A. an overdue lead produces a valid ExternalSignal ────────────────────────

describe('A · overdue lead → ExternalSignal', () => {
  it('emits exactly one absence signal with the complete canonical shape', () => {
    const [signal, ...rest] = detectFollowupOverdue([fact(OVERDUE)], ctx, SCOPE)
    expect(rest).toHaveLength(0)
    expect(signal.signalType).toBe('absence')
    expect(signal.scope).toEqual({ agencyId: 103 })
    expect(signal.source).toEqual({ kind: 'system', id: 'detector:followup.overdue' })
    expect(signal.occurredAt).toBe(NOW.toISOString())
    expect(signal.subject).toEqual({ subjectType: 'lead', subjectId: '77' })
    expect(signal.traceRefs).toEqual([{ type: 'lead', id: '77' }])
    expect(signal.inferentialDistance).toBe('low')
  })

  it('carries no severity, no needsInvestigation, and no tier — admission is M4’s', () => {
    const [signal] = detectFollowupOverdue([fact(OVERDUE)], ctx, SCOPE)
    for (const forbidden of ['severity', 'severityHint', 'needsInvestigation', 'tier', 'priority', 'rank']) {
      expect(signal as unknown as Record<string, unknown>).not.toHaveProperty(forbidden)
    }
  })

  it('preserves input order and never ranks subjects against one another', () => {
    const facts = [
      fact({ id: 3, ...OVERDUE, nextFollowUpAt: ctx.dayStart - 1 * DAY }),
      fact({ id: 1, ...OVERDUE, nextFollowUpAt: ctx.dayStart - 90 * DAY }), // far more overdue
      fact({ id: 2, ...OVERDUE, nextFollowUpAt: ctx.dayStart - 5 * DAY }),
    ]
    const ids = detectFollowupOverdue(facts, ctx, SCOPE).map((s) => s.subject!.subjectId)
    expect(ids).toEqual(['3', '1', '2'])
  })
})

// ── B. a non-overdue lead produces nothing ───────────────────────────────────

describe('B · non-overdue lead → nothing', () => {
  it.each([
    ['no follow-up date at all', { nextFollowUpAt: null }],
    ['due later today', { nextFollowUpAt: ctx.dayStart + 3_600_000 }],
    ['due in the future', { nextFollowUpAt: ctx.dayEnd + 5 * DAY }],
    ['due exactly at the business-day start (not yet overdue)', { nextFollowUpAt: ctx.dayStart }],
  ])('%s', (_label, over) => {
    expect(detectFollowupOverdue([fact(over as Partial<LeadFact>)], ctx, SCOPE)).toEqual([])
  })

  it('defers to classify.ts priority: an overdue lead who is also WAITING_REPLY is not ours', () => {
    // classifyLead evaluates WAITING_REPLY before FOLLOWUP_OVERDUE. A hand-rolled
    // `nextFollowUpAt < dayStart` predicate would wrongly emit here.
    const waiting = fact({ ...OVERDUE, lastInboundAt: ctx.nowMs - 2 * 3_600_000, lastHumanOutboundAt: ctx.nowMs - 3 * DAY })
    expect(detectFollowupOverdue([waiting], ctx, SCOPE)).toEqual([])
  })
})

// ── C. a terminal lead produces nothing ──────────────────────────────────────

describe('C · terminal lead → nothing', () => {
  it.each(['closed', 'lost'])('status=%s is excluded even when overdue', (status) => {
    expect(detectFollowupOverdue([fact({ ...OVERDUE, status })], ctx, SCOPE)).toEqual([])
  })

  it('a non-terminal lead with the same dates still qualifies (the status is what excluded it)', () => {
    expect(detectFollowupOverdue([fact({ ...OVERDUE, status: 'contacted' })], ctx, SCOPE)).toHaveLength(1)
  })
})

// ── D. the absence marker is complete and accepted by interpret() ────────────

describe('D · absence marker → accepted by M3', () => {
  it('the marker names the violated expectation and the deadline it passed', () => {
    const [signal] = detectFollowupOverdue([fact(OVERDUE)], ctx, SCOPE)
    expect(signal.absence).toEqual({
      violatedExpectation: FOLLOWUP_OVERDUE_EXPECTATION,
      expectedBy: new Date(ctx.dayStart - 2 * DAY).toISOString(),
      sinceLastSignalAt: new Date(ctx.nowMs - 5 * DAY).toISOString(),
    })
  })

  it('interpret() accepts it as an absence_detected event, absence-derived', () => {
    const [signal] = detectFollowupOverdue([fact(OVERDUE)], ctx, SCOPE)
    const result = interpret(signal)
    expect(result.accepted).toBe(true)
    if (result.accepted !== true) return
    expect(result.event.kind).toBe('absence_detected')
    if (result.event.kind !== 'absence_detected') return
    expect(result.event.signal.isAbsenceDerived).toBe(true)
    expect(result.event.signal.absenceMarker?.violatedExpectation).toBe(FOLLOWUP_OVERDUE_EXPECTATION)
    expect(result.event.signal.sourceReliability).toBe(1) // system source
    expect(result.event.signal.provenance.traceRefs).toEqual([{ type: 'lead', id: '77' }])
  })

  // MUTATION GUARD: strip the absence marker → M3 must refuse the signal.
  it('without a violated expectation, M3 refuses it (missing_absence_marker)', () => {
    const [signal] = detectFollowupOverdue([fact(OVERDUE)], ctx, SCOPE)
    const stripped = { ...signal, absence: undefined }
    const result = interpret(stripped)
    expect(result.accepted).toBe(false)
    if (result.accepted !== false) return
    expect(result.rejection.code).toBe('missing_absence_marker')
  })

  // MUTATION GUARD: an empty expectation string is not a marker either.
  it('an empty violated expectation is refused', () => {
    const [signal] = detectFollowupOverdue([fact(OVERDUE)], ctx, SCOPE)
    const blank = { ...signal, absence: { violatedExpectation: '' } }
    expect(interpret(blank).accepted).toBe(false)
  })
})

// ── I. the signal carries no user / permission / customer identity ───────────

describe('I · no identity in a signal', () => {
  it('emits neither customer PII nor any operator or permission context', () => {
    const withPii = fact({ ...OVERDUE, name: 'סאלי כהן', phone: '0501234567' })
    const [signal] = detectFollowupOverdue([withPii], ctx, SCOPE)
    const json = JSON.stringify(signal)
    expect(json).not.toContain('סאלי')
    expect(json).not.toContain('0501234567')
    for (const forbidden of ['userId', 'gotPermIds', 'role', 'user', 'perm', 'session']) {
      expect(json.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })

  it('the whole payload is scope + subject + provenance + the violated expectation', () => {
    const [signal] = detectFollowupOverdue([fact(OVERDUE)], ctx, SCOPE)
    expect(Object.keys(signal).sort()).toEqual(
      ['absence', 'inferentialDistance', 'occurredAt', 'scope', 'signalType', 'source', 'subject', 'traceRefs'].sort(),
    )
  })
})

// ── H. nothing on the deterministic path can reach a model provider ──────────

describe('H · deterministic path imports no provider', () => {
  const ROOT = process.cwd()

  /** Modules that must be provably model-free: the ones written here plus M3–M6. */
  const SEEDS = [
    'lib/ai/integration/signalSweep.ts',
    'lib/ai/integration/detectors/registry.ts',
    'lib/ai/integration/detectors/followupOverdue.ts',
    'lib/ai/runtime/eventInterpretation.ts',
    'lib/ai/runtime/scheduler.ts',
    'lib/ai/runtime/reasoning.ts',
    'lib/ai/runtime/toolAction.ts',
    'lib/today/classify.ts',
    'lib/today/time.ts',
  ]

  /** Anything that can produce a model call, directly or by routing to one. */
  const PROVIDER_SPECIFIERS = [
    /^ai$/,
    /^@ai-sdk\//,
    /openai/i,
    /anthropic/i,
    /^@\/lib\/ai\/router/,
    /^@\/lib\/ai\/providers/,
    /^@\/lib\/ai\/gate$/,
    /^@\/lib\/agent\//,
  ]

  function importsOf(rel: string): string[] {
    const src = readFileSync(join(ROOT, rel), 'utf8')
    return [...src.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
  }

  /** Resolve a local specifier to a repo-relative .ts path, or null if external. */
  function resolveLocal(spec: string, fromRel: string): string | null {
    let base: string
    if (spec.startsWith('@/')) base = spec.slice(2)
    else if (spec.startsWith('.')) base = join(fromRel, '..', spec).replace(/^\/+/, '')
    else return null
    for (const cand of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
      if (existsSync(join(ROOT, cand))) return cand
    }
    return null
  }

  it('no module in the closure imports a model, an SDK, or the AI router', () => {
    const seen = new Set<string>()
    const queue = [...SEEDS]
    const violations: string[] = []

    while (queue.length > 0) {
      const rel = queue.shift() as string
      if (seen.has(rel)) continue
      seen.add(rel)
      for (const spec of importsOf(rel)) {
        if (PROVIDER_SPECIFIERS.some((re) => re.test(spec))) violations.push(`${rel} → ${spec}`)
        // Walk only the AI/Today source tree; db/* pulls the whole data layer and
        // is covered by its own seed above.
        const local = resolveLocal(spec, rel)
        if (local && (local.startsWith('lib/ai/') || local.startsWith('lib/today/'))) queue.push(local)
      }
    }

    expect(violations, `provider reachable from the deterministic path:\n${violations.join('\n')}`).toEqual([])
    expect(seen.size).toBeGreaterThanOrEqual(SEEDS.length) // the walk actually ran
  })
})

// ── the registry is a registry ───────────────────────────────────────────────

describe('detector registry', () => {
  it('registers followup.overdue, and the list mirrors the record', () => {
    // Phase 4.5 added `sla.open_loop` beside it. What this asserts is unchanged:
    // this detector is registered under its own expectation and the list mirrors
    // the record, so the sweep driver iterates exactly what is declared.
    expect(DETECTORS['followup.overdue']!.expectation).toBe('followup.overdue')
    expect(DETECTOR_LIST).toHaveLength(Object.keys(DETECTORS).length)
    expect(DETECTOR_LIST.map((d) => d.expectation).sort()).toEqual(Object.keys(DETECTORS).sort())
  })

  it('an entry declares an expectation and a detector — and nothing about admission', () => {
    for (const def of DETECTOR_LIST) {
      expect(Object.keys(def).sort()).toEqual(['detect', 'expectation'])
      expect(typeof def.detect).toBe('function')
    }
  })

  it("every entry's own signals name that entry's expectation", () => {
    for (const def of DETECTOR_LIST) {
      // Wave 1 added conversation-sourced detectors, which read the qualifier's
      // persisted classifications rather than lead state. Passing the empty set
      // keeps this a LEAD-FACT assertion: those detectors correctly emit nothing
      // here, and the ones under test are unaffected.
      for (const s of def.detect([fact(OVERDUE)], ctx, SCOPE, NO_CONVERSATION_FACTS)) {
        // An `absence` names its violated expectation. An observation signal
        // (`message`) has no absence marker — its detector identity lives on
        // `source.id`, which is the form `observationKeyFor` relies on.
        if (s.signalType === 'absence') {
          expect(s.absence?.violatedExpectation).toBe(def.expectation)
        } else {
          expect(s.source.id).toBe(`detector:${def.expectation}`)
        }
      }
    }
  })
})
