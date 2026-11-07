/**
 * Reconciliation settles through a GUARDED write (store.updateIf): a verdict
 * about a row that changed after it was read is never written (architecture
 * v1.6 §2, RC-E2/RC-E4). In-memory store; the Postgres updateIf is covered by
 * the reminder actions DB test.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { __resetAgentActionRegistry, createInMemoryActionStore, registerAgentAction } from '@/lib/agent/actions'
import { EXECUTION_LEASE_MS } from '@/lib/agent/actions/idempotency'
import { reconcileAction } from '@/lib/agent/actions/reconcile'
import type { ActionRecord } from '@/lib/agent/actions'

const NOW = 9_000_000
const stale = NOW - EXECUTION_LEASE_MS - 1_000

const record = (over: Partial<ActionRecord> = {}): ActionRecord => ({
  agencyId: 7, userId: 3, actionId: 'rem_1_v1_create', agentRunId: 'run', planId: null,
  idempotencyKey: 'rem_1_v1_create', actionType: 'fake', args: {}, argsHash: 'h',
  risk: 'LOW_RISK_WRITE', intent: 'AGENT_PROPOSAL', approvalState: 'APPROVED', approvedByUserId: 3,
  executionState: 'EXECUTING', executionStatus: null, verificationState: 'NOT_ATTEMPTED',
  verificationChecks: [], targetIds: [], evidenceRefs: [], retryable: null, failureReason: null, timingsMs: {},
  createdAtMs: stale, updatedAtMs: stale, ...over,
})

beforeEach(() => {
  __resetAgentActionRegistry()
  registerAgentAction({
    type: 'fake', argsSchema: z.object({}) as never, risk: 'LOW_RISK_WRITE',
    execute: async () => ({ status: 'SUCCESS' }),
    verify: async () => ({ state: 'VERIFIED', verified: true, checks: [] }),
    probe: async () => ({ state: 'NOT_FOUND', verified: false, checks: [] }),
  })
})
afterEach(() => __resetAgentActionRegistry())

async function seeded(row: ActionRecord) {
  const store = createInMemoryActionStore()
  await store.claim(row)
  await store.update(row.agencyId, row.idempotencyKey, row)
  return store
}

describe('updateIf', () => {
  it('writes only when the state and timestamp still match', async () => {
    const row = record()
    const store = await seeded(row)
    expect(await store.updateIf(7, row.idempotencyKey, { executionState: 'EXECUTING', updatedAtMs: stale + 1 }, { failureReason: 'x' })).toBe(false)
    expect(await store.updateIf(7, row.idempotencyKey, { executionState: 'FAILED', updatedAtMs: stale }, { failureReason: 'x' })).toBe(false)
    expect(await store.updateIf(7, row.idempotencyKey, { executionState: 'EXECUTING', updatedAtMs: stale }, { failureReason: 'x', updatedAtMs: NOW })).toBe(true)
    expect((await store.find(7, row.idempotencyKey))?.failureReason).toBe('x')
  })
})

describe('a verdict about a row that moved on is not written', () => {
  it('RC-E4: the row changed after it was read → NOT_REQUIRED, row untouched', async () => {
    const read = record()
    const store = await seeded(read)
    // Meanwhile a late executor finished: the row is SUCCEEDED now.
    await store.update(7, read.idempotencyKey, { executionState: 'SUCCEEDED', updatedAtMs: NOW - 10 })
    expect(await reconcileAction(read, { store, now: () => NOW })).toEqual({ kind: 'NOT_REQUIRED' })
    expect((await store.find(7, read.idempotencyKey))?.executionState).toBe('SUCCEEDED')
  })

  it('RC-E2: two reconciles of the same read → one writes, the other finds nothing to do', async () => {
    const read = record()
    const store = await seeded(read)
    const [a, b] = await Promise.all([reconcileAction(read, { store, now: () => NOW }), reconcileAction(read, { store, now: () => NOW })])
    expect([a.kind, b.kind].sort()).toEqual(['NOT_REQUIRED', 'SAFE_TO_RETRY'])
    expect((await store.find(7, read.idempotencyKey))?.executionState).toBe('FAILED')
  })

  it('an unchanged row is settled exactly as before', async () => {
    const read = record()
    const store = await seeded(read)
    expect((await reconcileAction(read, { store, now: () => NOW })).kind).toBe('SAFE_TO_RETRY')
    expect(await store.find(7, read.idempotencyKey)).toMatchObject({ executionState: 'FAILED', retryable: true })
  })
})
