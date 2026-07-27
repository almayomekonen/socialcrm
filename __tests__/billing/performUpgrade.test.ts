/**
 * Model B — prepaid renewal period math (Phase 2). Verifies performAgencyUpgrade
 * issues the ATOMIC `GREATEST(now, existing)+interval` upsert with the correct
 * 30/365-day params, and documents the algorithm with a pure oracle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// db is unused (a `q` is passed), but the module imports it.
vi.mock('@/config/db', () => ({ db: {} }))

import { performAgencyUpgrade } from '@/lib/quota/performUpgrade'

/** Pure oracle mirroring the SQL: new expiry = max(now, current) + days. */
const DAY = 86_400_000
function nextExpiry(now: number, current: number | null, days: number): number {
  const base = current === null ? now : Math.max(now, current)
  return base + days * DAY
}

// Chainable knex mock: q('t').where().update()/first(); q.raw captured.
function makeQ() {
  const rawCalls: Array<{ sql: string; bindings: unknown[] }> = []
  const qb = {
    where: () => qb,
    first: async () => ({ id: 1 }), // agency exists
    update: async () => 1,
  }
  const q: any = () => qb
  q.raw = vi.fn(async (sql: string, bindings: unknown[]) => {
    rawCalls.push({ sql, bindings })
    return { rows: [] }
  })
  q._rawCalls = rawCalls
  return q
}

let q: ReturnType<typeof makeQ>
beforeEach(() => {
  q = makeQ()
})

describe('performAgencyUpgrade — atomic prepaid renewal SQL', () => {
  it('issues the GREATEST upsert; monthly → 30-day param', async () => {
    const res = await performAgencyUpgrade(1, 'grow:tx', q as never, 'monthly')
    expect(res).toEqual({ success: true })
    expect(q.raw).toHaveBeenCalledTimes(1)
    const { sql, bindings } = q._rawCalls[0]
    expect(sql).toMatch(/ON CONFLICT \("agencyId"\)/)
    expect(sql).toMatch(/GREATEST\(now\(\), subscriptions\."expiresAt"\)/)
    expect(sql).toMatch(/\|\| ' days'\)::interval/)
    // params: [agencyId, days, period, days]
    expect(bindings).toEqual([1, 30, 'monthly', 30])
  })

  it('annual → 365-day param', async () => {
    await performAgencyUpgrade(1, 'grow:tx', q as never, 'annual')
    expect(q._rawCalls[0].bindings).toEqual([1, 365, 'annual', 365])
  })

  it('returns not_found and does not upsert when agency is missing', async () => {
    const q2: any = () => ({ where: () => ({ first: async () => undefined }) })
    q2.raw = vi.fn()
    const res = await performAgencyUpgrade(999, 'grow:tx', q2 as never, 'monthly')
    expect(res).toEqual({ error: 'not_found' })
    expect(q2.raw).not.toHaveBeenCalled()
  })
})

describe('renewal period algorithm (oracle the SQL implements)', () => {
  const now = Date.parse('2026-08-18T00:00:00Z')
  it('10. renew BEFORE expiry (monthly) → current expiry + 30 days', () => {
    const cur = Date.parse('2026-08-20T00:00:00Z')
    expect(nextExpiry(now, cur, 30)).toBe(Date.parse('2026-09-19T00:00:00Z'))
  })
  it('11. renew AFTER expiry (monthly) → now + 30 days', () => {
    const cur = Date.parse('2026-08-10T00:00:00Z')
    expect(nextExpiry(now, cur, 30)).toBe(Date.parse('2026-09-17T00:00:00Z'))
  })
  it('12. annual renewal → +365 days from base', () => {
    const cur = Date.parse('2026-08-20T00:00:00Z')
    expect(nextExpiry(now, cur, 365)).toBe(cur + 365 * DAY)
  })
  it('13. period switch monthly→annual preserves remaining time + 365', () => {
    const cur = Date.parse('2026-08-20T00:00:00Z') // still active
    expect(nextExpiry(now, cur, 365)).toBe(cur + 365 * DAY)
  })
  it('first payment (no current) → now + days', () => {
    expect(nextExpiry(now, null, 30)).toBe(now + 30 * DAY)
  })
})
