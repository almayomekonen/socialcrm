/**
 * Phase 4.5 detector — `sla.open_loop`. Pure unit tests, no DB, no model.
 *
 * The load-bearing property is DEFERENCE: this detector must not know what an
 * open loop is. Every exclusion below — terminal, scheduled follow-up, open task,
 * stale ceiling, and the whole priority order — is asserted through
 * `classifyLead`, so a detector that started re-deriving the predicate would fail
 * these tests rather than quietly disagreeing with Today.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { detectOpenLoopSla, openLoopExpectedByMs, OPEN_LOOP_SLA_EXPECTATION } from '@/lib/ai/integration/detectors/openLoopSla'
import { DETECTORS, DETECTOR_LIST } from '@/lib/ai/integration/detectors/registry'
import {
  NOTIFICATION_OWNERSHIP,
  VIGILANCE_CLASS,
  isOwnedByDeterministicNotification,
} from '@/lib/ai/integration/notificationOwnership'
import { INVESTIGATION_OBJECTIVE, objectiveFor } from '@/lib/ai/integration/investigationObjective'
import { EXPECTED_STATE } from '@/lib/ai/integration/preconditions'
import { interpret } from '@/lib/ai/runtime/eventInterpretation'
import { classifyLead } from '@/lib/today/classify'
import { businessDayBounds } from '@/lib/today/time'
import { SLA_HOURS_BY_STATUS, STALE_CEILING_DAYS, HOUR_MS } from '@/lib/today/constants'
import type { LeadFact } from '@/lib/today/types'
import type { Scope } from '@/db/ai/stateManagement'

const NOW = new Date('2026-08-25T09:00:00.000Z')
const ctx = businessDayBounds(NOW.getTime())
const SCOPE: Scope = { agencyId: 103 }
const DAY = 86_400_000

/** An `interested` lead (72h SLA) idle 5 days with nothing scheduled. */
function fact(over: Partial<LeadFact> = {}): LeadFact {
  return {
    id: 77,
    name: null,
    phone: null,
    status: 'interested',
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

const detect = (f: LeadFact) => detectOpenLoopSla([f], ctx, SCOPE)

// ───────────── detection is classifyLead's answer, not ours ─────────────

describe('the detector reports exactly what classifyLead classifies', () => {
  it('emits for a lead the State Engine calls OPEN_LOOP_SLA', () => {
    const f = fact()
    expect(classifyLead(f, ctx)).toBe('OPEN_LOOP_SLA')
    const [signal] = detect(f)
    expect(signal).toBeDefined()
    expect(signal!.absence?.violatedExpectation).toBe(OPEN_LOOP_SLA_EXPECTATION)
    expect(signal!.subject).toEqual({ subjectType: 'lead', subjectId: '77' })
  })

  it('emits for every OPEN_LOOP_SLA status and no other', () => {
    for (const [status, hours] of Object.entries(SLA_HOURS_BY_STATUS)) {
      const f = fact({ status, lastActivityAt: ctx.nowMs - (hours * HOUR_MS + DAY) })
      expect(classifyLead(f, ctx)).toBe('OPEN_LOOP_SLA')
      expect(detect(f)).toHaveLength(1)
    }
    // A status with no declared SLA is not an open loop at all.
    const noSla = fact({ status: 'new', leadSource: 'manual' })
    expect(classifyLead(noSla, ctx)).not.toBe('OPEN_LOOP_SLA')
    expect(detect(noSla)).toHaveLength(0)
  })

  /**
   * The priority order, asserted through the classifier. Each case satisfies the
   * SLA conditions AND a higher-priority state; the detector must stay silent
   * because the owed action is a different one.
   */
  const higherPriority: Array<[string, Partial<LeadFact>, string]> = [
    ['WAITING_REPLY wins', { lastInboundAt: ctx.nowMs - 2 * DAY, lastHumanOutboundAt: ctx.nowMs - 6 * DAY }, 'WAITING_REPLY'],
    ['FOLLOWUP_OVERDUE wins', { nextFollowUpAt: ctx.dayStart - DAY }, 'FOLLOWUP_OVERDUE'],
    ['FOLLOWUP_DUE_TODAY wins', { nextFollowUpAt: ctx.dayStart + 3600_000 }, 'FOLLOWUP_DUE_TODAY'],
    ['OVERDUE_TASK wins', { hasOpenTask: true, earliestOpenTaskDueAt: ctx.dayStart - DAY }, 'OVERDUE_TASK'],
  ]
  for (const [name, over, expected] of higherPriority) {
    it(`${name} — the detector defers and stays silent`, () => {
      const f = fact(over)
      expect(classifyLead(f, ctx)).toBe(expected)
      expect(detect(f)).toHaveLength(0)
    })
  }
})

// ───────────── the exclusions, all inherited ─────────────

describe('exclusions come from the State Engine, not from this file', () => {
  it('a terminal lead never emits', () => {
    for (const status of ['closed', 'lost']) {
      const f = fact({ status })
      expect(classifyLead(f, ctx)).toBeNull()
      expect(detect(f)).toHaveLength(0)
    }
  })

  it('a scheduled follow-up prevents the signal', () => {
    const f = fact({ nextFollowUpAt: ctx.nowMs + 3 * DAY })
    expect(classifyLead(f, ctx)).toBeNull()
    expect(detect(f)).toHaveLength(0)
  })

  it('an open task prevents the signal — it IS a scheduled next step', () => {
    const f = fact({ hasOpenTask: true, earliestOpenTaskDueAt: ctx.nowMs + DAY })
    expect(classifyLead(f, ctx)).toBeNull()
    expect(detect(f)).toHaveLength(0)
  })

  it('a lead still inside its SLA has not opened a loop yet', () => {
    const f = fact({ lastActivityAt: ctx.nowMs - 1 * DAY }) // 24h < 72h SLA
    expect(classifyLead(f, ctx)).toBeNull()
    expect(detect(f)).toHaveLength(0)
  })

  it('the 14-day stale ceiling is respected — past it, the lead is cold, not owed', () => {
    const justInside = fact({ lastActivityAt: ctx.nowMs - (STALE_CEILING_DAYS - 1) * DAY })
    expect(classifyLead(justInside, ctx)).toBe('OPEN_LOOP_SLA')
    expect(detect(justInside)).toHaveLength(1)

    const pastCeiling = fact({ lastActivityAt: ctx.nowMs - (STALE_CEILING_DAYS + 1) * DAY })
    expect(classifyLead(pastCeiling, ctx)).toBeNull()
    expect(detect(pastCeiling)).toHaveLength(0)
  })

  it('an indeterminate age never emits', () => {
    const f = fact({ lastActivityAt: null })
    expect(classifyLead(f, ctx)).toBeNull()
    expect(detect(f)).toHaveLength(0)
  })
})

// ───────────── expectedBy comes from the existing SLA authority ─────────────

describe('expectedBy is deterministic and derived from SLA_HOURS_BY_STATUS', () => {
  it('is lastActivityAt + the status SLA, to the millisecond', () => {
    const f = fact()
    const expected = f.lastActivityAt! + SLA_HOURS_BY_STATUS['interested']! * HOUR_MS
    expect(openLoopExpectedByMs(f)).toBe(expected)
    expect(detect(f)[0]!.absence?.expectedBy).toBe(new Date(expected).toISOString())
  })

  it('differs per status, following the SLA table rather than a constant', () => {
    const contacted = fact({ status: 'contacted' })
    const interested = fact({ status: 'interested' })
    expect(openLoopExpectedByMs(interested)! - openLoopExpectedByMs(contacted)!).toBe(
      (SLA_HOURS_BY_STATUS['interested']! - SLA_HOURS_BY_STATUS['contacted']!) * HOUR_MS,
    )
  })

  it('is stable across sweeps — the same untouched loop is ONE observation', () => {
    const f = fact()
    const later = businessDayBounds(ctx.nowMs + 6 * 3600_000)
    const a = detectOpenLoopSla([f], ctx, SCOPE)[0]!
    const b = detectOpenLoopSla([f], later, SCOPE)[0]!
    // The moment the expectation NAMED, never the moment we noticed.
    expect(a.absence?.expectedBy).toBe(b.absence?.expectedBy)
    expect(a.occurredAt).not.toBe(b.occurredAt)
  })

  it('returns null rather than guessing when the status carries no SLA', () => {
    expect(openLoopExpectedByMs(fact({ status: 'new' }))).toBeNull()
    expect(openLoopExpectedByMs(fact({ status: null }))).toBeNull()
    expect(openLoopExpectedByMs(fact({ lastActivityAt: null }))).toBeNull()
  })
})

// ───────────── the ratified ingress accepts it ─────────────

describe('the signal traverses the existing pipeline unchanged', () => {
  it('is accepted by the ratified M3 ingress', () => {
    const result = interpret(detect(fact())[0]!)
    expect(result.accepted).toBe(true)
    if (result.accepted && result.event.kind === 'absence_detected') {
      expect(result.event.signal.isAbsenceDerived).toBe(true)
      expect(result.event.signal.subject).toEqual({ subjectType: 'lead', subjectId: '77' })
    } else {
      throw new Error('expected an accepted absence_detected event')
    }
  })

  it('carries no customer, operator or permission identity', () => {
    const s = detect(fact())[0]!
    const json = JSON.stringify(s)
    expect(json).not.toMatch(/name|phone|handler|userId|perm/i)
    expect(s.traceRefs).toEqual([{ type: 'lead', id: '77' }])
  })

  it('emits in input order and never ranks', () => {
    const many = [fact({ id: 3 }), fact({ id: 1 }), fact({ id: 2 })]
    expect(detectOpenLoopSla(many, ctx, SCOPE).map((s) => s.subject!.subjectId)).toEqual(['3', '1', '2'])
  })
})

// ───────────── every registry is complete, and ownership is null ─────────────

describe('the five registries stay compiler-complete', () => {
  const EXPECTATIONS = ['followup.overdue', 'sla.open_loop']

  it('the detector is registered and iterable', () => {
    expect(Object.keys(DETECTORS).sort()).toEqual([...EXPECTATIONS].sort())
    expect(DETECTORS['sla.open_loop']!.expectation).toBe(OPEN_LOOP_SLA_EXPECTATION)
    expect(DETECTOR_LIST).toHaveLength(2)
  })

  it('every registry declares an entry for every expectation', () => {
    for (const map of [EXPECTED_STATE, NOTIFICATION_OWNERSHIP, VIGILANCE_CLASS, INVESTIGATION_OBJECTIVE]) {
      expect(Object.keys(map).sort()).toEqual([...EXPECTATIONS].sort())
    }
  })

  it('the expected state is the one the State Engine produces', () => {
    expect(EXPECTED_STATE['sla.open_loop']).toBe('OPEN_LOOP_SLA')
    expect(classifyLead(fact(), ctx)).toBe(EXPECTED_STATE['sla.open_loop'])
  })

  it('ownership is explicitly NULL — nothing deterministic delivers this', () => {
    expect(NOTIFICATION_OWNERSHIP['sla.open_loop']).toBeNull()
    expect(isOwnedByDeterministicNotification('sla.open_loop')).toBe(false)
    // And the one that IS owned still is — Condition 13 is untouched.
    expect(isOwnedByDeterministicNotification('followup.overdue')).toBe(true)
  })

  it('the objective is system-authored, with no interpolation', () => {
    const objective = objectiveFor('sla.open_loop')
    expect(objective).toBe(INVESTIGATION_OBJECTIVE['sla.open_loop'])
    expect(objective).toMatch(/cited CRM evidence/)
    expect(objective).toMatch(/Do not invent missing facts/)
    expect(objective).not.toMatch(/\$\{|\{\{|%s/)
  })

  it('the vigilance class is declared and cannot waive ownership', () => {
    expect(VIGILANCE_CLASS['sla.open_loop']).toBe('dropped_commitment')
  })
})

// ───────────── boundaries ─────────────

describe('boundaries', () => {
  const code = readFileSync('lib/ai/integration/detectors/openLoopSla.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('delegates to classifyLead and re-derives NOTHING', () => {
    expect(code).toMatch(/classifyLead\(fact, ctx\) !== 'OPEN_LOOP_SLA'/)
    // No hand-rolled copy of any exclusion the classifier already owns.
    expect(code).not.toMatch(/hasOpenTask|TERMINAL_STATUSES|STALE_CEILING_DAYS|nextFollowUpAt\s*!=/)
    expect(code).not.toMatch(/lastInboundAt|lastHumanOutboundAt/)
  })

  it('reads no clock of its own', () => {
    expect(code).not.toMatch(/Date\.now|new Date\(\)/)
  })

  it('imports no provider, no Agent, and no notification delivery', () => {
    expect(code).not.toMatch(/@ai-sdk|from 'ai'|lib\/agent|generateText|runStructured/)
    expect(code).not.toMatch(/notifyEvent|notifications\//)
  })

  it('the Value Bar and Condition 13 sources are untouched by this phase', () => {
    const bar = readFileSync('lib/ai/runtime/valueBar.ts', 'utf8')
    expect(bar).toMatch(/qualifying_state/)
    expect(bar).toMatch(/notification_novelty/)
    expect(bar).not.toMatch(/open_loop|sla\./)
  })
})
