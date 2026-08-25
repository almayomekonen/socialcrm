/**
 * Phase 4.2 — the durable spend ledger, against real PostgreSQL.
 *
 * Every guarantee here is a STORAGE guarantee, so asserting it against a mock
 * would prove nothing at all: the concurrency bound IS a partial unique index,
 * the durability IS a row, and the expiry IS a timestamp comparison. These tests
 * run two genuine concurrent transactions, restart the module, and let the
 * database enforce what the design claims it enforces.
 *
 * Runs under `test:runtime` (serialized, `fileParallelism: false`).
 */
import { afterAll, beforeEach, describe, it, expect } from 'vitest'
import knex from 'knex'
import { db } from '@/config/db'
import {
  reserve,
  settle,
  release,
  releaseExpired,
  dailyTotalUsd,
  lastReservationForSubject,
  readReservations,
  budgetDay,
  autonomousMaxCostUsd,
  autonomousDailyCapUsd,
  AUTONOMOUS_KIND,
} from '@/db/ai/spendReservations'

const AGENCY = 8801
const OTHER_AGENCY = 8802
const NOW = new Date('2026-08-25T10:00:00.000Z')
const LEASE_MS = 5 * 60 * 1000
/** The same database the suite is already pointed at, opened independently. */
const TEST_DB_URL = (() => {
  const u = new URL(process.env.DATABASE_URL ?? '')
  u.searchParams.delete('sslmode')
  return u.toString()
})()

afterAll(async () => {
  await db.destroy()
})

/** Configure the budget for a test. Absence is the fail-closed default. */
function budget(maxCost: string | undefined, dailyCap: string | undefined) {
  if (maxCost === undefined) delete process.env.AUTONOMOUS_MAX_COST_USD
  else process.env.AUTONOMOUS_MAX_COST_USD = maxCost
  if (dailyCap === undefined) delete process.env.AI_AUTONOMOUS_DAILY_USD_CAP
  else process.env.AI_AUTONOMOUS_DAILY_USD_CAP = dailyCap
}

const input = (over: Partial<Parameters<typeof reserve>[0]> = {}) => ({
  agencyId: AGENCY,
  signalJobId: 1,
  observationKey: 'followup.overdue:lead:100:at:2026-08-24',
  subjectType: 'lead' as const,
  subjectId: '100',
  operatorUserId: 42,
  expiresAt: new Date(NOW.getTime() + LEASE_MS),
  now: NOW,
  ...over,
})

beforeEach(async () => {
  await db('ai_spend_reservations').del()
  budget('0.50', '2.00')
})

// ───────────────────────── I2 · durability ──────────────────────────────────

describe('I2 · durability', () => {
  it('a reservation is a row, readable by a different module instance', async () => {
    const r = await reserve(input())
    expect(r.reserved).toBe(true)

    // The durability claim is that the hold lives in PostgreSQL, not in this
    // process. Proving it with a re-import would only prove the module cache was
    // busted; proving it with an INDEPENDENT connection — a different pool, no
    // shared JavaScript state, exactly what a fresh lambda gets — proves the
    // actual thing. A module-scope Map is invisible from here by construction.
    const other = knex({ client: 'pg', connection: { connectionString: TEST_DB_URL, ssl: false }, pool: { min: 0, max: 2 } })
    try {
      const seen = await other('ai_spend_reservations').where({ agencyId: AGENCY }).first()
      expect(seen).toBeTruthy()
      expect(Number(seen!.reservedUsd)).toBeCloseTo(0.5, 6)
      expect(seen!.status).toBe('reserved')
      expect(await dailyTotalUsd(AGENCY, budgetDay(NOW))).toBeCloseTo(0.5, 6)
    } finally {
      await other.destroy()
    }

    const rows = await readReservations(AGENCY)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('reserved')
    expect(rows[0]!.operatorUserId).toBe(42)
  })

  it('is fail-closed when the budget is unconfigured', async () => {
    budget(undefined, undefined)
    expect(autonomousMaxCostUsd()).toBe(0)
    expect(autonomousDailyCapUsd()).toBe(0)
    expect(await reserve(input())).toEqual({ reserved: false, reason: 'unconfigured' })

    budget('0.50', undefined)
    expect(await reserve(input())).toEqual({ reserved: false, reason: 'unconfigured' })

    budget(undefined, '2.00')
    expect(await reserve(input())).toEqual({ reserved: false, reason: 'unconfigured' })

    budget('not-a-number', 'nonsense')
    expect(await reserve(input())).toEqual({ reserved: false, reason: 'unconfigured' })
    expect(await db('ai_spend_reservations').count()).toEqual([{ count: '0' }])
  })
})

