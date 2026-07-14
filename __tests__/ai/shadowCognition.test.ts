/**
 * Unit tests for Integration-2 shadow cognition (pure, no DB).
 * Injects M5 reason, M6 decide, and the sink, so the M3→M4 wiring (real, pure),
 * the flag gate, the outcome mapping, and the guarded (never-throws) contract are
 * all tested without a database.
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  shadowReasonAndDecide,
  isShadowCognitionEnabled,
  type ShadowCognitionDeps,
} from '@/lib/ai/integration/shadowCognition'
import type { ReasonedUnderstanding } from '@/lib/ai/runtime/reasoning'
import type { GateDecision } from '@/lib/ai/runtime/toolAction'
import type { ShadowDecisionInput } from '@/db/ai/shadowDecisions'

const understanding = { asOf: '2026-07-14T00:00:00.000Z' } as ReasonedUnderstanding
const REASON: ShadowCognitionDeps['reason'] = (async () => understanding) as ShadowCognitionDeps['reason']

function decideReturning(d: unknown): ShadowCognitionDeps['decide'] {
  return (() => d as GateDecision) as ShadowCognitionDeps['decide']
}
function mockRecord() {
  const calls: ShadowDecisionInput[] = []
  const fn = (async (input: ShadowDecisionInput) => {
    calls.push(input)
    return 1
  }) as unknown as ShadowCognitionDeps['record']
  return { fn, calls }
}

const input = () => ({ agencyId: 7, leadId: 42, conversationId: 100, turnCount: 3 })
const on: ShadowCognitionDeps['isEnabled'] = () => true

describe('Integration-2 shadow cognition — flag gate', () => {
  it('is a pure no-op when the flag is off', async () => {
    const rec = mockRecord()
    const r = await shadowReasonAndDecide(input(), { isEnabled: () => false, reason: REASON, decide: decideReturning({ emitted: true, outcome: 'recommend' }), record: rec.fn })
    expect(r.skipped).toBe(true)
    expect(r.ran).toBe(false)
    expect(rec.calls).toHaveLength(0)
  })
})

describe('Integration-2 shadow cognition — outcome mapping & persistence', () => {
  it('records a Recommend decision with the turn/conversation keys', async () => {
    const rec = mockRecord()
    const r = await shadowReasonAndDecide(input(), { isEnabled: on, reason: REASON, decide: decideReturning({ emitted: true, outcome: 'recommend' }), record: rec.fn })
    expect(r.ran).toBe(true)
    expect(r.outcome).toBe('recommend')
    expect(r.persisted).toBe(true)
    expect(rec.calls).toHaveLength(1)
    const c = rec.calls[0]
    expect(c).toMatchObject({ agencyId: 7, subjectId: '42', conversationId: 100, turnCount: 3, outcome: 'recommend', emitted: true, rejectionBoundary: null })
  })

  it('records a Stay Silent decision', async () => {
    const rec = mockRecord()
    const r = await shadowReasonAndDecide(input(), { isEnabled: on, reason: REASON, decide: decideReturning({ emitted: true, outcome: 'stay_silent' }), record: rec.fn })
    expect(r.outcome).toBe('stay_silent')
    expect(rec.calls[0].outcome).toBe('stay_silent')
  })

  it('maps an internal rejection to outcome=rejected with its boundary (not a terminal outcome)', async () => {
    const rec = mockRecord()
    const r = await shadowReasonAndDecide(input(), {
      isEnabled: on,
      reason: REASON,
      decide: decideReturning({ emitted: false, outcome: null, rejection: { boundary: 'scope', reason: 'mismatch' } }),
      record: rec.fn,
    })
    expect(r.outcome).toBe('rejected')
    expect(rec.calls[0]).toMatchObject({ outcome: 'rejected', emitted: false, rejectionBoundary: 'scope' })
  })
})

describe('Integration-2 shadow cognition — never affects the caller', () => {
  it('swallows a reasoning failure, records nothing, never throws', async () => {
    const rec = mockRecord()
    const throwingReason = (async () => {
      throw new Error('hydrate down')
    }) as ShadowCognitionDeps['reason']
    const r = await shadowReasonAndDecide(input(), { isEnabled: on, reason: throwingReason, decide: decideReturning({ emitted: true, outcome: 'recommend' }), record: rec.fn })
    expect(r.errored).toBe(true)
    expect(r.ran).toBe(false)
    expect(r.persisted).toBe(false)
    expect(rec.calls).toHaveLength(0)
  })

  it('swallows a sink failure but reports the run (persisted=false)', async () => {
    const throwingRecord = (async () => {
      throw new Error('db down')
    }) as unknown as ShadowCognitionDeps['record']
    const r = await shadowReasonAndDecide(input(), { isEnabled: on, reason: REASON, decide: decideReturning({ emitted: true, outcome: 'recommend' }), record: throwingRecord })
    expect(r.ran).toBe(true)
    expect(r.persisted).toBe(false)
    expect(r.errored).toBe(true)
  })
})

describe('Integration-2 shadow cognition — the per-agency canary flag', () => {
  const KEYS = ['SHADOW_COGNITION_AGENCY_IDS', 'SHADOW_COGNITION_KILL'] as const
  const saved: Record<string, string | undefined> = {}
  for (const k of KEYS) saved[k] = process.env[k]
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('defaults OFF, enables allowlisted agencies, honours the kill backstop', () => {
    delete process.env.SHADOW_COGNITION_AGENCY_IDS
    delete process.env.SHADOW_COGNITION_KILL
    expect(isShadowCognitionEnabled(7)).toBe(false)
    process.env.SHADOW_COGNITION_AGENCY_IDS = '7, 9'
    expect(isShadowCognitionEnabled(7)).toBe(true)
    expect(isShadowCognitionEnabled(8)).toBe(false)
    process.env.SHADOW_COGNITION_KILL = '1'
    expect(isShadowCognitionEnabled(7)).toBe(false)
  })
})
