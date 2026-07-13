/**
 * AI Runtime — M2 World Model Runtime integration tests (real PostgreSQL).
 *
 * Proves the resident representation is built strictly on top of M1: hydration
 * (read), the update pipeline (write), temporal coherence, multi-scale portfolio
 * composition, "never summoned into existence by a read", immutable snapshots +
 * change detection, and scope isolation. Runs under `test:runtime`.
 */
import { afterAll, describe, it, expect } from 'vitest'
import { db } from '@/config/db'
import {
  hydrateRelationship,
  hydrateRelationships,
  hydratePortfolio,
  applyRelationshipBelief,
  applyPortfolioBelief,
  recordRelationshipNarrative,
  snapshotRelationship,
  snapshotPortfolio,
  worldModelSignature,
  type RelationshipBeliefInput,
} from '@/lib/ai/runtime/worldModel'
import { readBeliefs } from '@/db/ai/stateManagement'
import type { DecayPolicy } from '@/db/ai/decay'

afterAll(async () => {
  await db.destroy()
})

const T0 = new Date('2026-06-01T00:00:00.000Z')
const at = (ms: number) => new Date(T0.getTime() + ms)
const FAST_POLICY: DecayPolicy = { halfLifeMs: 1000, staleAfterMs: 4000, floorConfidence: 0 }

function belief(over: Partial<RelationshipBeliefInput> & Pick<RelationshipBeliefInput, 'key'>): RelationshipBeliefInput {
  return {
    content: { v: 1 },
    confidence: 0.8,
    groundedness: 0.7,
    provenance: { traceRefs: [{ type: 'message', id: 'm1' }], inferentialDistance: 'low' },
    freshnessAt: T0,
    ...over,
  }
}

describe('M2 World Model Runtime — hydration (read)', () => {
  const scope = { agencyId: 8001 }

  it('hydrates an absent relationship as empty and never creates it on read', async () => {
    const m1 = await hydrateRelationship(scope, 'ghost', { now: T0 })
    expect(m1.isEmpty).toBe(true)
    expect(m1.beliefs).toEqual([])
    expect(m1.narrative).toEqual([])

    // A read must not summon the model into existence: still nothing persisted.
    await hydrateRelationship(scope, 'ghost', { now: T0 })
    expect(await readBeliefs(scope, { subjectType: 'lead', subjectId: 'ghost' }, { now: T0 })).toEqual([])
  })

  it('composes graded beliefs (by key) and the narrative floor (by kind)', async () => {
    await applyRelationshipBelief(scope, '100', belief({ key: 'intent', content: { label: 'hot' } }))
    await applyRelationshipBelief(scope, '100', belief({ key: 'budget', content: { band: 'mid' } }))
    await recordRelationshipNarrative(scope, '100', { kind: 'promise', content: { text: 'call Mon' }, occurredAt: T0 })
    await recordRelationshipNarrative(scope, '100', { kind: 'outcome', content: { text: 'won' }, occurredAt: at(10) })

    const m = await hydrateRelationship(scope, '100', { now: T0 })
    expect(m.isEmpty).toBe(false)
    expect(Object.keys(m.beliefsByKey).sort()).toEqual(['budget', 'intent'])
    // graded, not bare facts:
    expect(m.beliefsByKey.intent.storedConfidence).toBeCloseTo(0.8, 6)
    expect(m.beliefsByKey.intent.groundedness).toBeCloseTo(0.7, 6)
    expect(typeof m.beliefsByKey.intent.decayedConfidence).toBe('number')
    expect(m.narrativeByKind.promise).toHaveLength(1)
    expect(m.narrativeByKind.outcome).toHaveLength(1)
    expect(m.narrativeByKind.history).toHaveLength(0)
  })

  it('does not invent beliefs: the model holds exactly what was written', async () => {
    const m = await hydrateRelationship(scope, '100', { now: T0 })
    expect(m.beliefs).toHaveLength(2)
  })
})

describe('M2 World Model Runtime — temporal coherence', () => {
  const scope = { agencyId: 8002 }

  it('computes every belief’s decay at one shared asOf', async () => {
    await applyRelationshipBelief(scope, '200', belief({ key: 'a', confidence: 0.8, freshnessAt: at(0) }))
    await applyRelationshipBelief(scope, '200', belief({ key: 'b', confidence: 0.8, freshnessAt: at(1000) }))

    const m = await hydrateRelationship(scope, '200', { now: at(1000), policy: FAST_POLICY })
    expect(m.asOf).toBe(at(1000).toISOString())
    expect(m.beliefsByKey.a.decayedConfidence).toBeCloseTo(0.4, 6) // aged one half-life
    expect(m.beliefsByKey.b.decayedConfidence).toBeCloseTo(0.8, 6) // just refreshed
    // stored values untouched by representation:
    expect(m.beliefsByKey.a.storedConfidence).toBeCloseTo(0.8, 6)
  })
})