// ───────────────────── I1 · concurrency (the real thing) ────────────────────

describe('I1 · concurrency — exactly one reservation per agency', () => {
  it('two SIMULTANEOUS attempts on one agency: one wins, one is slot_busy', async () => {
    const [a, b] = await Promise.all([
      reserve(input({ signalJobId: 1, subjectId: '100' })),
      reserve(input({ signalJobId: 2, subjectId: '200' })),
    ])
    const winners = [a, b].filter((r) => r.reserved)
    const losers = [a, b].filter((r) => !r.reserved)
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expect(losers[0]).toEqual({ reserved: false, reason: 'slot_busy' })
    expect(await db('ai_spend_reservations').where({ status: 'reserved' }).count()).toEqual([{ count: '1' }])
  })

  it('ten simultaneous attempts still land exactly one row', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => reserve(input({ signalJobId: i + 1, subjectId: String(i + 1) }))),
    )
    expect(results.filter((r) => r.reserved)).toHaveLength(1)
    expect(results.filter((r) => r.reserved === false && r.reason === 'slot_busy')).toHaveLength(9)
  })

  it('a different agency is never blocked by this one', async () => {
    const mine = await reserve(input())
    expect(mine.reserved).toBe(true)
    const theirs = await reserve(input({ agencyId: OTHER_AGENCY, signalJobId: 9 }))
    expect(theirs.reserved).toBe(true)
  })

  it('the slot frees the moment the hold closes', async () => {
    const first = await reserve(input())
    expect(first.reserved).toBe(true)
    expect((await reserve(input({ signalJobId: 2 }))).reserved).toBe(false)

    await settle((first as { row: { id: number } }).row.id, 0, 'no_investigator')
    const second = await reserve(input({ signalJobId: 2 }))
    expect(second.reserved).toBe(true)
  })
})

// ─────────────────── I3 · no orphan survives lease expiry ───────────────────

describe('I3 · expiry — a killed lambda strands nothing', () => {
  it('releaseExpired reclaims a hold past its lease and frees the slot', async () => {
    const held = await reserve(input({ expiresAt: new Date(NOW.getTime() + 1000) }))
    expect(held.reserved).toBe(true)

    // Nothing expires before its time.
    expect(await releaseExpired(new Date(NOW.getTime() + 500))).toBe(0)
    expect((await reserve(input({ signalJobId: 2 }))).reserved).toBe(false)

    // Past the lease, the hold is reclaimed and the slot reopens.
    expect(await releaseExpired(new Date(NOW.getTime() + 2000))).toBe(1)
    const rows = await readReservations(AGENCY)
    expect(rows[0]!.status).toBe('released')
    expect(rows[0]!.declineReason).toBe('lease-expired-reclaimed')
    expect((await reserve(input({ signalJobId: 2 }))).reserved).toBe(true)
  })

  it('an expired hold costs the agency nothing', async () => {
    await reserve(input({ expiresAt: new Date(NOW.getTime() + 1000) }))
    await releaseExpired(new Date(NOW.getTime() + 2000))
    expect(await dailyTotalUsd(AGENCY, budgetDay(NOW))).toBe(0)
  })
})

// ─────────────────── I4 · refund · I5 · released costs zero ─────────────────

