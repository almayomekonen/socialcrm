/**
 * AI Runtime — M1 State Management integration tests (real PostgreSQL).
 *
 * Proves the M1 responsibilities against a live database: resident belief
 * lifecycle, mandatory provenance, graded confidence, decay + staleness on time
 * alone, append-only versioning, temporal refresh, narrative-floor protection
 * under pruning, and strict scope isolation. Runs under `test:integration`.
 */
import { afterAll, describe, it, expect } from 'vitest'
import { db } from '@/config/db'
import {
  writeBelief,
  readBelief,
  readBeliefs,
  readBeliefVersions,
  refreshFreshness,
  listStaleBeliefs,
  recordNarrative,
  readNarrative,
  pruneBeliefVersions,
  type BeliefWriteInput,
} from '@/db/ai/stateManagement'
import type { DecayPolicy } from '@/db/ai/decay'

afterAll(async () => {
  await db.destroy()
})

const T0 = new Date('2026-05-01T00:00:00.000Z')
const at = (ms: number) => new Date(T0.getTime() + ms)

const FAST_POLICY: DecayPolicy = { halfLifeMs: 1000, staleAfterMs: 4000, floorConfidence: 0 }

function baseInput(over: Partial<BeliefWriteInput> & Pick<BeliefWriteInput, 'agencyId'>): BeliefWriteInput {
  return {
    subjectType: 'lead',
    subjectId: '101',
    key: 'intent',
    content: { label: 'high_intent' },
    confidence: 0.8,
    groundedness: 0.7,
    provenance: { traceRefs: [{ type: 'message', id: 'm1' }], inferentialDistance: 'low' },
    freshnessAt: T0,
    ...over,
  }
}

describe('M1 State Management — resident lifecycle & persistence', () => {
  const agencyId = 9001

  it('persists a belief and reads it back with its provenance intact', async () => {
    const written = await writeBelief(baseInput({ agencyId }))
    expect(written.version).toBe(1)

    const read = await readBelief({ agencyId }, { subjectType: 'lead', subjectId: '101' }, 'intent', { now: T0 })
    expect(read).not.toBeNull()
    expect(read!.content).toEqual({ label: 'high_intent' })
    expect(read!.storedConfidence).toBeCloseTo(0.8, 6)
    expect(read!.groundedness).toBeCloseTo(0.7, 6)
    expect(read!.provenance.traceRefs).toEqual([{ type: 'message', id: 'm1' }])
    expect(read!.provenance.inferentialDistance).toBe('low')
  })

  it('always exposes an evidence-against container even when none is supplied', async () => {
    await writeBelief(baseInput({ agencyId, key: 'budget' }))
    const read = await readBelief({ agencyId }, { subjectType: 'lead', subjectId: '101' }, 'budget', { now: T0 })
    expect(Array.isArray(read!.evidenceAgainst)).toBe(true)
    expect(read!.evidenceAgainst).toEqual([])
  })

  it('reads a subject’s whole current belief set', async () => {
    const all = await readBeliefs({ agencyId }, { subjectType: 'lead', subjectId: '101' }, { now: T0 })
    const keys = all.map((b) => b.key).sort()
    expect(keys).toEqual(['budget', 'intent'])
  })
})

describe('M1 State Management — contract invariants', () => {
  const agencyId = 9002

  it('rejects a non-absence belief with no trace', async () => {
    await expect(
      writeBelief(baseInput({ agencyId, key: 'no_prov', provenance: { traceRefs: [], inferentialDistance: 'low' } })),
    ).rejects.toThrow(/at least one trace/)
  })

  it('allows an absence-derived belief with no trace', async () => {
    const b = await writeBelief(
      baseInput({
        agencyId,
        key: 'went_silent',
        isAbsenceDerived: true,
        provenance: { traceRefs: [], inferentialDistance: 'medium' },
      }),
    )
    expect(b.isAbsenceDerived).toBe(true)
    expect(b.provenance.traceRefs).toEqual([])
  })

  it('rejects out-of-range confidence and groundedness', async () => {
    await expect(writeBelief(baseInput({ agencyId, key: 'bad_c', confidence: 1.4 }))).rejects.toThrow(/confidence/)
    await expect(writeBelief(baseInput({ agencyId, key: 'bad_g', groundedness: -0.1 }))).rejects.toThrow(/groundedness/)
  })
})

describe('M1 State Management — decay & staleness on time alone', () => {
  const agencyId = 9003

  it('decays confidence with elapsed time and flags staleness with no new trace', async () => {
    await writeBelief(baseInput({ agencyId, subjectId: '201', confidence: 0.8, freshnessAt: T0 }))
    const subject = { subjectType: 'lead' as const, subjectId: '201' }

    const fresh = await readBelief({ agencyId }, subject, 'intent', { now: T0, policy: FAST_POLICY })
    expect(fresh!.decayedConfidence).toBeCloseTo(0.8, 6)
    expect(fresh!.isStale).toBe(false)

    const oneHalfLife = await readBelief({ agencyId }, subject, 'intent', { now: at(1000), policy: FAST_POLICY })
    expect(oneHalfLife!.decayedConfidence).toBeCloseTo(0.4, 6)
    expect(oneHalfLife!.storedConfidence).toBeCloseTo(0.8, 6) // stored value untouched

    const stale = await readBelief({ agencyId }, subject, 'intent', { now: at(5000), policy: FAST_POLICY })
    expect(stale!.isStale).toBe(true)
  })

  it('lists stale beliefs by age, scoped, without touching stored values', async () => {
    await writeBelief(baseInput({ agencyId, subjectId: '301', key: 'old', freshnessAt: at(-100_000) }))
    await writeBelief(baseInput({ agencyId, subjectId: '302', key: 'recent', freshnessAt: at(0) }))
    const stale = await listStaleBeliefs({ agencyId }, { now: at(0), policy: FAST_POLICY })
    const staleSubjects = stale.map((b) => b.subjectId)
    expect(staleSubjects).toContain('301')
    expect(staleSubjects).not.toContain('302')
  })
})

