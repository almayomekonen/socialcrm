import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The expiry sweep under concurrency, against a real PostgreSQL. The pattern
 * that used to deadlock: stale reservations of two agencies, interleaved, swept
 * while live reservations for both agencies take the shared counters (agency
 * windows + the global breaker). One transaction per stale row means every
 * transaction locks one reservation row and then counters in sorted order, so
 * no lock cycle can form.
 *
 * After every round the counters must equal exactly what the reservations
 * imply: reserved = Σ open estimates, spent = Σ charged, requests = count —
 * per scope, across tenants.
 */
import { db } from '@/config/db'
import { expireStaleShadowReservations, reserveShadow, type ReserveInput } from '@/db/aiBudget'
import { DEFAULT_BUDGET_POLICY } from '@/lib/ai/budget/policy'

const A = 9431
const B = 9432
let seq = 0
const input = (agencyId: number, over: Partial<ReserveInput> = {}): ReserveInput => ({
  callId: `sweep-${++seq}-${Math.random().toString(36).slice(2)}`,
  policy: { ...DEFAULT_BUDGET_POLICY, version: 'sweep-test' },
  agencyId,
  operationKind: 'inbox.autoResponse',
  operationId: `inv-${agencyId}-${seq}`,
  conversationId: null,
  contactKey: null,
  feature: 'inbox.autoResponse',
  provider: 'openai',
  model: 'gpt-5.6-sol',
  estimate: { usd: 0.0125, basis: 'partial', incomplete: true, note: null },
  now: new Date(),
  ...over,
})
const age = (callIds: string[], minutesAgo: number) =>
  db('ai_budget_reservations')
    .whereIn('callId', callIds)
    .update({ reservedAt: new Date(Date.now() - minutesAgo * 60_000) })

type Res = { state: string; estimateUsd: string; chargedUsd: string | null; scopeKeys: string[] }
type Counter = {
  scopeKey: string
  windowKind: string
  windowStart: Date
  reservedUsd: string
  spentUsd: string
  requests: number
}

/** Every counter equals what its reservations imply. Returns the number of scopes checked. */
async function expectCountersConsistent(ignoreRef = (_ref: string) => false): Promise<number> {
  const reservations = (await db('ai_budget_reservations').select('state', 'estimateUsd', 'chargedUsd', 'scopeKeys')) as Res[]
  const counters = (await db('ai_budget_counters').select()) as Counter[]
  const micro = (n: number) => Math.round(n * 1e6)
  const expected = new Map<string, { reserved: number; spent: number; requests: number }>()
  for (const r of reservations)
    for (const ref of r.scopeKeys) {
      if (ignoreRef(ref)) continue
      const e = expected.get(ref) ?? { reserved: 0, spent: 0, requests: 0 }
      if (r.state === 'reserved') e.reserved += micro(Number(r.estimateUsd))
      else e.spent += micro(Number(r.chargedUsd))
      e.requests++
      expected.set(ref, e)
    }
  for (const c of counters) {
    const ref = `${c.scopeKey}|${c.windowKind}|${new Date(c.windowStart).toISOString()}`
    expect({ ref, reserved: micro(Number(c.reservedUsd)), spent: micro(Number(c.spentUsd)), requests: c.requests }).toEqual({
      ref,
      ...(expected.get(ref) ?? { reserved: 0, spent: 0, requests: 0 }),
    })
  }
  expect(counters.length).toBe(expected.size)
  return counters.length
}

const events = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.filter((c) => c[0] === '[ai-budget]').map((c) => JSON.parse(String(c[1])) as Record<string, unknown>)

let err: ReturnType<typeof vi.spyOn>
let info: ReturnType<typeof vi.spyOn>
const wipe = async () => {
  // A clean slate: the invariant is checked over every row (the test database is isolated and serial).
  await db('ai_budget_reservations').del()
  await db('ai_budget_counters').del()
}
beforeEach(async () => {
  await wipe()
  err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
})
afterEach(() => {
  err.mockRestore()
  info.mockRestore()
})
afterAll(wipe)

