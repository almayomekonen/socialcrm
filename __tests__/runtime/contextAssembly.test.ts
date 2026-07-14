/**
 * AI Runtime — W2-M1 Context Assembly integration tests (real PostgreSQL).
 *
 * Proves the assembler runs over the live pipeline: State Management (M1) holds
 * beliefs, the World Model Runtime (M2) makes them resident, and Context Assembly
 * reads *through* that hydration surface (never the database directly) to produce
 * a bounded, immutable Context Package — preserving provenance walked back from
 * persisted traces, honouring time-decay/staleness, staying isolated by scope,
 * and writing nothing. Runs under `test:runtime`.
 */
import { afterAll, describe, it, expect } from 'vitest'
import { db } from '@/config/db'
import { writeBelief, readBeliefs, type Scope } from '@/db/ai/stateManagement'
import { assembleContext } from '@/lib/ai/runtime/contextAssembly'
import type { CognitionRequest } from '@/lib/ai/runtime/scheduler'

afterAll(async () => {
  await db.destroy()
})

const NOW = new Date('2026-07-14T00:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const prov = { traceRefs: [{ type: 'message', id: 'm1' }], inferentialDistance: 'low' as const }

function relRequest(scope: Scope, subjectId: string, reason: CognitionRequest['reason'] = 'inbound'): CognitionRequest {
  return {
    scope,
    subject: { subjectType: 'lead', subjectId },
    tier: reason === 'coverage_sweep' || reason === 'staleness' ? 1 : 2,
    reason,
    admittedAt: NOW.toISOString(),
  }
}

describe('W2-M1 Context Assembly — over the live M1→M2 substrate', () => {
  it('assembles a bounded context with provenance walked back from persisted traces', async () => {
    const scope: Scope = { agencyId: 9701 }
    await writeBelief({
      agencyId: scope.agencyId,
      subjectType: 'lead',
      subjectId: 'lead-1',
      key: 'intent',
      content: { label: 'wants_quote' },
      confidence: 0.85,
      groundedness: 0.7,
      evidenceFor: [{ type: 'message', id: 'm1' }, { type: 'message', id: 'm2' }],
      evidenceAgainst: [{ type: 'message', id: 'm3' }],
      provenance: prov,
      freshnessAt: NOW,
    })

    const pkg = await assembleContext(relRequest(scope, 'lead-1'), { now: NOW })
    expect(pkg.isEmpty).toBe(false)
    expect(pkg.accounting.includedBeliefCount).toBe(1)
    const intent = pkg.includedBeliefs.find((b) => b.key === 'intent')!
    expect(intent.provenance.traceRefs.map((t) => t.id)).toContain('m1')
    expect(intent.evidenceFor).toHaveLength(2) // preserved
    expect(intent.evidenceAgainst).toHaveLength(1) // competing evidence never collapsed
    expect(Object.isFrozen(pkg)).toBe(true)
  })

  it('honours time-decay: an aged belief surfaces as stale in the temporal context', async () => {
    const scope: Scope = { agencyId: 9702 }
    await writeBelief({
      agencyId: scope.agencyId,
      subjectType: 'lead',
      subjectId: 'lead-aged',
      key: 'intent',
      content: {},
      confidence: 0.9,
      groundedness: 0.6,
      provenance: prov,
      freshnessAt: new Date(NOW.getTime() - 60 * DAY),
    })
    const pkg = await assembleContext(relRequest(scope, 'lead-aged', 'staleness'), { now: NOW })
    expect(pkg.temporal.anyStale).toBe(true)
    expect(pkg.includedBeliefs[0].isStale).toBe(true)
  })

  it('is read-only: assembling writes nothing back to State Management', async () => {
    const scope: Scope = { agencyId: 9703 }
    await writeBelief({
      agencyId: scope.agencyId,
      subjectType: 'lead',
      subjectId: 'lead-x',
      key: 'intent',
      content: {},
      confidence: 0.6,
      groundedness: 0.5,
      provenance: prov,
      freshnessAt: NOW,
    })
    const before = await readBeliefs(scope, { subjectType: 'lead', subjectId: 'lead-x' }, { now: NOW })
    await assembleContext(relRequest(scope, 'lead-x'), { now: NOW })
    const after = await readBeliefs(scope, { subjectType: 'lead', subjectId: 'lead-x' }, { now: NOW })
    expect(after).toHaveLength(before.length)
    expect(after[0].version).toBe(before[0].version)
  })

  it('is isolated by scope: another agency’s beliefs never enter the package', async () => {
    const mine: Scope = { agencyId: 9704 }
    const other: Scope = { agencyId: 9705 }
    await writeBelief({
      agencyId: other.agencyId,
      subjectType: 'lead',
      subjectId: 'shared-id',
      key: 'intent',
      content: {},
      confidence: 0.8,
      groundedness: 0.6,
      provenance: prov,
      freshnessAt: NOW,
    })
    const pkg = await assembleContext(relRequest(mine, 'shared-id'), { now: NOW })
    expect(pkg.isEmpty).toBe(true)
    expect(pkg.accounting.totalBeliefs).toBe(0)
  })

  it('bounds the working set over persisted beliefs and records exclusions', async () => {
    const scope: Scope = { agencyId: 9706 }
    for (const key of ['a', 'b', 'c']) {
      await writeBelief({
        agencyId: scope.agencyId,
        subjectType: 'lead',
        subjectId: 'lead-many',
        key,
        content: {},
        confidence: 0.6,
        groundedness: 0.5,
        provenance: prov,
        freshnessAt: NOW,
      })
    }
    const pkg = await assembleContext(relRequest(scope, 'lead-many'), {
      now: NOW,
      policy: { beliefCapByTier: { 1: 1, 2: 2 }, narrativeCapByTier: { 1: 1, 2: 2 }, memberReferenceCap: 2 },
    })
    expect(pkg.accounting.totalBeliefs).toBe(3)
    expect(pkg.accounting.includedBeliefCount).toBe(2)
    expect(pkg.accounting.excludedBeliefCount).toBe(1)
    expect(pkg.includedBeliefs.length + pkg.excludedBeliefs.length).toBe(3)
  })
})
