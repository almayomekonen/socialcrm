/**
 * Unit tests for Integration-3 coverage sweep (pure, no DB).
 * Injects the roster reader, the staleness reader, M5 reason, M6 decide, and the
 * sink. The M4 sweep runs for real. Proves flag/agency resolution, one decision
 * per coverage request, that a stale relationship yields BOTH observations
 * (coverage_sweep + staleness) in one sweep, per-request guarding, and bounding.
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  runShadowCoverageSweep,
  isShadowCoverageEnabled,
  type CoverageSweepDeps,
} from '@/lib/ai/integration/shadowCoverageSweep'
import type { ReasonedUnderstanding } from '@/lib/ai/runtime/reasoning'
import type { GateDecision } from '@/lib/ai/runtime/toolAction'
import type { CoverageDecisionInput } from '@/db/ai/shadowCoverage'
import type { StoredBelief } from '@/db/ai/stateManagement'

const NOW = new Date('2026-07-14T00:00:00.000Z')
const understanding = { asOf: NOW.toISOString() } as ReasonedUnderstanding
const RECOMMEND = { emitted: true, outcome: 'recommend' } as unknown as GateDecision

function staleBelief(subjectId: string, ageMs: number): StoredBelief {
  return {
    id: 1, agencyId: 7, subjectType: 'lead', subjectId, key: 'intent', content: {},
    storedConfidence: 0.5, decayedConfidence: 0.4, groundedness: 0.5, calibratable: true,
    uncertaintyKind: 'epistemic', evidenceFor: [], evidenceAgainst: [], isAbsenceDerived: false,
    version: 1, freshnessAt: new Date(NOW.getTime() - ageMs).toISOString(), ageMs, isStale: true,
    provenance: { traceRefs: [{ type: 'message', id: 'm1' }], inferencePath: [], inferentialDistance: 'low' },
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  }
}

function baseDeps(over: Partial<CoverageSweepDeps> = {}): { deps: CoverageSweepDeps; calls: CoverageDecisionInput[] } {
  const calls: CoverageDecisionInput[] = []
  const deps: CoverageSweepDeps = {
    listResidentLeadSubjects: async () => ['a', 'b'],
    listStaleBeliefs: async () => [],
    reason: (async () => understanding) as CoverageSweepDeps['reason'],
    decide: (() => RECOMMEND) as CoverageSweepDeps['decide'],
    record: (async (input: CoverageDecisionInput) => {
      calls.push(input)
      return 1
    }) as unknown as CoverageSweepDeps['record'],
    ...over,
  }
  return { deps, calls }
}

describe('Integration-3 sweep — agency resolution & flag', () => {
  const KEYS = ['SHADOW_COVERAGE_AGENCY_IDS', 'SHADOW_COVERAGE_KILL'] as const
  const saved: Record<string, string | undefined> = {}
  for (const k of KEYS) saved[k] = process.env[k]
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('sweeps nothing when the flag is off and no override is given', async () => {
    delete process.env.SHADOW_COVERAGE_AGENCY_IDS
    delete process.env.SHADOW_COVERAGE_KILL
    const { deps, calls } = baseDeps()
    const s = await runShadowCoverageSweep({ now: NOW, deps })
    expect(s.agencies).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it('an explicit agency override bypasses the env flag (local/test)', async () => {
    delete process.env.SHADOW_COVERAGE_AGENCY_IDS
    const { deps, calls } = baseDeps()
    const s = await runShadowCoverageSweep({ now: NOW, agencyIds: [7], deps })
    expect(s.agencies).toBe(1)
    expect(calls.map((c) => c.subjectId).sort()).toEqual(['a', 'b'])
  })

  it('the per-agency flag defaults OFF, honours allowlist and kill', () => {
    delete process.env.SHADOW_COVERAGE_AGENCY_IDS
    delete process.env.SHADOW_COVERAGE_KILL
    expect(isShadowCoverageEnabled(7)).toBe(false)
    process.env.SHADOW_COVERAGE_AGENCY_IDS = '7'
    expect(isShadowCoverageEnabled(7)).toBe(true)
    expect(isShadowCoverageEnabled(8)).toBe(false)
    process.env.SHADOW_COVERAGE_KILL = '1'
    expect(isShadowCoverageEnabled(7)).toBe(false)
  })
})

describe('Integration-3 sweep — decisions per relationship', () => {
  it('records one coverage_sweep decision per resident lead', async () => {
    const { deps, calls } = baseDeps()
    const s = await runShadowCoverageSweep({ now: NOW, agencyIds: [7], deps })
    expect(s.swept).toBe(2)
    expect(s.decisions).toBe(2)
    expect(calls.every((c) => c.reason === 'coverage_sweep')).toBe(true)
    expect(calls.every((c) => c.outcome === 'recommend')).toBe(true)
  })

  it('a stale relationship persists BOTH observations in one sweep (coverage_sweep + staleness)', async () => {
    const { deps, calls } = baseDeps({
      listResidentLeadSubjects: async () => ['a'],
      listStaleBeliefs: async () => [staleBelief('a', 40 * 24 * 60 * 60 * 1000)],
    })
    const s = await runShadowCoverageSweep({ now: NOW, agencyIds: [7], deps })
    const forA = calls.filter((c) => c.subjectId === 'a')
    expect(forA.map((c) => c.reason).sort()).toEqual(['coverage_sweep', 'staleness'])
    expect(s.decisions).toBe(2) // both survive; neither overwrites the other
  })

  it('stamps a deterministic sweep bucket from now/bucketMs', async () => {
    const { deps, calls } = baseDeps({ listResidentLeadSubjects: async () => ['a'] })
    await runShadowCoverageSweep({ now: NOW, agencyIds: [7], bucketMs: 3_600_000, deps })
    expect(calls[0].sweepBucket).toBe(Math.floor(NOW.getTime() / 3_600_000))
  })
})

describe('Integration-3 sweep — guarding & bounding', () => {
  it('a per-relationship failure never aborts the sweep', async () => {
    let n = 0
    const { deps, calls } = baseDeps({
      reason: (async () => {
        n += 1
        if (n === 1) throw new Error('hydrate down')
        return understanding
      }) as CoverageSweepDeps['reason'],
    })
    const s = await runShadowCoverageSweep({ now: NOW, agencyIds: [7], deps })
    expect(s.errored).toBe(1)
    expect(calls).toHaveLength(1) // the other relationship still recorded
  })

  it('bounds work per run and defers the rest (never silently dropped)', async () => {
    const { deps, calls } = baseDeps({ listResidentLeadSubjects: async () => ['a', 'b', 'c'] })
    const s = await runShadowCoverageSweep({ now: NOW, agencyIds: [7], maxPerSweep: 1, deps })
    expect(s.swept).toBe(1)
    expect(s.deferred).toBe(2)
    expect(calls).toHaveLength(1)
  })
})