describe('expiry sweep and concurrent reservations', () => {
  it('interleaved tenants swept while both reserve: no deadlock, no failure, counters exact — over several rounds', async () => {
    for (let round = 0; round < 5; round++) {
      // 20 stale reservations, alternating tenants, oldest first.
      const stale: string[] = []
      for (let i = 0; i < 20; i++) {
        const r = input(i % 2 ? A : B)
        await reserveShadow(r)
        stale.push(r.callId)
      }
      for (let i = 0; i < stale.length; i++) await age([stale[i]], 120 - i)

      // The sweep runs while 30 live reservations take the same counters (reverse tenant order).
      const live = Array.from({ length: 30 }, (_, i) => reserveShadow(input(i % 2 ? B : A)))
      const results = await Promise.allSettled([expireStaleShadowReservations(new Date(), 15), ...live])
      const rejected = results.filter((r) => r.status === 'rejected')
      expect(rejected).toEqual([])
      expect((results[0] as PromiseFulfilledResult<number>).value).toBe(20)
      expect(events(err)).toEqual([]) // no expiry_failed, no deadlock surfaced anywhere

      expect(await db('ai_budget_reservations').whereIn('callId', stale).where({ state: 'reserved' })).toHaveLength(0)
      await expectCountersConsistent()
    }
    // Tenant counters stay separate: each agency's day counter counts only its own requests.
    const day = await db('ai_budget_counters')
      .where({ windowKind: 'day' })
      .whereIn('scopeKey', [`agency:${A}`, `agency:${B}`])
    expect(day.map((c) => c.requests).sort()).toEqual([125, 125])
  })

  it('repeated sweeps are idempotent: the second settles nothing and changes no counter', async () => {
    const ids: string[] = []
    for (const a of [A, B, A]) {
      const r = input(a)
      await reserveShadow(r)
      ids.push(r.callId)
    }
    await age(ids, 60)
    expect(await expireStaleShadowReservations(new Date(), 15)).toBe(3)
    const before = await db('ai_budget_counters').orderBy(['scopeKey', 'windowKind'])
    expect(await expireStaleShadowReservations(new Date(), 15)).toBe(0)
    expect(await expireStaleShadowReservations(new Date(), 15)).toBe(0)
    expect(await db('ai_budget_counters').orderBy(['scopeKey', 'windowKind'])).toEqual(before)
    expect(events(info).map((e) => [e.evt, e.stale, e.settled, e.failed])).toEqual([['expiry_swept', 3, 3, 0]])
    await expectCountersConsistent()
  })

  it('one row that cannot be settled fails alone: it stays reserved, its counters untouched, the rest settle', async () => {
    const ids: string[] = []
    for (const a of [A, B, A, B]) {
      const r = input(a)
      await reserveShadow(r)
      ids.push(r.callId)
    }
    await age(ids, 60)
    // Corrupt one row: a scope reference that cannot be parsed makes its counter update fail mid-way.
    const bad = ids[1]
    await db.raw(
      `UPDATE ai_budget_reservations SET "scopeKeys" = array_append("scopeKeys", 'bad|day|not-a-date') WHERE "callId" = ?`,
      [bad],
    )

    expect(await expireStaleShadowReservations(new Date(), 15)).toBe(3)
    expect(await db('ai_budget_reservations').where({ callId: bad }).first('state')).toEqual({ state: 'reserved' })
    expect(await db('ai_budget_reservations').whereIn('callId', ids).whereNot({ callId: bad }).pluck('state')).toEqual([
      'expired',
      'expired',
      'expired',
    ])
    const failures = events(err)
    expect(failures).toEqual([expect.objectContaining({ evt: 'expiry_failed', callId: bad, stage: 'database' })])
    expect(JSON.stringify(err.mock.calls)).not.toContain('not-a-date') // identifiers and codes only
    expect(events(info)).toEqual([expect.objectContaining({ evt: 'expiry_swept', stale: 4, settled: 3, failed: 1 })])
    // The failed row's partial counter updates were rolled back: every counter is still exact.
    await expectCountersConsistent((ref) => ref.startsWith('bad|'))

    // The next sweep retries it (still failing here) without touching anything else.
    expect(await expireStaleShadowReservations(new Date(), 15)).toBe(0)
    await expectCountersConsistent((ref) => ref.startsWith('bad|'))
  })
})
