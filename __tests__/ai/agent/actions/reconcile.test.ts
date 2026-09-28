/**
 * Reconciliation — draining the queue of rows nobody can explain.
 *
 * The runtime deliberately refuses to guess about a row left at EXECUTING by a
 * dead process, or one an executor marked UNKNOWN. That refusal is correct and
 * it is not a resolution: without a way to settle them those rows accumulate
 * forever, and a queue nobody drains is the same as a queue nobody keeps.
 *
 * WHAT IS ASSERTED HERE is that the only input to a verdict is the CRM itself.
 * Nothing is inferred from how long the row has sat, from an executor's usual
 * success rate, or from the shape of the arguments.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { __resetAgentActionRegistry, createInMemoryActionStore, registerAgentAction } from '@/lib/agent/actions'
import { EXECUTION_LEASE_MS } from '@/lib/agent/actions/idempotency'
import { reconcileAction, requiresReconciliation } from '@/lib/agent/actions/reconcile'
import type { ActionRecord } from '@/lib/agent/actions'
import type { VerificationResult } from '@/lib/agent/actions/types'

const NOW = 5_000_000

function record(over: Partial<ActionRecord> = {}): ActionRecord {
  return {
    agencyId: 7, userId: 3, actionId: 'act_r', agentRunId: 'run_r', planId: null,
    idempotencyKey: 'key_r', actionType: 'fake', args: { leadId: 1 }, argsHash: 'h',
    risk: 'APPROVAL_REQUIRED', intent: 'AGENT_PROPOSAL', approvalState: 'APPROVED', approvedByUserId: 3,
    executionState: 'EXECUTING', executionStatus: null, verificationState: 'NOT_ATTEMPTED',
    verificationChecks: [], targetIds: [], evidenceRefs: [], retryable: null,
    failureReason: null, timingsMs: {},
    createdAtMs: NOW - EXECUTION_LEASE_MS - 1_000,
    updatedAtMs: NOW - EXECUTION_LEASE_MS - 1_000,
    ...over,
  }
}

const define = (probe?: (...args: never[]) => Promise<VerificationResult>) =>
  registerAgentAction({
    type: 'fake', argsSchema: z.object({}) as never, risk: 'APPROVAL_REQUIRED',
    execute: async () => ({ status: 'SUCCESS' }),
    verify: async () => ({ state: 'VERIFIED', verified: true, checks: [] }),
    ...(probe ? { probe: probe as never } : {}),
  })

async function seeded(row: ActionRecord) {
  const store = createInMemoryActionStore()
  await store.claim(row)
  await store.update(row.agencyId, row.idempotencyKey, row)
  return store
}

beforeEach(() => __resetAgentActionRegistry())
afterEach(() => __resetAgentActionRegistry())

describe('which rows are ambiguous at all', () => {
  it('an UNKNOWN row always is', () => {
    expect(requiresReconciliation(record({ executionState: 'UNKNOWN' }), NOW)).toBe(true)
  })

  it('an EXECUTING row is, once the lease has passed', () => {
    expect(requiresReconciliation(record(), NOW)).toBe(true)
  })

  it('a live in-flight row is NOT — that queue is for casualties', () => {
    expect(requiresReconciliation(record({ updatedAtMs: NOW - 500 }), NOW)).toBe(false)
  })

  it('a settled row never is', () => {
    for (const state of ['SUCCEEDED', 'FAILED', 'NOT_EXECUTED', 'PENDING'] as const) {
      expect(requiresReconciliation(record({ executionState: state }), NOW), state).toBe(false)
    }
  })
})

describe('the verdict comes from the CRM, or it is NEEDS_HUMAN', () => {
  it('does nothing to a row that was never ambiguous', async () => {
    define()
    const row = record({ executionState: 'SUCCEEDED' })
    const verdict = await reconcileAction(row, { store: await seeded(row), now: () => NOW })
    expect(verdict).toEqual({ kind: 'NOT_REQUIRED' })
  })

  it('settles as SUCCEEDED when the postcondition is found', async () => {
    define(async () => ({ state: 'VERIFIED', verified: true, checks: [{ name: 'title', ok: true }], targetIds: [{ kind: 'task', id: '9' }] }))
    const row = record()
    const store = await seeded(row)
    const verdict = await reconcileAction(row, { store, now: () => NOW })
    expect(verdict.kind).toBe('RESOLVED_SUCCEEDED')
    // The row leaves the queue, settled, with its target recorded.
    const after = await store.find(7, 'key_r')
    expect(after).toMatchObject({ executionState: 'SUCCEEDED', verificationState: 'VERIFIED' })
    expect(after!.targetIds).toEqual([{ kind: 'task', id: '9' }])
  })

  it('declares a retry safe only when the postcondition is provably absent', async () => {
    define(async () => ({ state: 'NOT_FOUND', verified: false, checks: [] }))
    const row = record()
    const store = await seeded(row)
    const verdict = await reconcileAction(row, { store, now: () => NOW })
    expect(verdict).toMatchObject({ kind: 'SAFE_TO_RETRY', reason: 'postcondition-absent' })
    const after = await store.find(7, 'key_r')
    // FAILED and retryable — the state the runtime will resume from.
    expect(after).toMatchObject({ executionState: 'FAILED', retryable: true })
  })

  it('sends a MISMATCH to a human — a retry would add a second wrong record', async () => {
    define(async () => ({ state: 'MISMATCH', verified: false, checks: [{ name: 'dueDate', ok: false }] }))
    const row = record()
    const store = await seeded(row)
    const verdict = await reconcileAction(row, { store, now: () => NOW })
    expect(verdict.kind).toBe('NEEDS_HUMAN')
    // Emphatically NOT moved to a resumable state.
    expect((await store.find(7, 'key_r'))!.executionState).toBe('EXECUTING')
  })

  it('sends an unreadable CRM to a human rather than guessing', async () => {
    define(async () => ({ state: 'UNVERIFIABLE', verified: false, checks: [] }))
    const row = record()
    const verdict = await reconcileAction(row, { store: await seeded(row), now: () => NOW })
    expect(verdict.kind).toBe('NEEDS_HUMAN')
  })

  it('a probe that throws is NEEDS_HUMAN, never a retry', async () => {
    define(async () => { throw new Error('db down') })
    const row = record()
    const store = await seeded(row)
    const verdict = await reconcileAction(row, { store, now: () => NOW })
    expect(verdict).toMatchObject({ kind: 'NEEDS_HUMAN', reason: 'probe-threw' })
    expect((await store.find(7, 'key_r'))!.executionState).toBe('EXECUTING')
  })

  it('an action type with no probe is NEEDS_HUMAN — the absence is the answer', async () => {
    define() // no probe
    const row = record()
    const verdict = await reconcileAction(row, { store: await seeded(row), now: () => NOW })
    expect(verdict).toMatchObject({ kind: 'NEEDS_HUMAN', reason: 'no-probe-for-action-type' })
  })

  it('an unregistered action type is NEEDS_HUMAN', async () => {
    const row = record()
    const verdict = await reconcileAction(row, { store: await seeded(row), now: () => NOW })
    expect(verdict).toMatchObject({ kind: 'NEEDS_HUMAN', reason: 'unknown-action-type' })
  })

  it('records its conclusion, so the next pass does not repeat the work', async () => {
    define(async () => ({ state: 'UNVERIFIABLE', verified: false, checks: [] }))
    const row = record()
    const store = await seeded(row)
    await reconcileAction(row, { store, now: () => NOW })
    expect((await store.find(7, 'key_r'))!.failureReason).toBe('reconcile:probe-unverifiable')
  })
})

describe('create_task deliberately has no probe', () => {
  it('so a crashed task creation is never auto-resolved', async () => {
    const { createTaskAction } = await import('@/lib/agent/actions/domain/createTask')
    /**
     * A probe would have to match on lead + title + date and hope no rep created
     * a similar task in the same window. That heuristic resolves some rows right
     * and others silently wrong, and a wrongly-resolved row either hides a task
     * that was never created or adopts one a person made by hand.
     */
    expect(createTaskAction.probe).toBeUndefined()
  })
})