describe('M2 World Model Runtime — update pipeline (write) & residency', () => {
  const scope = { agencyId: 8003 }

  it('applies an event as a write and returns a coherent post-update model', async () => {
    const updated = await applyRelationshipBelief(scope, '300', belief({ key: 'stage', content: { s: 'demo' } }), {
      now: T0,
    })
    expect(updated.beliefsByKey.stage.content).toEqual({ s: 'demo' })

    // The write persisted through M1 (source of truth) and re-reads identically.
    const rehydrated = await hydrateRelationship(scope, '300', { now: T0 })
    expect(rehydrated.beliefsByKey.stage.content).toEqual({ s: 'demo' })
    expect(rehydrated.beliefsByKey.stage.version).toBe(1)
  })
})

describe('M2 World Model Runtime — multi-scale portfolio', () => {
  const scope = { agencyId: 8004 }

  it('aggregates member relationship models faithfully over one substrate', async () => {
    await applyRelationshipBelief(scope, 'L1', belief({ key: 'intent', content: { label: 'hot' } }))
    await applyRelationshipBelief(scope, 'L2', belief({ key: 'intent', content: { label: 'warm' } }))
    await applyPortfolioBelief(scope, 'expo-2026', belief({ key: 'source_quality', content: { grade: 'A' } }))

    const p = await hydratePortfolio(scope, 'expo-2026', ['L1', 'L2'], { now: T0 })
    expect(p.memberCount).toBe(2)
    expect(p.beliefsByKey.source_quality.content).toEqual({ grade: 'A' })

    // Members faithfully reflect the individually-hydrated relationships.
    const l1 = await hydrateRelationship(scope, 'L1', { now: T0 })
    const memberL1 = p.members.find((m) => m.subject.subjectId === 'L1')!
    expect(worldModelSignature(memberL1)).toBe(worldModelSignature(l1))
  })
})

describe('M2 World Model Runtime — snapshots & change detection', () => {
  const scope = { agencyId: 8005 }

  it('produces immutable snapshots with a stable signature that changes on update', async () => {
    await applyRelationshipBelief(scope, '500', belief({ key: 'intent', content: { label: 'hot' } }))
    const m1 = await hydrateRelationship(scope, '500', { now: T0 })
    const snap = snapshotRelationship(m1)

    expect(Object.isFrozen(snap)).toBe(true)
    expect(Object.isFrozen(snap.model)).toBe(true)
    expect(Object.isFrozen(snap.model.beliefs)).toBe(true)
    expect(() => snap.model.beliefs.push({} as never)).toThrow()

    // Same state → same signature.
    const m1again = await hydrateRelationship(scope, '500', { now: T0 })
    expect(worldModelSignature(m1again)).toBe(snap.signature)

    // Revise the belief (version bump) → signature changes.
    await applyRelationshipBelief(scope, '500', belief({ key: 'intent', content: { label: 'cold' } }))
    const m2 = await hydrateRelationship(scope, '500', { now: T0 })
    expect(worldModelSignature(m2)).not.toBe(snap.signature)

    // Appending narrative also changes the signature.
    const sigBeforeNarrative = worldModelSignature(m2)
    await recordRelationshipNarrative(scope, '500', { kind: 'history', content: { text: 'met' }, occurredAt: T0 })
    const m3 = await hydrateRelationship(scope, '500', { now: T0 })
    expect(worldModelSignature(m3)).not.toBe(sigBeforeNarrative)
  })

  it('snapshots a portfolio immutably', async () => {
    await applyPortfolioBelief(scope, 'q3', belief({ key: 'health', content: { ok: true } }))
    const p = await hydratePortfolio(scope, 'q3', [], { now: T0 })
    const snap = snapshotPortfolio(p)
    expect(Object.isFrozen(snap.model)).toBe(true)
    expect(Object.isFrozen(snap.model.members)).toBe(true)
  })
})

describe('M2 World Model Runtime — scope isolation', () => {
  const agencyA = { agencyId: 8006 }
  const agencyB = { agencyId: 8007 }

  it('never surfaces another operator’s world model', async () => {
    await applyRelationshipBelief(agencyA, '700', belief({ key: 'intent' }))
    await recordRelationshipNarrative(agencyA, '700', { kind: 'history', content: { text: 'x' } })

    const seenByB = await hydrateRelationship(agencyB, '700', { now: T0 })
    expect(seenByB.isEmpty).toBe(true)

    const membersByB = await hydrateRelationships(agencyB, ['700'], { now: T0 })
    expect(membersByB[0].isEmpty).toBe(true)

    // Owner still sees it.
    expect((await hydrateRelationship(agencyA, '700', { now: T0 })).isEmpty).toBe(false)
  })
})
