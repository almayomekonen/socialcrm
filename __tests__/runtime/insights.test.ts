/**
 * Phase 4.4 — the insight lifecycle, against real PostgreSQL.
 *
 * Every invariant here is a STORAGE invariant: the open-unique index, the
 * terminal-reason CHECK, the fact that a terminal row never reopens, and — the
 * one that justifies the whole table — that reading a NOTIFICATION cannot
 * release an insight's deduplication.
 *
 * Runs under `test:runtime` (serialized).
 */
import { afterAll, beforeEach, describe, it, expect } from 'vitest'
import { db } from '@/config/db'
import {
  createInsight,
  closeInsight,
  markDelivered,
  deliveredCountForDay,
  listOpenInsights,
  listUndelivered,
  readInsights,
  insightKeyFor,
} from '@/db/ai/insights'

const AGENCY = 9901
const OTHER = 9902
const NOW = new Date('2026-08-25T10:00:00.000Z')
/**
 * The day `markDelivered` actually stamps.
 *
 * It writes `db.fn.now()`, so a hardcoded date silently stops matching the moment
 * the calendar moves past it — which is exactly what happened to these tests
 * overnight. The cap is a UTC-calendar-day concept, so the test asks the same
 * clock the code does.
 */
const TODAY_UTC = new Date().toISOString().slice(0, 10)

afterAll(async () => {
  await db.destroy()
})

beforeEach(async () => {
  await db('ai_insights').del()
  await db('notifications').del()
})

let seq = 0
const input = (over: Partial<Parameters<typeof createInsight>[0]> = {}) => ({
  agencyId: AGENCY,
  subjectId: '100',
  expectation: 'cadence.break',
  investigationId: `inv_${++seq}`,
  operatorUserId: 42,
  headline: 'הליד שקט מעבר לקצב הרגיל',
  claims: [{ claimClass: 'FACT' as const, text: 'f', entityEvidence: ['100'] }],
  evidence: [{ kind: 'lead' as const, refId: '100' }],
  reasoningChain: [{ key: 'agent.claim.0' }],
  decisionTrace: [{ boundary: 'value', passed: true, detail: 'cleared' }],
  ...over,
})

// ───────────── C1/C2 · dedup identity ─────────────

describe('C1 · one open conclusion per subject per expectation', () => {
  it('a second conclusion supersedes rather than duplicating', async () => {
    const a = await createInsight(input())
    expect(a.created).toBe(true)
    const b = await createInsight(input())
    expect(b.created).toBe(true)

    const rows = await readInsights(AGENCY)
    expect(rows).toHaveLength(2)
    const open = rows.filter((r) => r.status === 'open')
    expect(open).toHaveLength(1)
    const superseded = rows.find((r) => r.status === 'superseded')!
    expect(superseded.resolvedReason).toBe('superseded')
    expect(superseded.supersededById).toBe(open[0]!.id)
  })

  it('the storage index — not application code — is what forbids two open rows', async () => {
    const first = await createInsight(input())
    const id = (first as { row: { id: number } }).row.id
    await expect(
      db.raw(
        `INSERT INTO ai_insights ("agencyId","insightKey","subjectType","subjectId",expectation,
           "investigationId","operatorUserId",headline,claims,evidence,"reasoningChain","decisionTrace",status)
         VALUES (?,?,'lead','100','cadence.break','inv_x',42,'h','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'open')`,
        [AGENCY, insightKeyFor({ subjectType: 'lead', subjectId: '100', expectation: 'cadence.break' })],
      ),
    ).rejects.toThrow()
    expect(id).toBeGreaterThan(0)
  })

  it('C2 · the key contains only business identity, never conclusion text', () => {
    const k = insightKeyFor({ subjectType: 'lead', subjectId: '100', expectation: 'cadence.break' })
    expect(k).toBe('lead:100:cadence.break')
    // A different conclusion about the same fact produces the SAME key, so a
    // reworded headline can never become a "new" insight.
    expect(insightKeyFor({ subjectType: 'lead', subjectId: '100', expectation: 'cadence.break' })).toBe(k)
  })

  it('different subjects and expectations do not collide', async () => {
    await createInsight(input())
    await createInsight(input({ subjectId: '200' }))
    await createInsight(input({ expectation: 'other.expectation' }))
    expect((await readInsights(AGENCY)).filter((r) => r.status === 'open')).toHaveLength(3)
  })

  it('one investigation produces at most one insight, however often it is replayed', async () => {
    const a = await createInsight(input({ investigationId: 'inv_fixed' }))
    expect(a.created).toBe(true)
    const b = await createInsight(input({ investigationId: 'inv_fixed' }))
    expect(b).toEqual({ created: false, reason: 'duplicate_investigation' })
    expect(await readInsights(AGENCY)).toHaveLength(1)
  })
})

