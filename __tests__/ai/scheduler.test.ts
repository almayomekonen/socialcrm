/**
 * Unit tests for the M4 Runtime Scheduler (pure, no DB).
 * Runs under `test:unit` (VITEST_NO_DB=1): the staleness reader is injected, so
 * the Scheduler's admission / membership / tiering / sweep logic is exercised
 * with no database or runtime dependency.
 */
import { describe, it, expect } from 'vitest'
import { RuntimeScheduler, type CognitionRequest } from '@/lib/ai/runtime/scheduler'
import type { RuntimeEvent } from '@/lib/ai/runtime/eventInterpretation'
import type { StoredBelief, SubjectType, Scope } from '@/db/ai/stateManagement'

const NOW = new Date('2026-07-13T00:00:00.000Z')
const SCOPE: Scope = { agencyId: 42 }

function inbound(subjectId: string | null, agencyId = 42): RuntimeEvent {
  return {
    kind: 'inbound_trace',
    signal: {
      signalType: 'message',
      scope: { agencyId },
      subject: subjectId === null ? null : { subjectType: 'lead', subjectId },
      source: { kind: 'counterpart' },
      sourceReliability: 0.9,
      asOfTime: '2026-07-12T10:00:00.000Z',
      provenance: { traceRefs: [{ type: 'message', id: 'm1' }], inferencePath: [], inferentialDistance: 'low' },
      absenceMarker: null,
      isAbsenceDerived: false,
      surprise: null,
    },
  }
}

function absence(subjectId: string, agencyId = 42): RuntimeEvent {
  return {
    kind: 'absence_detected',
    signal: {
      signalType: 'absence',
      scope: { agencyId },
      subject: { subjectType: 'lead', subjectId },
      source: { kind: 'system' },
      sourceReliability: 1,
      asOfTime: '2026-07-12T10:00:00.000Z',
      provenance: { traceRefs: [], inferencePath: [], inferentialDistance: 'low' },
      absenceMarker: { violatedExpectation: 'reply within 24h' },
      isAbsenceDerived: true,
      surprise: null,
    },
  }
}

const tick = (agencyId = 42): RuntimeEvent => ({
  kind: 'elapsed_time_tick',
  scope: { agencyId },
  asOfTime: NOW.toISOString(),
})

function staleBelief(subjectType: SubjectType, subjectId: string, ageMs: number): StoredBelief {
  return {
    id: 1,
    agencyId: SCOPE.agencyId,
    subjectType,
    subjectId,
    key: 'intent',
    content: {},
    storedConfidence: 0.8,
    decayedConfidence: 0.1,
    groundedness: 0.5,
    calibratable: true,
    uncertaintyKind: 'epistemic',
    evidenceFor: [],
    evidenceAgainst: [],
    isAbsenceDerived: false,
    version: 1,
    freshnessAt: new Date(NOW.getTime() - ageMs).toISOString(),
    ageMs,
    isStale: true,
    provenance: { traceRefs: [], inferencePath: [], inferentialDistance: 'low' },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  }
}

/** A Scheduler whose staleness reader returns a fixed set (no DB). */
function schedulerReturning(stale: StoredBelief[]): RuntimeScheduler {
  return new RuntimeScheduler(SCOPE, { listStaleBeliefs: async () => stale })
}

const byReason = (requests: CognitionRequest[], reason: string) => requests.filter((r) => r.reason === reason)

describe('M4 Runtime Scheduler — construction', () => {
  it('rejects a non-positive or non-integer agencyId', () => {
    expect(() => new RuntimeScheduler({ agencyId: 0 })).toThrow(RangeError)
    expect(() => new RuntimeScheduler({ agencyId: -1 })).toThrow(RangeError)
    expect(() => new RuntimeScheduler({ agencyId: 1.5 })).toThrow(RangeError)
  })
})

describe('M4 Runtime Scheduler — membership tracking', () => {
  it('seeds, de-duplicates, sorts, and ignores blanks', () => {
    const s = schedulerReturning([])
    s.seed(['b', 'a', 'b', '', 'c'])
    expect(s.membership).toEqual(['a', 'b', 'c'])
    expect(s.size).toBe(3)
  })

  it('never shrinks: re-seeding a smaller roster keeps prior members', () => {
    const s = schedulerReturning([])
    s.seed(['a', 'b', 'c'])
    s.seed(['a']) // load: roster shrank, membership must not
    expect(s.membership).toEqual(['a', 'b', 'c'])
  })
})

