/**
 * The Action Runtime, end to end, with fake executors.
 *
 * WHY FAKES AND NOT REAL MUTATIONS. The runtime's job is everything AROUND the
 * mutation — identity, authority, claiming, verification, audit — and the cases
 * that matter most are the ones a real CRM service will not produce on demand:
 * an executor that throws mid-write, two callers racing on the same key, a
 * process that dies between claiming and finishing. A fake executor can be asked
 * for each of those exactly.
 *
 * The registry is EMPTY in production during this phase, so every test here
 * registers what it needs and resets afterwards. That is also the first
 * assertion: with nothing registered, nothing can run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import {
  __resetAgentActionRegistry,
  createActionRuntime,
  createInMemoryActionStore,
  parseActionProposal,
  registerAgentAction,
  type ActionActor,
  type ActionProposal,
  type ApprovalGrant,
  type ExecutionResult,
  type VerificationResult,
} from '@/lib/agent/actions'

const ACTOR: ActionActor = { agencyId: 7, userId: 3, role: 'ADMIN' }
const RUN = 'inv_test_1'
const T0 = 1_000_000
const DEADLINE = T0 + 40_000

const OK_EXEC: ExecutionResult = { status: 'SUCCESS', targetIds: [{ kind: 'task', id: '55' }] }
const OK_VERIFY: VerificationResult = {
  state: 'VERIFIED', verified: true,
  checks: [{ name: 'agencyId', ok: true }, { name: 'leadId', ok: true }],
  targetIds: [{ kind: 'task', id: '55' }],
}

function defineFake(over: Partial<Parameters<typeof registerAgentAction>[0]> = {}) {
  registerAgentAction({
    type: 'fake_write',
    argsSchema: z.object({}) as never,
    risk: 'LOW_RISK_WRITE',
    execute: async () => OK_EXEC,
    verify: async () => OK_VERIFY,
    ...over,
  })
}

function propose(args: Record<string, unknown> = { leadId: 161 }, identity: Partial<Parameters<typeof parseActionProposal>[1]> = {}) {
  const parsed = parseActionProposal(
    { actionType: 'fake_write', args, evidenceRefs: ['lead:161'], expectedPostcondition: { leadId: 161 } },
    { agentRunId: RUN, actor: ACTOR, actionId: 'act_1', ...identity },
  )
  if (parsed.ok !== true) throw new Error('fixture proposal did not parse: ' + parsed.reason)
  return parsed.proposal
}

function runtime() {
  const store = createInMemoryActionStore()
  let clock = T0
  return {
    store,
    tick: (by: number) => { clock += by },
    rt: createActionRuntime({ store, now: () => clock }),
    ctx: (over: Partial<{ grants: readonly ApprovalGrant[]; deadlineAtMs: number; authenticated: ActionActor }> = {}) => ({
      authenticated: ACTOR, deadlineAtMs: DEADLINE, grants: [], ...over,
    }),
  }
}

const grant = (over: Partial<ApprovalGrant> = {}): ApprovalGrant => ({
  agencyId: 7, actionId: 'act_1', argsHash: propose().argsHash,
  grantedByUserId: 3, grantedAtMs: T0, expiresAtMs: T0 + 600_000, decision: 'APPROVED', ...over,
})

beforeEach(() => __resetAgentActionRegistry())
afterEach(() => __resetAgentActionRegistry())

// ── 1-4 · proposal and identity ─────────────────────────────────────────────

describe('proposal parsing', () => {
  it('1 — a valid proposal parses, and the application owns every identity field', () => {
    const p = propose()
    expect(p.agencyId).toBe(7)
    expect(p.actor).toEqual(ACTOR)
    expect(p.idempotencyKey).toMatch(/^[0-9a-f]{48}$/)
    expect(p.argsHash).toMatch(/^[0-9a-f]{32}$/)
  })

  it('2 — a malformed proposal is refused, not thrown', () => {
    const r = parseActionProposal({ args: {} }, { agentRunId: RUN, actor: ACTOR, actionId: 'a' })
    expect(r).toEqual({ ok: false, reason: 'malformed-proposal' })
  })

  it('3 — a model-supplied agencyId is stripped, never honoured', () => {
    const r = parseActionProposal(
      { actionType: 'fake_write', args: { leadId: 1 }, agencyId: 999, actor: { agencyId: 999 } },
      { agentRunId: RUN, actor: ACTOR, actionId: 'a' },
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.proposal.agencyId).toBe(7)
      // The forged keys are gone from the payload entirely, so nothing downstream
      // can find them even by looking.
      expect(JSON.stringify(r.proposal.args)).not.toContain('999')
    }
  })

  it('4 — a missing actor is refused', () => {
    const r = parseActionProposal(
      { actionType: 'fake_write', args: {} },
      { agentRunId: RUN, actor: undefined as never, actionId: 'a' },
    )
    expect(r).toEqual({ ok: false, reason: 'missing-actor' })
  })
})

// ── 5-8 · approval ──────────────────────────────────────────────────────────

describe('approval', () => {
  it('5 — an approval-required action does not run without a grant', async () => {
    defineFake({ risk: 'APPROVAL_REQUIRED' })
    const exec = vi.fn(async () => OK_EXEC)
    __resetAgentActionRegistry()
    defineFake({ risk: 'APPROVAL_REQUIRED', execute: exec })
    const { rt, ctx } = runtime()
    const out = await rt.execute(propose(), ctx())
    expect(out.report).toBe('AWAITING_APPROVAL')
    expect(out.approval).toBe('PENDING')
    expect(exec).not.toHaveBeenCalled()
  })

  it('6 — a matching grant lets it run and be verified', async () => {
    defineFake({ risk: 'APPROVAL_REQUIRED' })
    const { rt, ctx } = runtime()
    const out = await rt.execute(propose(), ctx({ grants: [grant()] }))
    expect(out.approval).toBe('APPROVED')
    expect(out.report).toBe('VERIFIED_SUCCESS')
  })

  it('7 — a rejection stops it, and outranks a concurrent approval', async () => {
    defineFake({ risk: 'APPROVAL_REQUIRED' })
    const { rt, ctx } = runtime()
    const out = await rt.execute(propose(), ctx({ grants: [grant(), grant({ decision: 'REJECTED' })] }))
    expect(out.report).toBe('REJECTED')
  })

  it('8 — an expired grant is not an approval', async () => {
    defineFake({ risk: 'APPROVAL_REQUIRED' })
    const { rt, ctx } = runtime()
    const out = await rt.execute(propose(), ctx({ grants: [grant({ expiresAtMs: T0 - 1 })] }))
    expect(out.approval).toBe('EXPIRED')
    expect(out.report).toBe('NOT_EXECUTED')
  })

  it('8b — a grant for a different action cannot be spent on this one', async () => {
    defineFake({ risk: 'APPROVAL_REQUIRED' })
    const { rt, ctx } = runtime()
    const out = await rt.execute(propose(), ctx({ grants: [grant({ actionId: 'act_OTHER' })] }))
    expect(out.report).toBe('AWAITING_APPROVAL')
  })

  it('8c — a grant is void once the arguments change', async () => {
    defineFake({ risk: 'APPROVAL_REQUIRED' })
    const { rt, ctx } = runtime()
    // Approved for lead 161; the action now names lead 999 under the same id.
    const out = await rt.execute(propose({ leadId: 999 }), ctx({ grants: [grant()] }))
    expect(out.report).toBe('AWAITING_APPROVAL')
  })
})

// ── 9-10 · idempotency ──────────────────────────────────────────────────────

describe('idempotency', () => {
  it('9 — the same action submitted twice mutates once', async () => {
    const exec = vi.fn(async () => OK_EXEC)
    defineFake({ execute: exec })
    const { rt, ctx } = runtime()
    const first = await rt.execute(propose(), ctx())
    const second = await rt.execute(propose(), ctx())
    expect(first.report).toBe('VERIFIED_SUCCESS')
    expect(second.report).toBe('DUPLICATE_NOOP')
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('10 — concurrent duplicates produce exactly one execution', async () => {
    const exec = vi.fn(async () => OK_EXEC)
    defineFake({ execute: exec })
    const { rt, ctx } = runtime()
    const [a, b] = await Promise.all([rt.execute(propose(), ctx()), rt.execute(propose(), ctx())])
    expect(exec).toHaveBeenCalledTimes(1)
    expect([a.report, b.report].sort()).toEqual(['DUPLICATE_NOOP', 'VERIFIED_SUCCESS'])
    // The loser reports a live twin, not a mystery: routing a healthy race to
    // reconciliation would bury the one row that genuinely needs a human.
    const duplicate = [a, b].find((o) => o.report === 'DUPLICATE_NOOP')!
    expect(duplicate.execution.reason).toBe('in-flight-elsewhere')
    expect(duplicate.reconciliationRequired).toBe(false)
  })

  it('10b — a different argument is a different action', async () => {
    const exec = vi.fn(async () => OK_EXEC)
    defineFake({ execute: exec })
    const { rt, ctx } = runtime()
    await rt.execute(propose({ leadId: 1 }), ctx())
    await rt.execute(propose({ leadId: 2 }, { actionId: 'act_2' }), ctx())
    expect(exec).toHaveBeenCalledTimes(2)
  })

  it('10c — argument key order does not create a second action', async () => {
    const exec = vi.fn(async () => OK_EXEC)
    defineFake({ execute: exec })
    const { rt, ctx } = runtime()
    await rt.execute(propose({ a: 1, b: 2 }), ctx())
    await rt.execute(propose({ b: 2, a: 1 }), ctx())
    expect(exec).toHaveBeenCalledTimes(1)
  })
})

// ── 11-14 · execution outcomes ──────────────────────────────────────────────

describe('execution outcomes', () => {
  it('11 — a clean failure is reported as failed and never as success', async () => {
    defineFake({ execute: async () => ({ status: 'FAILED', reason: 'lead-not-found' }) })
    const { rt, ctx } = runtime()
    const out = await rt.execute(propose(), ctx())
    expect(out.report).toBe('FAILED')
    expect(out.verification).toBeNull()
    expect(out.reconciliationRequired).toBe(false)
  })

  it('12 — a retryable failure may be retried, because nothing was written', async () => {
    let attempt = 0
    defineFake({
      execute: async () => (++attempt === 1 ? { status: 'RETRYABLE_FAILURE', reason: 'db-timeout' } : OK_EXEC),
    })
    const { rt, ctx } = runtime()
    const first = await rt.execute(propose(), ctx())
    expect(first.report).toBe('FAILED')
    const second = await rt.execute(propose(), ctx())
    expect(second.report).toBe('VERIFIED_SUCCESS')
    expect(attempt).toBe(2)
  })

  it('13 — a mutation that cannot be verified is not reported as verified', async () => {
    defineFake({
      verify: async () => ({ state: 'MISMATCH', verified: false, checks: [{ name: 'dueDate', ok: false, expected: 'x', actual: 'y' }] }),
    })
    const { rt, ctx } = runtime()
    const out = await rt.execute(propose(), ctx())
    expect(out.execution.status).toBe('SUCCESS')
    expect(out.report).toBe('EXECUTED_UNVERIFIED')
    expect(out.reconciliationRequired).toBe(true)
  })

  it('14 — an executor that throws yields UNKNOWN, never FAILED and never SUCCESS', async () => {
    defineFake({ execute: async () => { throw new Error('socket hang up') } })
    const { rt, ctx, store } = runtime()
    const out = await rt.execute(propose(), ctx())
    expect(out.execution.status).toBe('UNKNOWN')
    expect(out.report).toBe('UNKNOWN_RECONCILE')
    expect(out.reconciliationRequired).toBe(true)
    expect(store.all()[0]!.executionState).toBe('UNKNOWN')
  })

  it('14b — an unresolved prior attempt is never re-executed', async () => {
    const exec = vi.fn(async () => { throw new Error('died') })
    defineFake({ execute: exec })
    const { rt, ctx } = runtime()
    await rt.execute(propose(), ctx())
    const retry = await rt.execute(propose(), ctx())
    expect(retry.report).toBe('UNKNOWN_RECONCILE')
    // The second attempt did not touch the executor: a retry here is exactly how
    // one lost response becomes two records.
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('14c — a verifier that throws leaves the action unverified, not failed', async () => {
    defineFake({ verify: async () => { throw new Error('read failed') } })
    const { rt, ctx } = runtime()
    const out = await rt.execute(propose(), ctx())
    expect(out.verification).toMatchObject({ state: 'UNVERIFIABLE', verified: false })
    expect(out.report).toBe('EXECUTED_UNVERIFIED')
  })
})

// ── 15-20 · plans, audit, isolation, deadline ───────────────────────────────

describe('plans, audit and boundaries', () => {
  it('15 — a partial batch reports partial, never success', async () => {
    let n = 0
    defineFake({ execute: async () => (++n === 2 ? { status: 'FAILED', reason: 'nope' } : OK_EXEC) })
    const { rt, ctx } = runtime()
    const actions: ActionProposal[] = [1, 2, 3].map((i) =>
      propose({ leadId: i }, { actionId: `act_${i}`, planId: 'plan_1' }),
    )
    const out = await rt.executePlan({ planId: 'plan_1', agentRunId: RUN, actions }, ctx())
    expect(out.report).toBe('PARTIAL')
    expect(out.summary).toMatchObject({ total: 3, verified: 2, failed: 1 })
  })

  it('16 — a verified action reports VERIFIED_SUCCESS with its checks', async () => {
    defineFake()
    const { rt, ctx } = runtime()
    const out = await rt.execute(propose(), ctx())
    expect(out.report).toBe('VERIFIED_SUCCESS')
    expect(out.verification?.checks).toHaveLength(2)
    expect(out.verification?.targetIds).toEqual([{ kind: 'task', id: '55' }])
  })

  it('17 — a deadline already passed stops execution before it starts', async () => {
    const exec = vi.fn(async () => OK_EXEC)
    defineFake({ execute: exec })
    const { rt, ctx } = runtime()
    const out = await rt.execute(propose(), ctx({ deadlineAtMs: T0 - 1 }))
    expect(out.report).toBe('FAILED')
    expect(out.failureReason).toBe('deadline-before-execution')
    expect(exec).not.toHaveBeenCalled()
  })

  it('18 — every attempt leaves an audit record carrying the whole lifecycle', async () => {
    defineFake()
    const { rt, ctx, store } = runtime()
    await rt.execute(propose(), ctx())
    const row = store.all()[0]!
    expect(row).toMatchObject({
      agencyId: 7, userId: 3, actionId: 'act_1', agentRunId: RUN, actionType: 'fake_write',
      risk: 'LOW_RISK_WRITE', approvalState: 'NOT_REQUIRED',
      executionState: 'SUCCEEDED', executionStatus: 'SUCCESS', verificationState: 'VERIFIED',
    })
    expect(row.args).toEqual({ leadId: 161 })
    expect(row.evidenceRefs).toEqual(['lead:161'])
    expect(row.targetIds).toEqual([{ kind: 'task', id: '55' }])
  })

  it('18b — a refused attempt is audited too', async () => {
    // Nothing registered: the action type does not exist.
    const { rt, ctx, store } = runtime()
    const out = await rt.execute(propose(), ctx())
    expect(out.execution.status).toBe('INVALID_ACTION')
    expect(store.all()).toHaveLength(1)
    expect(store.all()[0]).toMatchObject({ executionState: 'NOT_EXECUTED', executionStatus: 'INVALID_ACTION' })
  })

  it('19 — an action for another tenant is refused and audited under the real one', async () => {
    defineFake()
    const { rt, ctx, store } = runtime()
    const foreign = { ...propose(), agencyId: 999, actor: { ...ACTOR, agencyId: 999 } }
    const out = await rt.execute(foreign, ctx())
    expect(out.execution).toMatchObject({ status: 'NOT_AUTHORIZED', reason: 'agency-scope-mismatch' })
    expect(store.all()[0]!.agencyId).toBe(7)
  })

  it('19b — a different actor inside the right agency is still refused', async () => {
    defineFake()
    const { rt, ctx } = runtime()
    const impersonating = { ...propose(), actor: { ...ACTOR, userId: 4 } }
    const out = await rt.execute(impersonating, ctx())
    expect(out.execution).toMatchObject({ status: 'NOT_AUTHORIZED', reason: 'actor-mismatch' })
  })

  it('20 — a role below the risk ceiling cannot execute, whatever the model asked', async () => {
    defineFake({ risk: 'HIGH_RISK' })
    const { rt, ctx } = runtime()
    const actor = { agencyId: 7, userId: 3, role: 'AGNT' }
    const out = await rt.execute({ ...propose(), actor }, ctx({ authenticated: actor }))
    expect(out.execution).toMatchObject({ status: 'NOT_AUTHORIZED', reason: 'role-below-risk-ceiling' })
  })
})