// ───────────── C3 · reading must not release dedup ─────────────

describe('C3 · reading a notification never releases insight dedup', () => {
  it('an insight stays open and keyed no matter what the bell says', async () => {
    const created = await createInsight(input())
    const id = (created as { row: { id: number } }).row.id
    await markDelivered(id, 555)

    // Simulate the rep reading every notification that exists.
    await db('notifications').update({ readAt: NOW, seenAt: NOW })

    const after = (await readInsights(AGENCY))[0]!
    expect(after.status).toBe('open')
    expect(after.deliveredAt).not.toBeNull()

    // And the key is still held: a re-conclusion supersedes rather than adding.
    await createInsight(input())
    expect((await readInsights(AGENCY)).filter((r) => r.status === 'open')).toHaveLength(1)
  })
})

// ───────────── delivery is a separate axis ─────────────

describe('delivery never defines insight truth', () => {
  it('markDelivered touches the delivery axis only', async () => {
    const created = await createInsight(input())
    const id = (created as { row: { id: number } }).row.id
    await markDelivered(id, 777)
    const row = (await readInsights(AGENCY))[0]!
    expect(row.status).toBe('open')
    expect(row.notificationJobId).toBe(777)
    expect(row.resolvedReason).toBeNull()
  })

  it('a failed delivery (null job id) still leaves the insight open', async () => {
    const created = await createInsight(input())
    const id = (created as { row: { id: number } }).row.id
    await markDelivered(id, null)
    const row = (await readInsights(AGENCY))[0]!
    expect(row.status).toBe('open')
    expect(row.notificationJobId).toBeNull()
  })

  it('delivery is recorded once; a retry does not double-count the cap', async () => {
    const created = await createInsight(input())
    const id = (created as { row: { id: number } }).row.id
    expect(await markDelivered(id, 1)).toBe(true)
    expect(await markDelivered(id, 2)).toBe(false)
    expect(await deliveredCountForDay(AGENCY, TODAY_UTC)).toBe(1)
  })
})

// ───────────── terminal states never reopen ─────────────

describe('terminal states are terminal', () => {
  for (const [status, reason] of [
    ['resolved', 'business_state'],
    ['expired', 'expired'],
    ['superseded', 'superseded'],
  ] as const) {
    it(`${status} never reopens and never re-closes`, async () => {
      const created = await createInsight(input())
      const id = (created as { row: { id: number } }).row.id
      expect(await closeInsight(id, status, reason)).toBe(true)
      // Idempotent: a repeated sweep is a no-op, not a second transition.
      expect(await closeInsight(id, 'resolved', 'business_state')).toBe(false)
      const row = (await readInsights(AGENCY))[0]!
      expect(row.status).toBe(status)
      expect(row.resolvedReason).toBe(reason)
      expect(row.closedAt).not.toBeNull()
    })
  }

  it('closing frees the key so a genuinely new conclusion can open', async () => {
    const created = await createInsight(input())
    await closeInsight((created as { row: { id: number } }).row.id, 'resolved', 'business_state')
    const next = await createInsight(input())
    expect(next.created).toBe(true)
    expect((next as { supersededId: number | null }).supersededId).toBeNull()
  })

  it('the CHECK forbids an open row claiming a resolution reason', async () => {
    await expect(
      db.raw(
        `INSERT INTO ai_insights ("agencyId","insightKey","subjectType","subjectId",expectation,
           "investigationId","operatorUserId",headline,claims,evidence,"reasoningChain","decisionTrace",status,"resolvedReason")
         VALUES (?,'k','lead','1','e','inv_z',1,'h','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'open','business_state')`,
        [AGENCY],
      ),
    ).rejects.toThrow()
  })
})