describe('M4 Runtime Scheduler — trigger admission (Tier 2)', () => {
  it('admits an inbound trace as one Tier-2 request and makes the relationship live', () => {
    const s = schedulerReturning([])
    const reqs = s.admit(inbound('100'), { now: NOW })
    expect(reqs).toHaveLength(1)
    expect(reqs[0]).toMatchObject({
      tier: 2,
      reason: 'inbound',
      subject: { subjectType: 'lead', subjectId: '100' },
      admittedAt: NOW.toISOString(),
      trigger: { kind: 'inbound_trace', asOfTime: '2026-07-12T10:00:00.000Z' },
    })
    expect(s.membership).toEqual(['100'])
  })

  it('admits a detected absence as a Tier-2 request with reason "absence"', () => {
    const s = schedulerReturning([])
    const reqs = s.admit(absence('200'), { now: NOW })
    expect(reqs).toHaveLength(1)
    expect(reqs[0]).toMatchObject({ tier: 2, reason: 'absence', subject: { subjectId: '200' } })
    expect(s.membership).toEqual(['200'])
  })

  it('admits nothing for an elapsed-time tick (it is a cadence cue, not a subject)', () => {
    const s = schedulerReturning([])
    expect(s.admit(tick(), { now: NOW })).toEqual([])
    expect(s.size).toBe(0)
  })

  it('admits nothing for a subjectless signal', () => {
    const s = schedulerReturning([])
    expect(s.admit(inbound(null), { now: NOW })).toEqual([])
    expect(s.size).toBe(0)
  })

  it('ignores events for another scope (scope isolation)', () => {
    const s = schedulerReturning([])
    expect(s.admit(inbound('100', 999), { now: NOW })).toEqual([])
    expect(s.admit(tick(999), { now: NOW })).toEqual([])
    expect(s.size).toBe(0)
  })

  it('is deterministic: identical event + now yields identical requests', () => {
    const s1 = schedulerReturning([])
    const s2 = schedulerReturning([])
    expect(s1.admit(inbound('100'), { now: NOW })).toEqual(s2.admit(inbound('100'), { now: NOW }))
  })
})

describe('M4 Runtime Scheduler — coverage sweep (Tier 1)', () => {
  it('emits exactly one Tier-1 coverage request per live relationship', async () => {
    const s = schedulerReturning([])
    s.seed(['a', 'b', 'c'])
    const res = await s.sweep({ now: NOW })

    expect(res.membership).toEqual(['a', 'b', 'c'])
    const coverage = byReason(res.requests, 'coverage_sweep')
    expect(coverage).toHaveLength(3)
    expect(coverage.map((r) => r.subject.subjectId)).toEqual(['a', 'b', 'c'])
    expect(coverage.every((r) => r.tier === 1 && r.subject.subjectType === 'lead')).toBe(true)
    expect(coverage.every((r) => r.admittedAt === NOW.toISOString())).toBe(true)
  })

  it('an empty scheduler sweeps to an empty result', async () => {
    const res = await schedulerReturning([]).sweep({ now: NOW })
    expect(res.membership).toEqual([])
    expect(res.requests).toEqual([])
    expect(res.staleSubjects).toEqual([])
  })
})

describe('M4 Runtime Scheduler — staleness detection (Tier 1 re-attention)', () => {
  it('raises a staleness request per stale region, most-overdue first, with elapsed time', async () => {
    const s = schedulerReturning([
      staleBelief('lead', 'a', 10 * 24 * 3600_000),
      staleBelief('lead', 'b', 40 * 24 * 3600_000),
      staleBelief('portfolio', 'segment:new', 60 * 24 * 3600_000),
    ])
    const res = await s.sweep({ now: NOW })

    const staleness = byReason(res.requests, 'staleness')
    expect(staleness.map((r) => r.subject.subjectId)).toEqual(['segment:new', 'b', 'a']) // 60d, 40d, 10d
    expect(staleness.every((r) => r.tier === 1)).toBe(true)
    expect(staleness[0].elapsedMs).toBe(60 * 24 * 3600_000)
  })

  it('adds a stale relationship that carries state to membership so it is never missed', async () => {
    const s = schedulerReturning([staleBelief('lead', 'ghost', 40 * 24 * 3600_000)])
    const res = await s.sweep({ now: NOW })
    expect(res.membership).toContain('ghost')
    // it appears both in coverage (it is a member) and in staleness (re-attention)
    expect(byReason(res.requests, 'coverage_sweep').map((r) => r.subject.subjectId)).toContain('ghost')
    expect(byReason(res.requests, 'staleness').map((r) => r.subject.subjectId)).toContain('ghost')
  })

  it('does not add a stale portfolio aggregate to relationship membership', async () => {
    const s = schedulerReturning([staleBelief('portfolio', 'segment:x', 40 * 24 * 3600_000)])
    const res = await s.sweep({ now: NOW })
    expect(res.membership).toEqual([])
    expect(byReason(res.requests, 'staleness')).toHaveLength(1)
  })

  it('collapses multiple stale beliefs on one subject into a single request at max elapsed', async () => {
    const s = schedulerReturning([
      staleBelief('lead', 'a', 31 * 24 * 3600_000),
      staleBelief('lead', 'a', 50 * 24 * 3600_000),
    ])
    const res = await s.sweep({ now: NOW })
    const staleness = byReason(res.requests, 'staleness')
    expect(staleness).toHaveLength(1)
    expect(staleness[0].elapsedMs).toBe(50 * 24 * 3600_000)
  })
})

describe('M4 Runtime Scheduler — coverage never shrinks under load', () => {
  it('membership is monotonic across admits, seeds, and sweeps', async () => {
    const s = schedulerReturning([staleBelief('lead', 'stale-1', 40 * 24 * 3600_000)])
    s.seed(['seed-1', 'seed-2'])
    s.admit(inbound('trig-1'), { now: NOW })
    await s.sweep({ now: NOW }) // pulls in 'stale-1'
    s.seed(['seed-1']) // shrunk roster
    const res = await s.sweep({ now: NOW })
    expect(res.membership).toEqual(['seed-1', 'seed-2', 'stale-1', 'trig-1'])
  })
})
