import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Two SERVER INSTANCES against one database — the case the in-memory guard
 * (lib/ai/router/spend.ts) cannot handle and the durable budget exists for.
 *
 * `vi.resetModules()` loads a second, fully independent copy of `@/config/db`
 * and `@/db/aiBudget`: its own knex pool, its own connections, its own module
 * state — what a second Vercel instance is. Both race reservations for the same
 * agency; the counters must be exact and the would-allow count must be what one
 * shared limit allows, whichever instance asked. Shadow only: nothing here can
 * block a provider call.
 */
import { db } from '@/config/db'
import { reserveShadow, settleShadow, type ReserveInput } from '@/db/aiBudget'
import { DEFAULT_BUDGET_POLICY, type BudgetPolicy } from '@/lib/ai/budget/policy'

type Store = { reserveShadow: typeof reserveShadow; settleShadow: typeof settleShadow; db: typeof db }

const A = 9403
const B = 9404
const NOW = new Date('2026-10-30T10:15:00Z')
let seq = 0
let other: Store

const policy = (over: Partial<BudgetPolicy> = {}): BudgetPolicy => ({ ...DEFAULT_BUDGET_POLICY, version: 'test-x', ...over })
const input = (over: Partial<ReserveInput> = {}): ReserveInput => ({
  callId: `xi-${++seq}-${Math.random()}`,
  policy: policy(),
  agencyId: A,
  operationKind: 'wa_assistant_job',
  operationId: `xi-job-${seq}`,
  conversationId: null,
  contactKey: null,
  feature: 'agent.investigate',
  provider: 'openai',
  model: 'gpt-5.6',
  estimate: { usd: 0.02, basis: 'bounded', incomplete: false, note: null },
  now: NOW,
  ...over,
})
const counter = (key: string, kind: string) => db('ai_budget_counters').where({ scopeKey: key, windowKind: kind }).first()

async function clean() {
  await db('ai_budget_reservations').whereIn('agencyId', [A, B]).del()
  await db('ai_budget_counters')
    .whereIn('scopeKey', [`agency:${A}`, `agency:${B}`])
    .orWhere('scopeKey', 'like', 'run:a940%')
    .del()
}

beforeAll(async () => {
  vi.resetModules()
  const [dbMod, storeMod] = await Promise.all([import('@/config/db'), import('@/db/aiBudget')])
  other = { db: dbMod.db, reserveShadow: storeMod.reserveShadow, settleShadow: storeMod.settleShadow }
})
beforeEach(clean)
afterAll(async () => {
  await clean()
  await other.db.destroy()
})

describe('two server instances, one agency limit', () => {
  it('the second instance is a separate pool, not the same object', () => {
    expect(other.db).not.toBe(db)
    expect(other.reserveShadow).not.toBe(reserveShadow)
  })

  it('20 concurrent reservations split across both instances: exact counters, and exactly the limit allowed', async () => {
    const p = policy({ agencyDailyUsd: 0.1 }) // five $0.02 requests fit
    const calls = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? reserveShadow : other.reserveShadow)(input({ policy: p })))
    const decisions = await Promise.all(calls)
    expect(decisions.filter((d) => d.decision === 'would_allow')).toHaveLength(5)
    const c = await counter(`agency:${A}`, 'day')
    expect(c.requests).toBe(20)
    expect(Number(c.reservedUsd)).toBeCloseTo(0.4, 6) // shadow reserves every request; none was blocked
  })

  it('a reservation made on one instance and settled on the other is accounted once', async () => {
    const i = input()
    await reserveShadow(i)
    expect(
      await other.settleShadow({ callId: i.callId, outcome: 'success', actualUsd: 0.015, costBasis: 'reported_usage' }),
    ).toBe(true)
    expect(await settleShadow({ callId: i.callId, outcome: 'success', actualUsd: 0.015, costBasis: 'reported_usage' })).toBe(
      false,
    )
    const c = await counter(`agency:${A}`, 'day')
    expect(Number(c.spentUsd)).toBeCloseTo(0.015, 6)
    expect(Number(c.reservedUsd)).toBeCloseTo(0, 6)
  })

  it('the same callId reserved on both instances counts once', async () => {
    const i = input()
    await Promise.all([reserveShadow(i), other.reserveShadow(i)])
    expect((await counter(`agency:${A}`, 'day')).requests).toBe(1)
    expect(await db('ai_budget_reservations').where({ callId: i.callId }).count<{ count: string }>('* as count').first()).toEqual(
      { count: '1' },
    )
  })

  it('one agency filling its limit from both instances never touches another agency', async () => {
    const p = policy({ agencyDailyUsd: 0.04 })
    await Promise.all(Array.from({ length: 6 }, (_, k) => (k % 2 ? reserveShadow : other.reserveShadow)(input({ policy: p }))))
    const b = await other.reserveShadow(input({ policy: p, agencyId: B }))
    expect(b.decision).toBe('would_allow')
    expect((await counter(`agency:${B}`, 'day')).requests).toBe(1)
  })
})
