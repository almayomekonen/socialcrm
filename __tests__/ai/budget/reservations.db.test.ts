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
import { recordProviderCalls } from '@/lib/ai/usage/record'
// Executed directly (not read as text) to prove re-application and rollback are safe.
const migration = require('../../../migrations/20261101120000_ai_budget_reservation_cost_basis.cjs')
const stateMigration = require('../../../migrations/20261101130000_ai_budget_reservation_state_basis.cjs')

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
    expect(await settleShadow({ callId: i.callId, outcome: 'success', actualUsd: 0.005, costBasis: 'reported_usage' })).toBe(true)
    expect(await settleShadow({ callId: i.callId, outcome: 'success', actualUsd: 0.005, costBasis: 'reported_usage' })).toBe(
      false,
    )
    const c = await counter(`agency:${A}`, 'day')
    expect([Number(c.reservedUsd), Number(c.spentUsd)]).toEqual([0, 0.005])
    expect(await res(i.callId)).toMatchObject({ state: 'reconciled' })
  })

  it('unknown cost is charged at the estimate, never zero', async () => {
    const i = input()
    await reserveShadow(i)
    await settleShadow({ callId: i.callId, outcome: 'success', actualUsd: null, costBasis: 'unknown' })
    const c = await counter(`agency:${A}`, 'day')
    expect([Number(c.spentUsd), c.unknownCostRequests]).toEqual([0.02, 1])
    expect(await res(i.callId)).toMatchObject({ state: 'unknown_cost', actualUsd: null })
  })

  it('a failed request with no usage is charged the estimate; with usage, the actual', async () => {
    const a = input()
    const b = input()
    await reserveShadow(a)
    await reserveShadow(b)
    await settleShadow({ callId: a.callId, outcome: 'error', actualUsd: null, costBasis: 'unknown' })
    await settleShadow({ callId: b.callId, outcome: 'error', actualUsd: 0.001, costBasis: 'estimated' })
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
    expect(await res(i.callId)).toMatchObject({
      state: 'expired',
      actualUsd: null,
      actualCostBasis: 'unknown',
      actualCostNote: 'expired_unsettled',
    })
    const c = await counter(`agency:${A}`, 'day')
    expect([Number(c.reservedUsd), Number(c.spentUsd)]).toEqual([0, 0.02])
    expect(await settleShadow({ callId: i.callId, outcome: 'success', actualUsd: 0.001, costBasis: 'reported_usage' })).toBe(
      false,
    ) // a late settle changes nothing
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

describe('cost basis is preserved (migration 20261101120000)', () => {
  it('an estimated actual is stored AS estimated, with its notes, price version, models and ledger link', async () => {
    const i = input({ invocationId: 'inv-basis-1', estimatePriceVersion: '2026-10-30' })
    await reserveShadow(i)
    await settleShadow({
      callId: i.callId,
      outcome: 'success',
      actualUsd: 0.004,
      costBasis: 'estimated',
      costNote: 'cache_write_unreported',
      priceVersion: '2026-10-30',
      responseModels: ['gpt-5.6-sol'],
      stepIndexFrom: 2,
      stepCount: 3,
    })
    expect(await res(i.callId)).toMatchObject({
      state: 'reconciled',
      actualCostBasis: 'estimated',
      actualCostNote: 'cache_write_unreported',
      actualPriceVersion: '2026-10-30',
      estimatePriceVersion: '2026-10-30',
      responseModels: ['gpt-5.6-sol'],
      invocationId: 'inv-basis-1',
      stepIndexFrom: 2,
      stepCount: 3,
    })
  })

  it('unknown never carries an amount, and a missing amount is never "known"', async () => {
    const a = input()
    const b = input()
    const c = input()
    for (const x of [a, b, c]) await reserveShadow(x)
    await settleShadow({ callId: a.callId, outcome: 'success', actualUsd: 0.5, costBasis: 'unknown', costNote: 'unpriced_model' })
    await settleShadow({ callId: b.callId, outcome: 'success', actualUsd: null, costBasis: 'estimated' })
    await settleShadow({ callId: c.callId, outcome: 'success', actualUsd: Number.NaN, costBasis: 'reported_usage' })
    expect(await res(a.callId)).toMatchObject({
      state: 'unknown_cost',
      actualUsd: null,
      actualCostBasis: 'unknown',
      actualCostNote: 'unpriced_model',
    })
    expect(await res(b.callId)).toMatchObject({ state: 'unknown_cost', actualUsd: null, actualCostBasis: 'unknown' })
    expect(await res(c.callId)).toMatchObject({
      state: 'unknown_cost',
      actualUsd: null,
      actualCostBasis: 'unknown',
      actualCostNote: 'amount_missing',
    })
    for (const x of [a, b, c]) expect(Number((await res(x.callId)).chargedUsd)).toBe(0.02) // charged the estimate, never 0
  })

  it('the schema itself rejects an unknown basis with an amount, or a known basis without one', async () => {
    const i = input()
    await reserveShadow(i)
    const set = (patch: Record<string, unknown>) => db('ai_budget_reservations').where({ callId: i.callId }).update(patch)
    await expect(set({ actualCostBasis: 'unknown', actualUsd: 0.01 })).rejects.toThrow(/basis_matches_actual/)
    await expect(set({ actualCostBasis: 'reported_usage', actualUsd: null })).rejects.toThrow(/basis_matches_actual/)
    await expect(set({ actualCostBasis: 'exact', actualUsd: 0.01 })).rejects.toThrow()
  })

  it('a retried settlement cannot overwrite the first one, nor its basis', async () => {
    const i = input()
    await reserveShadow(i)
    expect(await settleShadow({ callId: i.callId, outcome: 'success', actualUsd: 0.003, costBasis: 'estimated' })).toBe(true)
    expect(await settleShadow({ callId: i.callId, outcome: 'success', actualUsd: 0.001, costBasis: 'reported_usage' })).toBe(
      false,
    )
    expect(await res(i.callId)).toMatchObject({ actualCostBasis: 'estimated' })
    expect(Number((await res(i.callId)).actualUsd)).toBe(0.003)
    expect(Number((await counter(`agency:${A}`, 'day')).spentUsd)).toBe(0.003)
  })

  it('reconcilable without any ledger row: the reservation carries its own basis and link', async () => {
    const i = input({ invocationId: 'inv-no-ledger' })
    await reserveShadow(i)
    await settleShadow({
      callId: i.callId,
      outcome: 'error',
      actualUsd: null,
      costBasis: 'unknown',
      costNote: 'usage_missing',
      stepIndexFrom: 0,
      stepCount: 1,
    })
    expect(await db('ai_usage_events').where({ invocationId: 'inv-no-ledger' })).toHaveLength(0)
    expect(await res(i.callId)).toMatchObject({
      state: 'failed',
      invocationId: 'inv-no-ledger',
      actualCostBasis: 'unknown',
      stepCount: 1,
    })
  })

  it('rows settled before the migration keep a NULL basis (not backfilled); re-applying and rolling back are safe', async () => {
    const i = input()
    await reserveShadow(i)
    // A pre-migration settlement: an amount with no recorded basis. Written with
    // the later state/basis constraints off, exactly as history was written.
    await stateMigration.down(db)
    await db('ai_budget_reservations')
      .where({ callId: i.callId })
      .update({ state: 'reconciled', actualUsd: 0.004, chargedUsd: 0.004 })
    await migration.up(db) // re-application is a no-op
    expect(await res(i.callId)).toMatchObject({ actualCostBasis: null })
    await migration.down(db)
    await migration.down(db) // rollback is re-runnable too
    const cols = async () =>
      (await db.raw(`SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_budget_reservations'`)).rows.map(
        (r: { column_name: string }) => r.column_name,
      )
    expect(await cols()).not.toContain('actualCostBasis')
    expect(Number((await res(i.callId)).actualUsd)).toBe(0.004) // existing data untouched
    await migration.up(db)
    expect(await cols()).toEqual(
      expect.arrayContaining(['actualCostBasis', 'actualCostNote', 'actualPriceVersion', 'invocationId', 'stepCount']),
    )
    expect(await res(i.callId)).toMatchObject({ actualCostBasis: null })
    // The later constraints apply on top of this history without rejecting or rewriting it.
    await stateMigration.up(db)
    expect(await res(i.callId)).toMatchObject({ state: 'reconciled', actualCostBasis: null })
  })
})

const constraintNames = async () =>
  (
    await db.raw(
      `SELECT conname, convalidated FROM pg_constraint WHERE conrelid = 'ai_budget_reservations'::regclass AND contype = 'c' ORDER BY conname`,
    )
  ).rows as { conname: string; convalidated: boolean }[]

describe('state ↔ basis constraints (migration 20261101130000)', () => {
  it('runs after the cost-basis migration, and both are recorded in order', async () => {
    const names = (await db('knex_migrations').orderBy('id').pluck('name')) as string[]
    const a = names.indexOf('20261031120000_ai_budget_shadow.cjs')
    const b = names.indexOf('20261101120000_ai_budget_reservation_cost_basis.cjs')
    const c = names.indexOf('20261101130000_ai_budget_reservation_state_basis.cjs')
    expect([a >= 0, b > a, c > b]).toEqual([true, true, true])
  })

  it('validated where history allows; NOT VALID where it does not', async () => {
    const byName = Object.fromEntries((await constraintNames()).map((r) => [r.conname, r.convalidated]))
    expect(byName).toMatchObject({
      ai_budget_reservations_open_unsettled: true,
      ai_budget_reservations_state_matches_basis: true,
      ai_budget_reservations_settled_has_basis: false,
    })
  })

  it('rejects an open row with a basis, a state that contradicts its basis, and a new settlement without one', async () => {
    const i = input()
    await reserveShadow(i)
    const set = (patch: Record<string, unknown>) => db('ai_budget_reservations').where({ callId: i.callId }).update(patch)
    await expect(set({ actualCostBasis: 'estimated', actualUsd: 0.01 })).rejects.toThrow(/open_unsettled/)
    await expect(set({ state: 'reconciled', actualCostBasis: 'unknown', actualUsd: null })).rejects.toThrow(/state_matches_basis/)
    await expect(set({ state: 'expired', actualCostBasis: 'reported_usage', actualUsd: 0.01 })).rejects.toThrow(
      /state_matches_basis/,
    )
    await expect(set({ state: 'reconciled', actualUsd: 0.01 })).rejects.toThrow(/settled_has_basis/)
    // The application's own settlements satisfy all of them.
    expect(await settleShadow({ callId: i.callId, outcome: 'error', actualUsd: 0.001, costBasis: 'estimated' })).toBe(true)
  })

  it('rollback drops only these constraints; re-application is idempotent', async () => {
    await stateMigration.down(db)
    await stateMigration.down(db)
    const after = (await constraintNames()).map((r) => r.conname)
    expect(after).not.toContain('ai_budget_reservations_settled_has_basis')
    expect(after).toContain('ai_budget_reservations_basis_matches_actual') // the earlier migration's own CHECK
    await stateMigration.up(db)
    await stateMigration.up(db)
    const mine = [
      'ai_budget_reservations_open_unsettled',
      'ai_budget_reservations_settled_has_basis',
      'ai_budget_reservations_state_matches_basis',
    ]
    expect((await constraintNames()).map((r) => r.conname).filter((n) => mine.includes(n))).toEqual(mine) // each exactly once
  })
})

describe('run identity', () => {
  it('no run identity: the run scope is skipped and recorded, not a fresh per-call run', async () => {
    const d = await reserveShadow(input({ operationId: null }))
    expect(d.scopesSkipped).toContain('run')
    expect(
      await db('ai_budget_counters').where('scopeKey', 'like', `run:a${A}:%`).where('scopeKey', 'like', '%bud-%'),
    ).toHaveLength(0)
    // With a per-run limit configured, a request that cannot be attributed to a run is a would-deny.
    const strict = await reserveShadow(input({ operationId: null, policy: policy({ perRunUsd: 1 }) }))
    expect(strict.denyReasons).toEqual(['run_identity_missing'])
  })

  it('every call of one run counts toward it; a different run is isolated', async () => {
    const p = policy({ perRunUsd: 0.03 })
    const first = await reserveShadow(input({ policy: p, operationKind: 'inbox.autoResponse', operationId: 'inv-A' }))
    const retry = await reserveShadow(input({ policy: p, operationKind: 'inbox.autoResponse', operationId: 'inv-A' }))
    const other = await reserveShadow(input({ policy: p, operationKind: 'inbox.autoResponse', operationId: 'inv-B' }))
    expect([first.decision, retry.decision, other.decision]).toEqual(['would_allow', 'would_deny', 'would_allow'])
    expect(retry.denyReasons).toEqual(['run_limit'])
    const c = await counter(`run:a${A}:inbox.autoResponse:inv-A`, 'run')
    expect([c.requests, Number(c.reservedUsd)]).toEqual([2, 0.04])
  })

  it('concurrent steps of ONE run against its limit serialise: exactly the room there is', async () => {
    const p = policy({ perRunUsd: 0.05 })
    const ds = await Promise.all(
      Array.from({ length: 8 }, () =>
        reserveShadow(input({ policy: p, operationKind: 'agent_investigation', operationId: 'inv_conc' })),
      ),
    )
    expect(ds.filter((d) => d.decision === 'would_allow')).toHaveLength(2)
    expect((await counter(`run:a${A}:agent_investigation:inv_conc`, 'run')).requests).toBe(8)
  })
})

describe('recovery from the usage ledger', () => {
  const age = (callId: string) =>
    db('ai_budget_reservations')
      .where({ callId })
      .update({ reservedAt: new Date(Date.now() - 60 * 60_000) })
  const ledgerRow = (callId: string, over: Record<string, unknown> = {}) =>
    recordProviderCalls([
      {
        callId,
        invocationId: `inv-${callId}`,
        feature: 'inbox.autoResponse',
        provider: 'openai',
        requestedModel: 'gpt-4.1-mini',
        responseModel: 'gpt-4.1-mini',
        status: 'success',
        serviceTier: 'default',
        agencyId: A,
        usage: { inputTokens: 1_000, uncachedInputTokens: 1_000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 100 },
        ...over,
      },
    ])

  beforeEach(() => {
    process.env.AI_USAGE_LEDGER = '1'
  })
  afterAll(async () => {
    delete process.env.AI_USAGE_LEDGER
    await db('ai_usage_events').where({ agencyId: A }).del()
  })

  it('an unsettled reservation whose ledger row shares its callId is settled FROM that row', async () => {
    const i = input()
    await reserveShadow(i)
    await ledgerRow(i.callId)
    await age(i.callId)
    expect(await expireStaleShadowReservations(new Date(), 15)).toBeGreaterThanOrEqual(1)
    const r = await res(i.callId)
    const row = await db('ai_usage_events').where({ callId: i.callId }).first()
    expect(r).toMatchObject({
      state: 'reconciled',
      actualCostBasis: row.costBasis,
      actualCostNote: 'recovered_from_ledger',
      actualPriceVersion: row.priceVersion,
      responseModels: ['gpt-4.1-mini'],
      stepCount: 1,
    })
    expect(Number(r.actualUsd)).toBe(Number(row.costUsd))
    expect(Number((await counter(`agency:${A}`, 'day')).spentUsd)).toBe(Number(row.costUsd)) // the actual, not the estimate
    expect(await expireStaleShadowReservations(new Date(), 15)).toBe(0) // idempotent
  })

  it('a failed or unpriced ledger row recovers as failed / unknown — never as a known amount', async () => {
    const failed = input()
    const unpriced = input()
    await reserveShadow(failed)
    await reserveShadow(unpriced)
    await ledgerRow(failed.callId, { status: 'timeout', usage: null })
    await ledgerRow(unpriced.callId, { requestedModel: 'gpt-9-preview', responseModel: 'gpt-9-preview' })
    await age(failed.callId)
    await age(unpriced.callId)
    await expireStaleShadowReservations(new Date(), 15)
    expect(await res(failed.callId)).toMatchObject({ state: 'failed', actualUsd: null, actualCostBasis: 'unknown' })
    expect(await res(unpriced.callId)).toMatchObject({ state: 'unknown_cost', actualUsd: null, actualCostBasis: 'unknown' })
    expect((await res(unpriced.callId)).actualCostNote).toBe('recovered_from_ledger,unpriced_model')
    expect(Number((await res(unpriced.callId)).chargedUsd)).toBe(0.02)
  })

  it('no ledger row (ledger off, or an Agent call whose rows are per step): expired, unknown, charged its estimate', async () => {
    const i = input()
    await reserveShadow(i)
    await age(i.callId)
    await expireStaleShadowReservations(new Date(), 15)
    expect(await res(i.callId)).toMatchObject({
      state: 'expired',
      actualCostBasis: 'unknown',
      actualCostNote: 'expired_unsettled',
    })
  })
})
