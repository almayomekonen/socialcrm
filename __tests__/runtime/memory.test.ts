/**
 * AI Runtime — W2-M2 Memory Runtime integration tests (real PostgreSQL).
 *
 * Proves recall runs over the live episodic substrate (M1 State Management): the
 * narrative floor and the append-only belief-version history. It recalls specific
 * cases with provenance walked back from persisted versions, consolidates base
 * rates over a real cohort, stays isolated by scope, and writes nothing back.
 * Runs under `test:runtime`.
 */
import { afterAll, describe, it, expect } from 'vitest'
import { db } from '@/config/db'
import { writeBelief, recordNarrative, readBeliefs, type Scope } from '@/db/ai/stateManagement'
import { recall } from '@/lib/ai/runtime/memory'

afterAll(async () => {
  await db.destroy()
})

const NOW = new Date('2026-07-14T00:00:00.000Z')
const prov = { traceRefs: [{ type: 'message', id: 'm1' }], inferentialDistance: 'low' as const }

describe('W2-M2 Memory — over the live M1 episodic substrate', () => {
  it('recalls narrative and belief-version episodes with provenance from persisted history', async () => {
    const scope: Scope = { agencyId: 9801 }
    const subject = { subjectType: 'lead' as const, subjectId: 'lead-1' }
    await recordNarrative({ agencyId: scope.agencyId, subjectType: 'lead', subjectId: 'lead-1', kind: 'promise', content: { text: 'call back Tuesday' }, occurredAt: new Date('2026-06-01T00:00:00.000Z') })
    // Two writes on the same key → two appended versions (belief-change episodes).
    await writeBelief({ agencyId: scope.agencyId, subjectType: 'lead', subjectId: 'lead-1', key: 'intent', content: { v: 1 }, confidence: 0.6, groundedness: 0.5, provenance: prov, freshnessAt: NOW })
    await writeBelief({ agencyId: scope.agencyId, subjectType: 'lead', subjectId: 'lead-1', key: 'intent', content: { v: 2 }, confidence: 0.85, groundedness: 0.6, evidenceFor: [{ type: 'message', id: 'm2' }], provenance: { traceRefs: [{ type: 'message', id: 'm2' }], inferentialDistance: 'low' }, freshnessAt: NOW })

    const r = await recall({ scope, subject }, { now: NOW })
    expect(r.isEmpty).toBe(false)
    const beliefEpisodes = r.episodic.filter((e) => e.kind === 'belief_change')
    expect(beliefEpisodes.length).toBeGreaterThanOrEqual(2) // both versions recalled
    expect(r.episodic.some((e) => e.kind === 'narrative' && e.label === 'promise')).toBe(true)
    expect(beliefEpisodes.every((e) => e.provenance !== null && e.sourceRef.type === 'belief_version')).toBe(true)
  })

  it('consolidates base rates over a real cohort', async () => {
    const scope: Scope = { agencyId: 9802 }
    for (const [id, conf] of [['a', 0.8], ['b', 0.9], ['c', 0.2]] as const) {
      await writeBelief({ agencyId: scope.agencyId, subjectType: 'lead', subjectId: id, key: 'intent', content: {}, confidence: conf, groundedness: 0.5, provenance: prov, freshnessAt: NOW })
    }
    const cohort = ['a', 'b', 'c'].map((subjectId) => ({ subjectType: 'lead' as const, subjectId }))
    const r = await recall({ scope, subject: { subjectType: 'lead', subjectId: 'a' }, cohort }, { now: NOW })
    const intent = r.semantic.find((s) => s.dimension === 'intent')!
    expect(intent.total).toBe(3)
    expect(intent.count).toBe(2)
  })

  it('is read-only: recall writes nothing back to State Management', async () => {
    const scope: Scope = { agencyId: 9803 }
    await writeBelief({ agencyId: scope.agencyId, subjectType: 'lead', subjectId: 'lead-x', key: 'intent', content: {}, confidence: 0.6, groundedness: 0.5, provenance: prov, freshnessAt: NOW })
    const before = await readBeliefs(scope, { subjectType: 'lead', subjectId: 'lead-x' }, { now: NOW })
    await recall({ scope, subject: { subjectType: 'lead', subjectId: 'lead-x' } }, { now: NOW })
    const after = await readBeliefs(scope, { subjectType: 'lead', subjectId: 'lead-x' }, { now: NOW })
    expect(after).toHaveLength(before.length)
    expect(after[0].version).toBe(before[0].version)
  })

  it('is isolated by scope: another agency’s memory never enters the recall', async () => {
    const mine: Scope = { agencyId: 9804 }
    const other: Scope = { agencyId: 9805 }
    await writeBelief({ agencyId: other.agencyId, subjectType: 'lead', subjectId: 'shared-id', key: 'intent', content: {}, confidence: 0.8, groundedness: 0.6, provenance: prov, freshnessAt: NOW })
    await recordNarrative({ agencyId: other.agencyId, subjectType: 'lead', subjectId: 'shared-id', kind: 'history', content: {}, occurredAt: NOW })
    const r = await recall({ scope: mine, subject: { subjectType: 'lead', subjectId: 'shared-id' } }, { now: NOW })
    expect(r.isEmpty).toBe(true)
  })
})
