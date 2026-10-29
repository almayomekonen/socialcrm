import { afterAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Shadow budget reservations against a real PostgreSQL: atomic under
 * concurrency, idempotent, reconciled honestly (unknown cost charged at the
 * estimate, never zero), recovered on expiry, tenant-isolated, and tolerant of
 * missing contact/conversation identity. Decisions are simulations only.
 */
import { db } from '@/config/db'
import { expireStaleShadowReservations, reserveShadow, settleShadow, type ReserveInput } from '@/db/aiBudget'
import { DEFAULT_BUDGET_POLICY, type BudgetPolicy } from '@/lib/ai/budget/policy'

const A = 9401
const B = 9402
let seq = 0
const NOW = new Date('2026-10-30T10:15:00Z')
const policy = (over: Partial<BudgetPolicy> = {}): BudgetPolicy => ({ ...DEFAULT_BUDGET_POLICY, version: 'test-v1', ...over })
const input = (over: Partial<ReserveInput> = {}): ReserveInput => ({
  callId: `bud-${++seq}-${Math.random()}`,
  policy: policy(),
  agencyId: A,
  operationKind: 'auto_response_job',
  operationId: `job-${seq}`,
  conversationId: null,
  contactKey: null,
  feature: 'inbox.autoResponse',
  provider: 'openai',
  model: 'gpt-5.6-sol',
  estimate: { usd: 0.02, basis: 'bounded', incomplete: false, note: null },
  now: NOW,
  ...over,
})
const counter = (key: string, kind: string) => db('ai_budget_counters').where({ scopeKey: key, windowKind: kind }).first()
const res = (callId: string) => db('ai_budget_reservations').where({ callId }).first()

async function clean() {
  await db('ai_budget_reservations').whereIn('agencyId', [A, B]).orWhereNull('agencyId').del()
  await db('ai_budget_counters')
    .where('scopeKey', 'like', 'agency:94%')
    .orWhere('scopeKey', 'global')
    .orWhere('scopeKey', 'like', 'run:a94%')
    .orWhere('scopeKey', 'like', 'conv:a94%')
    .orWhere('scopeKey', 'like', 'contact:%')
    .del()
}
beforeEach(clean)
afterAll(clean)

describe('atomic reservations', () => {
  it('10 concurrent requests against a $0.05/day agency limit: exactly 2 would be allowed', async () => {
    const p = policy({ agencyDailyUsd: 0.05 })
    const decisions = await Promise.all(Array.from({ length: 10 }, () => reserveShadow(input({ policy: p }))))
    expect(decisions.filter((d) => d.decision === 'would_allow')).toHaveLength(2)
    expect(decisions.filter((d) => d.denyReasons.includes('agency_daily_limit'))).toHaveLength(8)
    const c = await counter(`agency:${A}`, 'day')
    expect(Number(c.reservedUsd)).toBeCloseTo(0.2, 6) // shadow reserves everything: the real calls still happen
    expect(c.requests).toBe(10)
  })

  it('a warning scope is recorded at the configured fraction', async () => {
    const d = await reserveShadow(input({ policy: policy({ agencyDailyUsd: 0.025, warnAtFraction: 0.8 }) }))
    expect(d).toMatchObject({ decision: 'would_allow', warnScopes: ['agency_daily'] })
  })
})

describe('idempotency and reconciliation', () => {
  it('reserving the same callId twice counts once', async () => {
    const i = input()
    await reserveShadow(i)
    const again = await reserveShadow(i)
    expect(again.created).toBe(false)
    expect((await counter(`agency:${A}`, 'day')).requests).toBe(1)
  })

  it('settle moves the estimate out of reserved and the ACTUAL into spent, once', async () => {
    const i = input()
    await reserveShadow(i)
    expect(await settleShadow({ callId: i.callId, outcome: 'success', actualUsd: 0.005 })).toBe(true)
    expect(await settleShadow({ callId: i.callId, outcome: 'success', actualUsd: 0.005 })).toBe(false)
    const c = await counter(`agency:${A}`, 'day')
    expect([Number(c.reservedUsd), Number(c.spentUsd)]).toEqual([0, 0.005])
    expect(await res(i.callId)).toMatchObject({ state: 'reconciled' })
  })

  it('unknown cost is charged at the estimate, never zero', async () => {
    const i = input()
    await reserveShadow(i)
    await settleShadow({ callId: i.callId, outcome: 'success', actualUsd: null })
    const c = await counter(`agency:${A}`, 'day')
    expect([Number(c.spentUsd), c.unknownCostRequests]).toEqual([0.02, 1])
    expect(await res(i.callId)).toMatchObject({ state: 'unknown_cost', actualUsd: null })
  })

  it('a failed request with no usage is charged the estimate; with usage, the actual', async () => {
    const a = input()
    const b = input()
    await reserveShadow(a)
    await reserveShadow(b)
    await settleShadow({ callId: a.callId, outcome: 'error', actualUsd: null })
    await settleShadow({ callId: b.callId, outcome: 'error', actualUsd: 0.001 })
    expect(Number((await res(a.callId)).chargedUsd)).toBe(0.02)
    expect(Number((await res(b.callId)).chargedUsd)).toBe(0.001)
    expect((await res(a.callId)).state).toBe('failed')
  })
})

describe('expiry and recovery', () => {
  it('an unsettled reservation past its TTL is expired, charged its estimate, and not twice', async () => {
    const i = input()
    await reserveShadow(i)
    await db('ai_budget_reservations')
      .where({ callId: i.callId })
      .update({ reservedAt: new Date(Date.now() - 60 * 60_000) })
    expect(await expireStaleShadowReservations(new Date(), 15)).toBeGreaterThanOrEqual(1)
    expect(await expireStaleShadowReservations(new Date(), 15)).toBe(0)
    expect(await res(i.callId)).toMatchObject({ state: 'expired' })
    const c = await counter(`agency:${A}`, 'day')
    expect([Number(c.reservedUsd), Number(c.spentUsd)]).toEqual([0, 0.02])
    expect(await settleShadow({ callId: i.callId, outcome: 'success', actualUsd: 0.001 })).toBe(false) // a late settle changes nothing
  })
})

describe('isolation, identity and the global breaker', () => {
  it('agency A filling its limit never affects agency B', async () => {
    const p = policy({ agencyDailyUsd: 0.03 })
    await reserveShadow(input({ policy: p }))
    await reserveShadow(input({ policy: p }))
    const b = await reserveShadow(input({ policy: p, agencyId: B }))
    expect(b.decision).toBe('would_allow')
    expect((await counter(`agency:${B}`, 'day')).requests).toBe(1)
  })

  it('missing conversation, contact and agency are skipped, not errors', async () => {
    const d = await reserveShadow(input({ agencyId: null }))
    expect(d.scopesSkipped.sort()).toEqual(['agency', 'contact', 'conversation'])
    expect(d.decision).toBe('would_allow')
  })

  it('conversation and contact scopes are counted when known', async () => {
    const p = policy({ conversationDailyUsd: 0.03, contactWindowUsd: 0.03 })
    await reserveShadow(input({ policy: p, conversationId: 501, contactKey: 'abc' }))
    const d = await reserveShadow(input({ policy: p, conversationId: 501, contactKey: 'abc' }))
    expect(d.denyReasons.sort()).toEqual(['contact_window_limit', 'conversation_daily_limit'])
  })

  it('the global daily breaker is simulated across agencies', async () => {
    const p = policy({ globalDailyUsd: 0.03 })
    await reserveShadow(input({ policy: p, agencyId: A }))
    const d = await reserveShadow(input({ policy: p, agencyId: B }))
    expect(d.denyReasons).toContain('global_daily_limit')
  })

  it('per-request maximum and unbounded estimates', async () => {
    expect((await reserveShadow(input({ policy: policy({ perRequestMaxUsd: 0.01 }) }))).denyReasons).toEqual(['request_max'])
    const u = await reserveShadow(input({ estimate: { usd: 0.1, basis: 'unbounded', incomplete: true, note: 'unpriced_model' } }))
    expect(u.denyReasons).toEqual(['max_cost_unbounded'])
    const row = await db('ai_budget_reservations').where({ estimateBasis: 'unbounded', agencyId: A }).first()
    expect(row).toMatchObject({ costMetadataIncomplete: true, mode: 'shadow', policyVersion: 'test-v1' })
  })
})
