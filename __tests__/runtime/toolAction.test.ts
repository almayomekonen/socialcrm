/**
 * AI Runtime — M6 Tool / Action Runtime integration tests (real PostgreSQL).
 *
 * Proves the gate runs end-to-end over the live pipeline: State Management (M1)
 * holds beliefs, the World Model (M2) is resident, Reasoning (M5) produces a
 * justified understanding, and the Tool/Action gate (M6) decides a constitutional
 * terminal outcome — Recommend or Stay Silent — carrying real provenance walked
 * back from the persisted traces, staying isolated by scope, and writing nothing.
 * Runs under `test:runtime`.
 */
import { afterAll, describe, it, expect } from 'vitest'
import { db } from '@/config/db'
import { writeBelief, readBeliefs, type Scope } from '@/db/ai/stateManagement'
import { reason } from '@/lib/ai/runtime/reasoning'
import { decide } from '@/lib/ai/runtime/toolAction'
import type { CognitionRequest } from '@/lib/ai/runtime/scheduler'

afterAll(async () => {
  await db.destroy()
})

const NOW = new Date('2026-07-14T00:00:00.000Z')
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

describe('M6 Tool/Action — over the live M1→M5 pipeline', () => {
  it('recommends a grounded, settled understanding with real walked-back provenance', async () => {
    const scope: Scope = { agencyId: 9601 }
    await writeBelief({
      agencyId: scope.agencyId,
      subjectType: 'lead',
      subjectId: 'lead-1',
      key: 'intent',
      content: { label: 'wants_quote' },
      confidence: 0.85,
      groundedness: 0.7,
      evidenceFor: [{ type: 'message', id: 'm1' }, { type: 'message', id: 'm2' }],
      provenance: prov,
      freshnessAt: NOW,
    })

    const u = await reason(relRequest(scope, 'lead-1'), { now: NOW })
    const d = decide(u, { scope, now: NOW })

    expect(d.emitted).toBe(true)
    expect(d.outcome).toBe('recommend')
    if (!d.emitted || d.outcome !== 'recommend') throw new Error('expected recommend')
    expect(d.recommendation.reversibility).toBe('reversible')
    expect(d.recommendation.autonomy.level).toBe('none')
    expect(d.recommendation.provenance.traceRefs.map((t) => t.id)).toContain('m1')
    expect(d.recommendation.reasoningChain.map((l) => l.key)).toContain('intent')
  })

  it('stays silent over an empty relationship (honest no-understanding)', async () => {
    const scope: Scope = { agencyId: 9602 }
    const u = await reason(relRequest(scope, 'ghost'), { now: NOW })
    const d = decide(u, { scope, now: NOW })
    expect(d.emitted).toBe(true)
    expect(d.outcome).toBe('stay_silent')
    if (!d.emitted || d.outcome !== 'stay_silent') throw new Error('expected stay_silent')
    expect(d.silence.reason).toBe('no_grounded_understanding')
  })

  it('is read-only: gating writes nothing back to State Management', async () => {
    const scope: Scope = { agencyId: 9603 }
    await writeBelief({
      agencyId: scope.agencyId,
      subjectType: 'lead',
      subjectId: 'lead-x',
      key: 'intent',
      content: {},
      confidence: 0.85,
      groundedness: 0.6,
      evidenceFor: [{ type: 'message', id: 'm1' }],
      provenance: prov,
      freshnessAt: NOW,
    })
    const before = await readBeliefs(scope, { subjectType: 'lead', subjectId: 'lead-x' }, { now: NOW })
    const u = await reason(relRequest(scope, 'lead-x'), { now: NOW })
    decide(u, { scope, now: NOW })
    const after = await readBeliefs(scope, { subjectType: 'lead', subjectId: 'lead-x' }, { now: NOW })
    expect(after).toHaveLength(before.length)
    expect(after[0].version).toBe(before[0].version)
  })

  it('rejects internally when the gate scope does not match the understanding scope', async () => {
    const scope: Scope = { agencyId: 9604 }
    await writeBelief({
      agencyId: scope.agencyId,
      subjectType: 'lead',
      subjectId: 'lead-1',
      key: 'intent',
      content: {},
      confidence: 0.85,
      groundedness: 0.7,
      evidenceFor: [{ type: 'message', id: 'm1' }],
      provenance: prov,
      freshnessAt: NOW,
    })
    const u = await reason(relRequest(scope, 'lead-1'), { now: NOW })
    const d = decide(u, { scope: { agencyId: 9605 }, now: NOW })
    expect(d.emitted).toBe(false)
    expect(d.outcome).toBeNull()
    if (!('rejection' in d)) throw new Error('expected internal rejection')
    expect(d.rejection.boundary).toBe('scope')
  })
})
