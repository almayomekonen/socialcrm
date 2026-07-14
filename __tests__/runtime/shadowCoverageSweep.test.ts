/**
 * Integration-3 coverage sweep — integration tests (real PostgreSQL).
 *
 * Proves continuous cognition end-to-end over the live substrate
 * (M4 sweep → M5 reason → M6 decide → ai_shadow_coverage): a resident roster is
 * swept without any inbound message, a stale relationship persists BOTH
 * observations in one sweep, idempotency holds independently per reason, and the
 * flag gates the whole thing. Runs under `test:runtime`.
 */
import { afterAll, afterEach, describe, it, expect } from 'vitest'
import { db } from '@/config/db'
import { writeBelief, type Scope } from '@/db/ai/stateManagement'
import { readCoverageDecisions } from '@/db/ai/shadowCoverage'
import { runShadowCoverageSweep } from '@/lib/ai/integration/shadowCoverageSweep'

afterAll(async () => {
  await db.destroy()
})

const NOW = new Date('2026-07-14T00:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const prov = { traceRefs: [{ type: 'conversation', id: '555' }], inferentialDistance: 'medium' as const }

const savedAllow = process.env.SHADOW_COVERAGE_AGENCY_IDS
const savedKill = process.env.SHADOW_COVERAGE_KILL
afterEach(() => {
  if (savedAllow === undefined) delete process.env.SHADOW_COVERAGE_AGENCY_IDS
  else process.env.SHADOW_COVERAGE_AGENCY_IDS = savedAllow
  if (savedKill === undefined) delete process.env.SHADOW_COVERAGE_KILL
  else process.env.SHADOW_COVERAGE_KILL = savedKill
})

async function seed(scope: Scope, subjectId: string, freshnessAt: Date, confidence = 0.85): Promise<void> {
  await writeBelief({
    agencyId: scope.agencyId,
    subjectType: 'lead',
    subjectId,
    key: 'qualification.budget',
    content: { value: '50k' },
    confidence,
    groundedness: 0.6,
    evidenceFor: [{ type: 'conversation', id: '555' }],
    provenance: prov,
    freshnessAt,
  })
}

describe('Integration-3 sweep — over the live read spine', () => {
  it('sweeps the resident roster without any inbound message', async () => {
    const scope: Scope = { agencyId: 9921 }
    await seed(scope, 'lead-1', NOW)
    await seed(scope, 'lead-2', NOW)

    const s = await runShadowCoverageSweep({ now: NOW, agencyIds: [scope.agencyId] })
    expect(s.agencies).toBe(1)
    expect(s.decisions).toBeGreaterThanOrEqual(2)

    const rows = await readCoverageDecisions(scope.agencyId, { subjectType: 'lead', subjectId: 'lead-1' })
    expect(rows.some((r) => r.reason === 'coverage_sweep')).toBe(true)
    expect(rows[0].decision).not.toBeNull()
  })

  it('a stale relationship persists BOTH observations (coverage_sweep + staleness) in one sweep', async () => {
    const scope: Scope = { agencyId: 9922 }
    await seed(scope, 'lead-stale', new Date(NOW.getTime() - 60 * DAY)) // > 30d stale threshold

    await runShadowCoverageSweep({ now: NOW, agencyIds: [scope.agencyId] })

    const rows = await readCoverageDecisions(scope.agencyId, { subjectType: 'lead', subjectId: 'lead-stale' })
    expect(rows.map((r) => r.reason).sort()).toEqual(['coverage_sweep', 'staleness'])
  })

  it('is idempotent independently per reason: re-running the same sweep upserts each observation', async () => {
    const scope: Scope = { agencyId: 9923 }
    await seed(scope, 'lead-stale', new Date(NOW.getTime() - 60 * DAY))

    await runShadowCoverageSweep({ now: NOW, agencyIds: [scope.agencyId] })
    await runShadowCoverageSweep({ now: NOW, agencyIds: [scope.agencyId] })

    const rows = await readCoverageDecisions(scope.agencyId, { subjectType: 'lead', subjectId: 'lead-stale' })
    // still exactly the two observations, not four
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.reason).sort()).toEqual(['coverage_sweep', 'staleness'])
  })

  it('writes nothing when the flag is off and no override is given', async () => {
    const scope: Scope = { agencyId: 9924 }
    delete process.env.SHADOW_COVERAGE_AGENCY_IDS
    delete process.env.SHADOW_COVERAGE_KILL
    await seed(scope, 'lead-off', NOW)

    const s = await runShadowCoverageSweep({ now: NOW })
    expect(s.agencies).toBe(0)
    const rows = await readCoverageDecisions(scope.agencyId, { subjectType: 'lead', subjectId: 'lead-off' })
    expect(rows).toHaveLength(0)
  })
})
