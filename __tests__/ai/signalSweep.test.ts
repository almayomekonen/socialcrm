/**
 * The signal PRODUCER — unit tests, no DB, no model.
 *
 * After Phase 3 this module detects and enqueues; it does not process. The
 * runtime half of the chain is proven in the worker and tick suites. What is
 * proven here is the producer contract: the gate, the detection delegation, the
 * enqueue call, bounding, and guarding — plus the absence that guarantees there
 * is only one production path.
 *
 * Runs under `test:unit` (VITEST_NO_DB=1).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  runSignalSweep,
  isSignalSweepEnabled,
  resolveSweepAgencies,
  type SignalSweepDeps,
} from '@/lib/ai/integration/signalSweep'
import { observationKeyFor } from '@/lib/ai/integration/observationKey'
import { businessDayBounds } from '@/lib/today/time'
import type { EnqueueResult } from '@/db/ai/signalJobs'
import type { ExternalSignal } from '@/lib/ai/runtime/eventInterpretation'
import type { LeadFact } from '@/lib/today/types'
import type { Scope } from '@/db/ai/stateManagement'

const NOW = new Date('2026-08-25T09:00:00.000Z')
const ctx = businessDayBounds(NOW.getTime())
const DAY = 86_400_000
const AGENCY = 103

function fact(over: Partial<LeadFact> = {}): LeadFact {
  return {
    id: 77,
    name: null,
    phone: null,
    status: 'contacted',
    leadSource: 'manual',
    createdAt: ctx.nowMs - 30 * DAY,
    nextFollowUpAt: ctx.dayStart - 2 * DAY, // overdue
    lastActivityAt: ctx.nowMs - 5 * DAY,
    lastInboundAt: null,
    lastHumanOutboundAt: null,
    hasOpenTask: false,
    earliestOpenTaskDueAt: null,
    ...over,
  }
}

type Harness = { deps: SignalSweepDeps; enqueued: ExternalSignal[]; factsCalls: Scope[] }

function harness(facts: LeadFact[], result?: (s: ExternalSignal) => EnqueueResult): Harness {
  const enqueued: ExternalSignal[] = []
  const factsCalls: Scope[] = []
  const deps: SignalSweepDeps = {
    listAgencyLeadFacts: (async (scope: Scope) => {
      factsCalls.push(scope)
      return facts
    }) as SignalSweepDeps['listAgencyLeadFacts'],
    enqueueSignal: (async (signal: ExternalSignal) => {
      enqueued.push(signal)
      return result ? result(signal) : { enqueued: true, jobId: enqueued.length, observationKey: observationKeyFor(signal) }
    }) as SignalSweepDeps['enqueueSignal'],
  }
  return { deps, enqueued, factsCalls }
}

const KEYS = ['SIGNAL_SWEEP_AGENCY_IDS', 'SIGNAL_SWEEP_KILL'] as const
const saved: Record<string, string | undefined> = {}
for (const k of KEYS) saved[k] = process.env[k]
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

// ── the gate ─────────────────────────────────────────────────────────────────

describe('the sweep gate', () => {
  it('does no work at all when the allowlist is unset', async () => {
    delete process.env.SIGNAL_SWEEP_AGENCY_IDS
    delete process.env.SIGNAL_SWEEP_KILL
    const h = harness([fact()])
    const s = await runSignalSweep({ now: NOW, deps: h.deps })
    expect(s.agencies).toBe(0)
    expect(h.factsCalls).toEqual([]) // no CRM read, not merely no enqueue
    expect(h.enqueued).toEqual([])
  })

  it('sweeps only allowlisted agencies', async () => {
    process.env.SIGNAL_SWEEP_AGENCY_IDS = '103'
    const h = harness([fact()])
    await runSignalSweep({ now: NOW, deps: h.deps })
    expect(h.factsCalls.map((c) => c.agencyId)).toEqual([103])
    expect(isSignalSweepEnabled(103)).toBe(true)
    expect(isSignalSweepEnabled(104)).toBe(false)
    expect(isSignalSweepEnabled(null)).toBe(false)
  })

  it.each(['1', 'true'])('KILL=%s halts an allowlisted agency', async (kill) => {
    process.env.SIGNAL_SWEEP_AGENCY_IDS = '103'
    process.env.SIGNAL_SWEEP_KILL = kill
    const h = harness([fact()])
    const s = await runSignalSweep({ now: NOW, deps: h.deps })
    expect(s.agencies).toBe(0)
    expect(h.factsCalls).toEqual([])
    expect(isSignalSweepEnabled(103)).toBe(false)
    expect(resolveSweepAgencies()).toEqual([])
  })

  it("refuses 'all' — a CRM-wide sweep must never be reachable by a typo", async () => {
    process.env.SIGNAL_SWEEP_AGENCY_IDS = 'all'
    const h = harness([fact()])
    const s = await runSignalSweep({ now: NOW, deps: h.deps })
    expect(s.agencies).toBe(0)
    expect(h.factsCalls).toEqual([])
    expect(resolveSweepAgencies()).toEqual([])
  })
})

// ── detection → enqueue ──────────────────────────────────────────────────────

describe('the producer', () => {
  it('enqueues one canonical signal per detected observation', async () => {
    const h = harness([fact()])
    const s = await runSignalSweep({ now: NOW, agencyIds: [AGENCY], deps: h.deps })

    expect(s).toMatchObject({ agencies: 1, detected: 1, enqueued: 1, duplicates: 0, refused: 0, errored: 0 })
    expect(h.enqueued).toHaveLength(1)
    const [signal] = h.enqueued
    expect(signal.signalType).toBe('absence')
    expect(signal.scope).toEqual({ agencyId: AGENCY })
    expect(signal.subject).toEqual({ subjectType: 'lead', subjectId: '77' })
    expect(signal.absence?.violatedExpectation).toBe('followup.overdue')
  })

  it('a known observation is counted as a duplicate, not an error', async () => {
    const h = harness([fact()], (s) => ({ enqueued: false, reason: 'duplicate', observationKey: observationKeyFor(s) }))
    const s = await runSignalSweep({ now: NOW, agencyIds: [AGENCY], deps: h.deps })
    expect(s).toMatchObject({ detected: 1, enqueued: 0, duplicates: 1, refused: 0, errored: 0 })
  })

  it('a refusal at the queue door is counted and never retried inline', async () => {
    const h = harness([fact()], () => ({ enqueued: false, reason: 'rejected', detail: 'missing_absence_marker' }))
    const s = await runSignalSweep({ now: NOW, agencyIds: [AGENCY], deps: h.deps })
    expect(s).toMatchObject({ detected: 1, enqueued: 0, refused: 1, errored: 0 })
  })

  it('a lead that does not qualify produces nothing', async () => {
    // Phase 4.5 note: `nextFollowUpAt: null` alone no longer means "does not
    // qualify" — a `contacted` lead idle 5 days is now an OPEN_LOOP_SLA. Past the
    // 14-day stale ceiling the lead is cold, which no detector claims.
    const h = harness([fact({ nextFollowUpAt: null, lastActivityAt: ctx.nowMs - 30 * DAY })])
    const s = await runSignalSweep({ now: NOW, agencyIds: [AGENCY], deps: h.deps })
    expect(s).toMatchObject({ agencies: 1, detected: 0, enqueued: 0 })
    expect(h.enqueued).toEqual([])
  })

  it('each agency is swept under its own scope only', async () => {
    const h = harness([fact()])
    await runSignalSweep({ now: NOW, agencyIds: [103, 104], deps: h.deps })
    expect(h.factsCalls.map((c) => c.agencyId)).toEqual([103, 104])
    expect(h.enqueued.map((s) => s.scope.agencyId)).toEqual([103, 104])
  })
})

// ── guarding and bounding ────────────────────────────────────────────────────

describe('guarding & bounding', () => {
  it('bounds work per run and defers the rest — never silently dropped', async () => {
    const h = harness([fact({ id: 1 }), fact({ id: 2 }), fact({ id: 3 })])
    const s = await runSignalSweep({ now: NOW, agencyIds: [AGENCY], maxPerSweep: 1, deps: h.deps })
    expect(s).toMatchObject({ detected: 3, enqueued: 1, deferred: 2 })
  })

  it('a per-signal failure never aborts the sweep', async () => {
    let n = 0
    const h = harness([fact({ id: 1 }), fact({ id: 2 })])
    const deps: SignalSweepDeps = {
      ...h.deps,
      enqueueSignal: (async (signal: ExternalSignal) => {
        n += 1
        if (n === 1) throw new Error('db blip')
        return { enqueued: true, jobId: n, observationKey: observationKeyFor(signal) }
      }) as SignalSweepDeps['enqueueSignal'],
    }
    const s = await runSignalSweep({ now: NOW, agencyIds: [AGENCY], deps })
    expect(s).toMatchObject({ detected: 2, enqueued: 1, errored: 1 })
  })

  it('a failing facts read errors that agency only, and never throws out', async () => {
    const h = harness([fact()])
    const deps: SignalSweepDeps = {
      ...h.deps,
      listAgencyLeadFacts: (async () => {
        throw new Error('db down')
      }) as SignalSweepDeps['listAgencyLeadFacts'],
    }
    const s = await runSignalSweep({ now: NOW, agencyIds: [AGENCY], deps })
    expect(s).toMatchObject({ errored: 1, enqueued: 0 })
  })
})

// ── the producer ends at the queue ───────────────────────────────────────────

describe('the producer holds no runtime path of its own', () => {
  const src = readFileSync(join(process.cwd(), 'lib/ai/integration/signalSweep.ts'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

  it('imports neither the ingress, the scheduler, the reasoner, the gate, nor the sink', () => {
    for (const forbidden of [
      'eventInterpretation',
      'RuntimeScheduler',
      'runtime/reasoning',
      'runtime/toolAction',
      'shadowCoverage',
    ]) {
      expect(code, `signalSweep still reaches ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('calls none of the runtime verbs', () => {
    for (const verb of ['interpret(', '.admit(', 'reason(', 'decide(', 'recordCoverageDecision']) {
      expect(code, `signalSweep still calls ${verb}`).not.toContain(verb)
    }
  })

  it('its only sink is the queue', () => {
    expect(code).toContain('enqueueSignal')
  })
})
