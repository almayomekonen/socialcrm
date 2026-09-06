/**
 * The durable claim, against a real Postgres.
 *
 * WHY THIS CANNOT BE A MOCK TEST. The entire idempotency guarantee is one SQL
 * statement's atomicity — `INSERT … ON CONFLICT DO NOTHING RETURNING *` — and a
 * mocked query builder will happily accept any clause at all, including one with
 * the conflict target removed. The two properties asserted here are the ones a
 * fake store cannot prove: that concurrent duplicates collapse to one row, and
 * that the collapse is per-tenant rather than global.
 *
 * Runs against the test database the suite already builds from the baseline.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import {
  AGENT_ACTIONS_TABLE, agentActionsQuery, claimQuery, createDbActionStore,
  toActionRecord, toRow, updateQuery,
} from '@/db/agentActions'
import type { ActionRecord } from '@/lib/agent/actions'

const AGENCY_A = 90_001
const AGENCY_B = 90_002

function record(over: Partial<ActionRecord> = {}): ActionRecord {
  return {
    agencyId: AGENCY_A, userId: 5, actionId: 'act_sql_1', agentRunId: 'run_sql', planId: null,
    idempotencyKey: 'key_sql_1', actionType: 'fake_write', args: { leadId: 161 }, argsHash: 'h1',
    risk: 'LOW_RISK_WRITE', intent: 'EXPLICIT_COMMAND', approvalState: 'NOT_REQUIRED', approvedByUserId: null,
    executionState: 'PENDING', executionStatus: null, verificationState: 'NOT_ATTEMPTED',
    verificationChecks: [], targetIds: [], evidenceRefs: ['lead:161'], retryable: null,
    failureReason: null, timingsMs: {}, createdAtMs: Date.now(), updatedAtMs: Date.now(),
    ...over,
  }
}

afterEach(async () => {
  await db(AGENT_ACTIONS_TABLE).whereIn('agencyId', [AGENCY_A, AGENCY_B]).del()
})

describe('the claim statement', () => {
  it('is an ON CONFLICT DO NOTHING on the tenant-scoped key', () => {
    const sql = claimQuery(record()).toString().toLowerCase()
    expect(sql).toContain('on conflict')
    expect(sql).toContain('do nothing')
    expect(sql).toMatch(/"agencyid"\s*,\s*"idempotencykey"/)
    // Without RETURNING there is no way to tell who won the race.
    expect(sql).toContain('returning')
  })

  it('scopes every update by agency — a key is not a capability', () => {
    const sql = updateQuery(AGENCY_A, 'key_sql_1', { executionState: 'SUCCEEDED' }).toString().toLowerCase()
    expect(sql).toMatch(/"agencyid"\s*=/)
    expect(sql).toMatch(/"idempotencykey"\s*=/)
  })

  it('never lets identity be rewritten after the claim', () => {
    const sql = updateQuery(AGENCY_A, 'k', {
      executionState: 'SUCCEEDED', agencyId: 999, actionType: 'other', argsHash: 'x',
    } as Partial<ActionRecord>).toString().toLowerCase()
    expect(sql).not.toContain('set "agencyid"')
    expect(sql).not.toContain('"actiontype" =')
    expect(sql).not.toContain('"argshash" =')
  })
})

describe('claiming for real', () => {
  it('collapses concurrent duplicates to exactly one row', async () => {
    const store = createDbActionStore()
    const results = await Promise.all([
      store.claim(record()), store.claim(record()), store.claim(record()), store.claim(record()),
    ])
    expect(results.filter((r) => r.claimed).length).toBe(1)
    expect(results.filter((r) => !r.claimed).length).toBe(3)
    const rows = await db(AGENT_ACTIONS_TABLE).where({ agencyId: AGENCY_A })
    expect(rows).toHaveLength(1)
  })

  it('hands the losers the row that already exists', async () => {
    const store = createDbActionStore()
    await store.claim(record())
    const second = await store.claim(record({ actionId: 'act_sql_DIFFERENT' }))
    expect(second.claimed).toBe(false)
    if (second.claimed === false) {
      // The durable identity is the FIRST claim's, not the retry's.
      expect(second.existing.actionId).toBe('act_sql_1')
      expect(second.existing.args).toEqual({ leadId: 161 })
    }
  })

  it('does not collide across tenants deriving the same key', async () => {
    const store = createDbActionStore()
    const a = await store.claim(record({ agencyId: AGENCY_A }))
    const b = await store.claim(record({ agencyId: AGENCY_B, actionId: 'act_sql_b' }))
    expect(a.claimed).toBe(true)
    expect(b.claimed).toBe(true)
  })

  it('cannot read another tenant\'s row, even with its exact key', async () => {
    const store = createDbActionStore()
    await store.claim(record({ agencyId: AGENCY_A }))
    expect(await store.find(AGENCY_B, 'key_sql_1')).toBeNull()
  })

  it('cannot update another tenant\'s row with its exact key', async () => {
    const store = createDbActionStore()
    await store.claim(record({ agencyId: AGENCY_A }))
    await store.update(AGENCY_B, 'key_sql_1', { executionState: 'SUCCEEDED' })
    const untouched = await store.find(AGENCY_A, 'key_sql_1')
    expect(untouched!.executionState).toBe('PENDING')
  })
})

describe('the row survives the round trip', () => {
  it('preserves every field the audit needs', async () => {
    const store = createDbActionStore()
    const original = record({
      targetIds: [{ kind: 'task', id: '55' }],
      verificationChecks: [{ name: 'agencyId', ok: true, expected: 7, actual: 7 }],
      timingsMs: { executionMs: 12 },
    })
    await store.claim(original)
    const read = await store.find(AGENCY_A, 'key_sql_1')
    expect(read).toMatchObject({
      agencyId: AGENCY_A, userId: 5, actionId: 'act_sql_1', agentRunId: 'run_sql',
      actionType: 'fake_write', risk: 'LOW_RISK_WRITE', executionState: 'PENDING',
      args: { leadId: 161 }, evidenceRefs: ['lead:161'],
      targetIds: [{ kind: 'task', id: '55' }],
      verificationChecks: [{ name: 'agencyId', ok: true, expected: 7, actual: 7 }],
      timingsMs: { executionMs: 12 },
    })
  })

  it('records the full lifecycle after an update', async () => {
    const store = createDbActionStore()
    await store.claim(record())
    await store.update(AGENCY_A, 'key_sql_1', {
      approvalState: 'APPROVED', approvedByUserId: 5, executionState: 'SUCCEEDED',
      executionStatus: 'SUCCESS', verificationState: 'VERIFIED',
      targetIds: [{ kind: 'task', id: '77' }], updatedAtMs: Date.now(),
    })
    const read = await store.find(AGENCY_A, 'key_sql_1')
    expect(read).toMatchObject({
      approvalState: 'APPROVED', approvedByUserId: 5, executionState: 'SUCCEEDED',
      executionStatus: 'SUCCESS', verificationState: 'VERIFIED',
      targetIds: [{ kind: 'task', id: '77' }],
    })
  })

  it('maps a row back to exactly what was written', () => {
    const original = record()
    const round = toActionRecord(toRow(original) as never)
    expect(round.args).toEqual(original.args)
    expect(round.evidenceRefs).toEqual(original.evidenceRefs)
    expect(round.actionType).toBe(original.actionType)
  })
})

describe('the audit read', () => {
  it('is agency-scoped and bounded', () => {
    const sql = agentActionsQuery({ agencyId: AGENCY_A, agentRunId: 'run_sql' }).toString().toLowerCase()
    expect(sql).toMatch(/"agencyid"\s*=/)
    expect(sql).toMatch(/"agentrunid"\s*=/)
    expect(sql).toMatch(/limit\s+\d+/)
  })

  it('clamps a caller asking for everything', () => {
    expect(agentActionsQuery({ agencyId: AGENCY_A, limit: 10_000 }).toString()).toContain('limit 200')
  })
})
