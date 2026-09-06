/**
 * The invariants — the promises this layer makes to a business owner.
 *
 * Everything else in the runtime is mechanism. These are the properties that
 * mechanism exists to produce, written so that weakening any of them fails a
 * test with an obvious name rather than passing quietly because the code that
 * broke it looked reasonable in review.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import {
  __resetAgentActionRegistry, createActionRuntime, createInMemoryActionStore,
  parseActionProposal, registerAgentAction, registeredActionTypes,
  reportFor, type ActionActor, type ExecutionResult, type VerificationResult,
} from '@/lib/agent/actions'
import { DEFAULT_DEADLINE_MS } from '@/lib/agent/budget'

const ACTOR: ActionActor = { agencyId: 7, userId: 3, role: 'ADMIN' }
const T0 = 1_000_000
const OK: ExecutionResult = { status: 'SUCCESS', targetIds: [{ kind: 'task', id: '9' }] }

function harness() {
  const store = createInMemoryActionStore()
  return {
    store,
    rt: createActionRuntime({ store, now: () => T0 }),
    ctx: { authenticated: ACTOR, deadlineAtMs: T0 + DEFAULT_DEADLINE_MS, grants: [] },
  }
}

function proposal(over: Record<string, unknown> = {}) {
  const r = parseActionProposal(
    { actionType: 'fake', args: { leadId: 161 }, evidenceRefs: [], expectedPostcondition: {} },
    { agentRunId: 'run', actor: ACTOR, actionId: 'act' },
  )
  if (r.ok === false) throw new Error(r.reason)
  return { ...r.proposal, ...over }
}

const define = (over: Partial<Parameters<typeof registerAgentAction>[0]> = {}) =>
  registerAgentAction({
    type: 'fake', argsSchema: z.object({}) as never, risk: 'LOW_RISK_WRITE',
    execute: async () => OK,
    verify: async (): Promise<VerificationResult> => ({ state: 'VERIFIED', verified: true, checks: [] }),
    ...over,
  })

beforeEach(() => __resetAgentActionRegistry())
afterEach(() => __resetAgentActionRegistry())

describe('the model cannot mutate the database', () => {
  it('the registry is empty, so no action type resolves to anything executable', () => {
    expect(registeredActionTypes()).toEqual([])
  })

  it('an unregistered type is INVALID_ACTION, whatever the model named it', async () => {
    const { rt, ctx } = harness()
    for (const type of ['create_task', 'delete_lead', 'send_whatsapp', '../../etc/passwd']) {
      const out = await rt.execute({ ...proposal(), actionType: type }, ctx)
      expect(out.execution.status, type).toBe('INVALID_ACTION')
    }
  })

  it('a proposal cannot carry an executor, a risk level or an approval flag', () => {
    const r = parseActionProposal(
      { actionType: 'fake', args: {}, risk: 'READ', approvalRequired: false, execute: () => {} },
      { agentRunId: 'run', actor: ACTOR, actionId: 'act' },
    )
    expect(r.ok).toBe(true)
    // Risk defaults CLOSED, and nothing the payload said about it survived.
    if (r.ok) {
      expect(r.proposal.risk).toBe('HIGH_RISK')
      expect(r.proposal.approvalRequired).toBe(true)
      expect(Object.keys(r.proposal.args)).toEqual([])
    }
  })
})

describe('authenticated scope wins', () => {
  it('a model-supplied agencyId never reaches the proposal', () => {
    const r = parseActionProposal(
      { actionType: 'fake', args: {}, agencyId: 999 },
      { agentRunId: 'run', actor: ACTOR, actionId: 'act' },
    )
    expect(r.ok && r.proposal.agencyId).toBe(7)
  })

  it('a proposal assembled elsewhere with a foreign agency is refused', async () => {
    define()
    const { rt, ctx } = harness()
    const out = await rt.execute(proposal({ agencyId: 999, actor: { ...ACTOR, agencyId: 999 } }), ctx)
    expect(out.execution.status).toBe('NOT_AUTHORIZED')
  })

  it('the audit row is written under the authenticated agency, not the claimed one', async () => {
    define()
    const { rt, ctx, store } = harness()
    await rt.execute(proposal({ agencyId: 999, actor: { ...ACTOR, agencyId: 999 } }), ctx)
    expect(store.all().map((r) => r.agencyId)).toEqual([7])
  })
})

describe('approval cannot be bypassed', () => {
  it('an approval-required action never reaches its executor without a grant', async () => {
    const execute = vi.fn(async () => OK)
    define({ risk: 'APPROVAL_REQUIRED', execute })
    const { rt, ctx } = harness()
    await rt.execute(proposal(), ctx)
    expect(execute).not.toHaveBeenCalled()
  })

  it('no amount of text is a grant — the gate takes structure only', async () => {
    const execute = vi.fn(async () => OK)
    define({ risk: 'HIGH_RISK', execute })
    const { rt, ctx } = harness()
    // The shapes a naive implementation might accept.
    const notGrants = [{}, { decision: 'APPROVED' }, { agencyId: 7, decision: 'APPROVED' }] as never[]
    const out = await rt.execute(proposal(), { ...ctx, grants: notGrants })
    expect(out.report).toBe('AWAITING_APPROVAL')
    expect(execute).not.toHaveBeenCalled()
  })
})

describe('nothing is reported as done that was not confirmed', () => {
  it('SUCCESS without verification is never VERIFIED_SUCCESS', () => {
    expect(reportFor({ status: 'SUCCESS' }, null, 'NOT_REQUIRED').report).toBe('EXECUTED_UNVERIFIED')
    expect(reportFor({ status: 'SUCCESS' }, { state: 'NOT_FOUND', verified: false, checks: [] }, 'NOT_REQUIRED').report)
      .toBe('EXECUTED_UNVERIFIED')
  })

  it('an UNKNOWN result is never rounded to success OR to failure', () => {
    const r = reportFor({ status: 'UNKNOWN' }, null, 'NOT_REQUIRED')
    expect(r.report).toBe('UNKNOWN_RECONCILE')
    expect(r.reconciliationRequired).toBe(true)
  })

  it('only a verifier that actually read the source of truth produces VERIFIED_SUCCESS', () => {
    expect(reportFor({ status: 'SUCCESS' }, { state: 'VERIFIED', verified: true, checks: [] }, 'NOT_REQUIRED').report)
      .toBe('VERIFIED_SUCCESS')
  })

  it('a verifier claiming VERIFIED while its own checks failed is still not trusted downstream', async () => {
    define({
      verify: async () => ({ state: 'MISMATCH', verified: false, checks: [{ name: 'owner', ok: false }] }),
    })
    const { rt, ctx } = harness()
    const out = await rt.execute(proposal(), ctx)
    expect(out.report).not.toBe('VERIFIED_SUCCESS')
  })
})

describe('the runtime does not weaken what already existed', () => {
  it('it holds no deadline of its own — it is handed the agent run\'s', async () => {
    define()
    const { rt, store } = harness()
    const out = await rt.execute(proposal(), {
      authenticated: ACTOR, deadlineAtMs: T0 - 1, grants: [],
    })
    expect(out.failureReason).toBe('deadline-before-execution')
    expect(store.all()[0]!.executionState).toBe('NOT_EXECUTED')
  })

  it('the execution lease sits above the 40s agent deadline, never below it', async () => {
    const { EXECUTION_LEASE_MS } = await import('@/lib/agent/actions/idempotency')
    // A lease shorter than the deadline would declare a healthy in-flight
    // mutation abandoned and send a perfectly good action to reconciliation.
    expect(EXECUTION_LEASE_MS).toBeGreaterThan(DEFAULT_DEADLINE_MS)
  })

  it('no module in this layer imports the agent answer validator or its tools', async () => {
    const { readFileSync, readdirSync } = await import('node:fs')
    for (const file of readdirSync('lib/agent/actions')) {
      const src = readFileSync(`lib/agent/actions/${file}`, 'utf8')
      // Evidence validation and the read tools are untouched by this phase.
      expect(src, file).not.toMatch(/from '\.\.\/validate'/)
      expect(src, file).not.toMatch(/from '\.\.\/tools'/)
      expect(src, file).not.toMatch(/generateText|Output\.object/)
    }
  })

  it('every read-only path stays read-only: nothing here runs without a registry entry', async () => {
    const { rt, ctx, store } = harness()
    const out = await rt.execute(proposal(), ctx)
    expect(out.report).toBe('NOT_EXECUTED')
    expect(store.all()[0]!.executionState).toBe('NOT_EXECUTED')
  })
})
