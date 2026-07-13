/**
 * AI Runtime — M4 Runtime Scheduler integration tests (real PostgreSQL).
 *
 * Proves the Scheduler's staleness detection runs on the real M1 State
 * Management substrate: a coverage sweep reads `listStaleBeliefs`, raises
 * time-driven re-attention requests, folds stale relationships into membership,
 * and stays isolated by scope. Runs under `test:runtime`.
 */
import { afterAll, describe, it, expect } from 'vitest'
import { db } from '@/config/db'
import { writeBelief, type Scope } from '@/db/ai/stateManagement'
import { RuntimeScheduler } from '@/lib/ai/runtime/scheduler'
import type { DecayPolicy } from '@/db/ai/decay'

afterAll(async () => {
  await db.destroy()
})

const NOW = new Date('2026-07-13T00:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

// A short staleness horizon keeps the fixtures readable without waiting 30 days.
const POLICY: DecayPolicy = { halfLifeMs: 14 * DAY, staleAfterMs: 7 * DAY, floorConfidence: 0 }

const prov = { traceRefs: [{ type: 'message', id: 'm1' }], inferentialDistance: 'low' as const }

async function seedBelief(scope: Scope, subjectId: string, key: string, freshnessAt: Date): Promise<void> {
  await writeBelief({
    agencyId: scope.agencyId,
    subjectType: 'lead',
    subjectId,
    key,
    content: { note: key },
    confidence: 0.8,
    groundedness: 0.6,
    provenance: prov,
    freshnessAt,
  })
}

const staleness = (res: { requests: { reason: string; subject: { subjectId: string } }[] }) =>
  res.requests.filter((r) => r.reason === 'staleness').map((r) => r.subject.subjectId)

describe('M4 Runtime Scheduler — staleness over real State Management', () => {
  it('flags a relationship whose beliefs aged past the staleness horizon', async () => {
    const scope: Scope = { agencyId: 8401 }
    await seedBelief(scope, 'lead-old', 'intent', new Date(NOW.getTime() - 20 * DAY))
    await seedBelief(scope, 'lead-fresh', 'intent', new Date(NOW.getTime() - 1 * DAY))

    const s = new RuntimeScheduler(scope)
    s.seed(['lead-old', 'lead-fresh'])
    const res = await s.sweep({ now: NOW, policy: POLICY })

    // Coverage floor holds for both; only the aged one earns staleness re-attention.
    expect(res.requests.filter((r) => r.reason === 'coverage_sweep').map((r) => r.subject.subjectId)).toEqual([
      'lead-fresh',
      'lead-old',
    ])
    expect(staleness(res)).toEqual(['lead-old'])
    const flagged = res.requests.find((r) => r.reason === 'staleness')
    expect(flagged?.elapsedMs).toBeGreaterThanOrEqual(20 * DAY)
  })

  it('folds a stale relationship into membership even if it was never seeded', async () => {
    const scope: Scope = { agencyId: 8402 }
    await seedBelief(scope, 'never-seeded', 'intent', new Date(NOW.getTime() - 30 * DAY))

    const s = new RuntimeScheduler(scope)
    const res = await s.sweep({ now: NOW, policy: POLICY })

    expect(res.membership).toContain('never-seeded')
    expect(staleness(res)).toContain('never-seeded')
  })

  it('detects nothing when every belief is fresh (staleness fires on time alone)', async () => {
    const scope: Scope = { agencyId: 8403 }
    await seedBelief(scope, 'lead-a', 'intent', new Date(NOW.getTime() - 1 * DAY))

    const s = new RuntimeScheduler(scope)
    s.seed(['lead-a'])
    const res = await s.sweep({ now: NOW, policy: POLICY })

    expect(staleness(res)).toEqual([])
    expect(res.requests.filter((r) => r.reason === 'coverage_sweep')).toHaveLength(1)
  })

  it('is isolated by scope: another agency\u2019s stale beliefs never leak in', async () => {
    const mine: Scope = { agencyId: 8404 }
    const other: Scope = { agencyId: 8405 }
    await seedBelief(other, 'other-lead', 'intent', new Date(NOW.getTime() - 40 * DAY))

    const s = new RuntimeScheduler(mine)
    const res = await s.sweep({ now: NOW, policy: POLICY })

    expect(res.membership).toEqual([])
    expect(res.requests).toEqual([])
  })
})