describe('M1 State Management — temporal refresh', () => {
  const agencyId = 9004

  it('refresh resets decay, bumps version, and records a snapshot', async () => {
    const written = await writeBelief(baseInput({ agencyId, subjectId: '401', freshnessAt: T0 }))
    const subject = { subjectType: 'lead' as const, subjectId: '401' }

    const beforeRefresh = await readBelief({ agencyId }, subject, 'intent', { now: at(2000), policy: FAST_POLICY })
    expect(beforeRefresh!.decayedConfidence).toBeLessThan(0.8)

    const refreshed = await refreshFreshness({ agencyId }, written.id, at(2000))
    expect(refreshed!.version).toBe(2)

    const afterRefresh = await readBelief({ agencyId }, subject, 'intent', { now: at(2000), policy: FAST_POLICY })
    expect(afterRefresh!.decayedConfidence).toBeCloseTo(0.8, 6) // decay reset at refresh moment

    const versions = await readBeliefVersions({ agencyId }, written.id)
    expect(versions.map((v) => v.version)).toEqual([2, 1])
  })

  it('cannot refresh a belief owned by another agency', async () => {
    const written = await writeBelief(baseInput({ agencyId, subjectId: '499', key: 'scoped' }))
    const foreign = await refreshFreshness({ agencyId: 9999 }, written.id, at(0))
    expect(foreign).toBeNull()
  })
})

describe('M1 State Management — append-only versioning', () => {
  const agencyId = 9005

  it('keeps one current row but a full immutable history across revisions', async () => {
    const subject = { subjectType: 'lead' as const, subjectId: '501' }
    const v1 = await writeBelief(baseInput({ agencyId, subjectId: '501', content: { label: 'a' }, confidence: 0.5 }))
    const v2out = await writeBelief(baseInput({ agencyId, subjectId: '501', content: { label: 'b' }, confidence: 0.9 }))
    expect(v1.id).toBe(v2out.id) // same current row
    expect(v2out.version).toBe(2)

    const current = await readBeliefs({ agencyId }, subject, { now: T0 })
    expect(current).toHaveLength(1)
    expect(current[0].content).toEqual({ label: 'b' })
    expect(current[0].storedConfidence).toBeCloseTo(0.9, 6)

    const versions = await readBeliefVersions({ agencyId }, v1.id)
    expect(versions.map((v) => v.version)).toEqual([2, 1])
    expect(versions[1].content).toEqual({ label: 'a' })
    expect(versions[0].content).toEqual({ label: 'b' })
  })
})

describe('M1 State Management — narrative floor protection', () => {
  const agencyId = 9006

  it('preserves the narrative floor through pruning while trimming old versions', async () => {
    const subject = { subjectType: 'lead' as const, subjectId: '601' }
    await recordNarrative({ agencyId, ...subject, kind: 'promise', content: { text: 'call Monday' }, occurredAt: T0 })
    await recordNarrative({ agencyId, ...subject, kind: 'outcome', content: { text: 'closed' }, occurredAt: at(1000) })

    // Generate many versions of a belief so pruning has something to trim.
    for (let i = 0; i < 8; i++) {
      await writeBelief(baseInput({ agencyId, subjectId: '601', key: 'intent', confidence: 0.1 + i * 0.05 }))
    }
    const belief = await readBelief({ agencyId }, subject, 'intent', { now: T0 })
    expect((await readBeliefVersions({ agencyId }, belief!.id)).length).toBe(8)

    const { deletedVersions } = await pruneBeliefVersions({ agencyId }, { keepVersionsPerBelief: 3 })
    expect(deletedVersions).toBe(5)

    // Narrative floor is untouched.
    const narrative = await readNarrative({ agencyId }, subject)
    expect(narrative.map((n) => n.kind)).toEqual(['promise', 'outcome'])
    // Current belief still present; only its old snapshots were trimmed.
    expect(await readBelief({ agencyId }, subject, 'intent', { now: T0 })).not.toBeNull()
    expect((await readBeliefVersions({ agencyId }, belief!.id)).length).toBe(3)
  })
})

describe('M1 State Management — scope isolation', () => {
  const agencyA = 9007
  const agencyB = 9008

  it('never lets one operator read another operator’s state', async () => {
    const subject = { subjectType: 'lead' as const, subjectId: '701' }
    await writeBelief(baseInput({ agencyId: agencyA, subjectId: '701', key: 'intent' }))
    await recordNarrative({ agencyId: agencyA, ...subject, kind: 'history', content: { text: 'met at expo' } })

    expect(await readBelief({ agencyId: agencyB }, subject, 'intent', { now: T0 })).toBeNull()
    expect(await readBeliefs({ agencyId: agencyB }, subject, { now: T0 })).toEqual([])
    expect(await readNarrative({ agencyId: agencyB }, subject)).toEqual([])
    expect(await listStaleBeliefs({ agencyId: agencyB }, { now: at(1e9), policy: FAST_POLICY })).toEqual([])

    // Agency A still sees its own state.
    expect(await readBelief({ agencyId: agencyA }, subject, 'intent', { now: T0 })).not.toBeNull()
    expect((await readNarrative({ agencyId: agencyA }, subject)).length).toBe(1)
  })
})