// ───────────── C15 · evidence is permanent ─────────────

describe('C15 · evidence and reasoning survive intact', () => {
  it('round-trips claims, evidence, reasoning chain and decision trace', async () => {
    await createInsight(input())
    const row = (await readInsights(AGENCY))[0]!
    expect(row.claims).toEqual([{ claimClass: 'FACT', text: 'f', entityEvidence: ['100'] }])
    expect(row.evidence).toEqual([{ kind: 'lead', refId: '100' }])
    expect(row.reasoningChain).toEqual([{ key: 'agent.claim.0' }])
    expect(row.decisionTrace).toEqual([{ boundary: 'value', passed: true, detail: 'cleared' }])
  })

  it('survives being closed — the audit outlives the conclusion', async () => {
    const created = await createInsight(input())
    await closeInsight((created as { row: { id: number } }).row.id, 'resolved', 'business_state')
    const row = (await readInsights(AGENCY))[0]!
    expect(row.evidence).toHaveLength(1)
    expect(row.reasoningChain).toHaveLength(1)
  })
})

// ───────────── cap accounting + isolation ─────────────

describe('the daily cap counts the right things', () => {
  it('the day boundary is UTC, not the database session timezone', async () => {
    // Regression: the DB session runs Asia/Jerusalem, so a bare `?::date` against
    // a timestamptz resolved at LOCAL midnight and the window drifted by the
    // offset. A row stamped now() must always land in now()'s own UTC day.
    const a = await createInsight(input())
    await markDelivered((a as { row: { id: number } }).row.id, 1)
    const utcToday = new Date().toISOString().slice(0, 10)
    expect(await deliveredCountForDay(AGENCY, utcToday)).toBe(1)
    const yesterday = new Date(Date.parse(utcToday) - 86_400_000).toISOString().slice(0, 10)
    expect(await deliveredCountForDay(AGENCY, yesterday)).toBe(0)
  })

  it('counts only delivered insights, per agency, per UTC day', async () => {
    const a = await createInsight(input({ investigationId: 'i1' }))
    await markDelivered((a as { row: { id: number } }).row.id, 1)
    await createInsight(input({ subjectId: '200', investigationId: 'i2' })) // undelivered

    expect(await deliveredCountForDay(AGENCY, TODAY_UTC)).toBe(1)
    const tomorrowUtc = new Date(Date.parse(TODAY_UTC) + 86_400_000).toISOString().slice(0, 10)
    expect(await deliveredCountForDay(AGENCY, tomorrowUtc)).toBe(0)
    expect(await deliveredCountForDay(OTHER, TODAY_UTC)).toBe(0)
  })

  it('an undelivered insight stays open and listable for a later attempt', async () => {
    await createInsight(input())
    const pending = await listUndelivered(AGENCY)
    expect(pending).toHaveLength(1)
    expect(pending[0]!.status).toBe('open')
    expect(pending[0]!.deliveredAt).toBeNull()
  })

  it('agency isolation holds across every read', async () => {
    await createInsight(input({ agencyId: AGENCY }))
    await createInsight(input({ agencyId: OTHER, investigationId: 'inv_other' }))
    expect(await readInsights(AGENCY)).toHaveLength(1)
    expect(await readInsights(OTHER)).toHaveLength(1)
    expect((await listOpenInsights()).length).toBe(2)
  })
})
