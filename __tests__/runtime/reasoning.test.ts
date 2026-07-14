/**
 * AI Runtime — M5 Reasoning Runtime integration tests (real PostgreSQL).
 *
 * Proves the reasoning episode runs read-only over the resident World Model
 * (M2) built on State Management (M1): it reasons over persisted beliefs,
 * honours time-decay in its credence, preserves provenance, and stays isolated
 * by scope — writing nothing back. Runs under `test:runtime`.
 */
import { afterAll, describe, it, expect } from 'vitest'
import { db } from '@/config/db'
import { writeBelief, readBeliefs, type Scope } from '@/db/ai/stateManagement'
import { reason } from '@/lib/ai/runtime/reasoning'
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

describe('M5 Reasoning — over the resident World Model', () => {
  it('reasons over persisted beliefs and reaches a grounded understanding', async () => {
    const scope: Scope = { agencyId: 9501 }
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
    expect(u.isGrounded).toBe(true)
    expect(u.beliefCount).toBe(1)
    const intent = u.questions.find((x) => x.key === 'intent')!
    expect(intent.leading.label).toBe('holds')
    expect(intent.leading.credence).toBeGreaterThan(0.85)
    expect(intent.provenance.traceRefs.map((t) => t.id)).toContain('m1')
    expect(intent.decisionStable).toBe(true)
  })

  it('honours time-decay: an aged belief yields lower credence than a fresh one', async () => {
    const scope: Scope = { agencyId: 9502 }
    await writeBelief({
      agencyId: scope.agencyId,
      subjectType: 'lead',
      subjectId: 'lead-fresh',
      key: 'intent',
      content: {},
      confidence: 0.9,
      groundedness: 0.6,
      provenance: prov,
      freshnessAt: NOW,
    })
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

    const fresh = await reason(relRequest(scope, 'lead-fresh'), { now: NOW })
    const aged = await reason(relRequest(scope, 'lead-aged'), { now: NOW })
    const credence = (u: Awaited<ReturnType<typeof reason>>) =>
      u.questions.find((x) => x.key === 'intent')!.hypotheses.find((h) => h.label === 'holds')!.credence
    expect(credence(fresh)).toBeGreaterThan(credence(aged))
  })

  it('is read-only: reasoning writes nothing back to State Management', async () => {
    const scope: Scope = { agencyId: 9503 }
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
    await reason(relRequest(scope, 'lead-x', 'absence'), { now: NOW })
    const after = await readBeliefs(scope, { subjectType: 'lead', subjectId: 'lead-x' }, { now: NOW })
    expect(after).toHaveLength(before.length)
    expect(after[0].version).toBe(before[0].version)
  })

  it('reasons an empty relationship into an honest "no understanding"', async () => {
    const scope: Scope = { agencyId: 9504 }
    const u = await reason(relRequest(scope, 'ghost'), { now: NOW })
    expect(u.isGrounded).toBe(false)
    expect(u.beliefCount).toBe(0)
    expect(u.decisionStable).toBe(true)
  })

  it('is isolated by scope: another agency\u2019s beliefs never enter the episode', async () => {
    const mine: Scope = { agencyId: 9505 }
    const other: Scope = { agencyId: 9506 }
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
    const u = await reason(relRequest(mine, 'shared-id'), { now: NOW })
    expect(u.isGrounded).toBe(false)
    expect(u.beliefCount).toBe(0)
  })
})