describe('I4 · settlement refunds, I5 · release costs nothing', () => {
  it('settling below the hold refunds the difference', async () => {
    const held = await reserve(input())
    expect(await dailyTotalUsd(AGENCY, budgetDay(NOW))).toBeCloseTo(0.5, 6)

    await settle((held as { row: { id: number } }).row.id, 0.02, 'admitted')
    expect(await dailyTotalUsd(AGENCY, budgetDay(NOW))).toBeCloseTo(0.02, 6)
  })

  it('Phase 4.2 settles at exactly zero', async () => {
    const held = await reserve(input())
    await settle((held as { row: { id: number } }).row.id, 0, 'no_investigator')
    expect(await dailyTotalUsd(AGENCY, budgetDay(NOW))).toBe(0)
    const rows = await readReservations(AGENCY)
    expect(rows[0]!.spentUsd).toBe(0)
    expect(rows[0]!.outcome).toBe('no_investigator')
  })

  it('a released hold counts zero forever', async () => {
    const held = await reserve(input())
    await release((held as { row: { id: number } }).row.id, 'precondition')
    expect(await dailyTotalUsd(AGENCY, budgetDay(NOW))).toBe(0)
    expect((await readReservations(AGENCY))[0]!.status).toBe('released')
  })

  it('the daily cap is enforced across sequential reservations', async () => {
    budget('0.50', '1.00')
    for (let i = 0; i < 2; i++) {
      const r = await reserve(input({ signalJobId: i + 1 }))
      expect(r.reserved).toBe(true)
      await settle((r as { row: { id: number } }).row.id, 0.5, 'admitted')
    }
    // 1.00 spent against a 1.00 cap — the next hold would exceed it.
    expect(await reserve(input({ signalJobId: 3 }))).toEqual({ reserved: false, reason: 'daily_cap' })
  })

  it('yesterday does not consume today', async () => {
    const held = await reserve(input())
    await settle((held as { row: { id: number } }).row.id, 0.5, 'admitted')
    const tomorrow = new Date(NOW.getTime() + 24 * 3600 * 1000)
    expect(await dailyTotalUsd(AGENCY, budgetDay(tomorrow))).toBe(0)
    expect((await reserve(input({ signalJobId: 2, now: tomorrow }))).reserved).toBe(true)
  })
})

// ───────────────────────── I8 · agency isolation ────────────────────────────

describe('I8 · agency isolation', () => {
  it('one agency never reads or spends another budget', async () => {
    const a = await reserve(input({ agencyId: AGENCY }))
    await settle((a as { row: { id: number } }).row.id, 0.4, 'admitted')
    const b = await reserve(input({ agencyId: OTHER_AGENCY, signalJobId: 9 }))
    await settle((b as { row: { id: number } }).row.id, 0.1, 'admitted')

    expect(await dailyTotalUsd(AGENCY, budgetDay(NOW))).toBeCloseTo(0.4, 6)
    expect(await dailyTotalUsd(OTHER_AGENCY, budgetDay(NOW))).toBeCloseTo(0.1, 6)
    expect(await readReservations(AGENCY)).toHaveLength(1)
    expect(await readReservations(OTHER_AGENCY)).toHaveLength(1)
  })

  it('the refractory lookup is agency-scoped', async () => {
    await reserve(input({ agencyId: OTHER_AGENCY, subjectId: '100' }))
    expect(await lastReservationForSubject({ agencyId: AGENCY, subjectType: 'lead', subjectId: '100' })).toBeNull()
    expect(await lastReservationForSubject({ agencyId: OTHER_AGENCY, subjectType: 'lead', subjectId: '100' })).not.toBeNull()
  })
})

// ───────────────────────── storage-level invariants ─────────────────────────

describe('the schema enforces what the design claims', () => {
  it('the partial unique index exists and covers only reserved rows', async () => {
    const res = await db.raw(`SELECT indexdef FROM pg_indexes WHERE indexname = 'ai_spend_open_uniq'`)
    const def = String(res.rows?.[0]?.indexdef ?? '')
    expect(def).toMatch(/UNIQUE/i)
    expect(def).toMatch(/agencyId/)
    expect(def).toMatch(/WHERE \(status = 'reserved'/i)
  })

  it('a settled row must carry its spend; a reserved row must not', async () => {
    await expect(
      db.raw(
        `INSERT INTO ai_spend_reservations ("agencyId", kind, "dateUtc", "signalJobId", "observationKey",
           "subjectType", "subjectId", "reservedUsd", status, "expiresAt")
         VALUES (?, ?, CURRENT_DATE, 1, 'k', 'lead', '1', 0.5, 'settled', now())`,
        [AGENCY, AUTONOMOUS_KIND],
      ),
    ).rejects.toThrow()
  })

  it('an unknown kind cannot be stored', async () => {
    await expect(
      db.raw(
        `INSERT INTO ai_spend_reservations ("agencyId", kind, "dateUtc", "signalJobId", "observationKey",
           "subjectType", "subjectId", "reservedUsd", "expiresAt")
         VALUES (?, 'marketing_blast', CURRENT_DATE, 1, 'k', 'lead', '1', 0.5, now())`,
        [AGENCY],
      ),
    ).rejects.toThrow()
  })
})
