/**
 * The first vertical slice, against a real database.
 *
 * WHAT THIS PROVES THAT THE FAKE-EXECUTOR SUITE CANNOT. The runtime tests use a
 * fake executor because they are about the runtime; this file uses the REAL
 * `create_task` against real `clients` and `tasks` rows, because the questions
 * it answers are about the seam: does the tenant check actually hold when the
 * task table has no agency column of its own, does the verifier really read the
 * row back, and does an approved action produce a task a person could find.
 *
 * THE TENANT PROPERTY IS THE ONE WORTH THE DATABASE. `tasks` carries no
 * `agencyId` — a task's tenant IS its lead's, through `tasks."clientId" →
 * clients."agencyId"`. That is exactly the kind of invariant a mock cannot check
 * and a join can, so the cross-agency cases here are executed rather than
 * simulated.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { createDbActionStore, findActionByActionId } from '@/db/agentActions'
import { recordApprovalDecision } from '@/db/agentActionApprovals'
import {
  __resetAgentActionRegistry, createActionRuntime, parseActionProposal,
  type ActionActor, type ActionOutcome, type ApprovalGrant,
} from '@/lib/agent/actions'
import { registerDomainActions } from '@/lib/agent/actions/domain'
import { loadApprovalGrants } from '@/db/agentActionApprovals'

const AGENCY_A = 91_001
const AGENCY_B = 91_002
const USER_A = 91_101
const USER_B = 91_102
let LEAD_A = 0
let LEAD_B = 0

const actorA: ActionActor = { agencyId: AGENCY_A, userId: USER_A, role: 'ADMIN' }
const actorB: ActionActor = { agencyId: AGENCY_B, userId: USER_B, role: 'ADMIN' }

const DEADLINE = () => Date.now() + 40_000
const runtime = () => createActionRuntime({ store: createDbActionStore() })

async function seedAgency(id: number, userId: number): Promise<number> {
  // Cast: the generated Agency type is narrower than the table's NOT NULL set.
  await db('agencies').insert({
    id, name: `eval-${id}`, plan: 'pro', country: 'IL', defaultCurrency: 'ILS',
    locale: 'he', docNumberFormat: '{n}', bankDetails: '{}',
  } as never).onConflict('id').ignore()
  await db('users').insert({ id: userId, agencyId: id, email: `u${userId}@t.test`, role: 'ADMIN', firstName: 'נציג', lastName: String(userId) })
    .onConflict('id').ignore()
  const [lead] = await db('clients').insert({
    firstName: 'בדיקה', lastName: String(id), agencyId: id, createdById: userId,
  }).returning('id')
  return typeof lead === 'object' ? (lead as { id: number }).id : (lead as number)
}

/** A proposal exactly as the bridge builds one, with a fresh action id. */
function propose(args: Record<string, unknown>, actor: ActionActor, actionId = `act_${Math.random().toString(36).slice(2)}`) {
  const parsed = parseActionProposal(
    { actionType: 'create_task', args, evidenceRefs: [`lead:${args.clientId}`], expectedPostcondition: args },
    { agentRunId: 'run_int', actor, actionId },
  )
  if (parsed.ok === false) throw new Error('fixture did not parse: ' + parsed.reason)
  return parsed.proposal
}

const okArgs = (clientId: number) => ({ clientId, title: 'להתקשר לדניאל', dueDate: '2026-09-07' })

/** Approve an action the way the server action does, then run it again. */
async function approveAndRun(outcome: ActionOutcome, actor: ActionActor, decision: 'APPROVED' | 'REJECTED' = 'APPROVED') {
  const record = await findActionByActionId(actor.agencyId, outcome.actionId)
  if (!record) throw new Error('no action row to approve')
  await recordApprovalDecision({
    agencyId: record.agencyId, actionId: record.actionId, argsHash: record.argsHash,
    decision, decidedByUserId: actor.userId,
  })
  const grants = await loadApprovalGrants({ agencyId: record.agencyId, actionId: record.actionId })
  return runtime().execute(
    { ...propose(record.args, actor, record.actionId), idempotencyKey: record.idempotencyKey },
    { authenticated: actor, deadlineAtMs: DEADLINE(), grants },
  )
}

beforeAll(async () => {
  __resetAgentActionRegistry()
  registerDomainActions()
  LEAD_A = await seedAgency(AGENCY_A, USER_A)
  LEAD_B = await seedAgency(AGENCY_B, USER_B)
})

afterEach(async () => {
  await db('tasks').whereIn('clientId', [LEAD_A, LEAD_B]).del()
  await db('agent_action_approvals').whereIn('agencyId', [AGENCY_A, AGENCY_B]).del()
  await db('agent_actions').whereIn('agencyId', [AGENCY_A, AGENCY_B]).del()
})

afterAll(async () => {
  await db('clients').whereIn('id', [LEAD_A, LEAD_B]).del()
  await db('users').whereIn('id', [USER_A, USER_B]).del()
  await db('agencies').whereIn('id', [AGENCY_A, AGENCY_B]).del()
  __resetAgentActionRegistry()
})

// ── 1-5 · proposal, identity, tenancy ───────────────────────────────────────

describe('the proposal boundary', () => {
  it('1 — a proposed create_task is registered and awaits approval', async () => {
    const out = await runtime().execute(propose(okArgs(LEAD_A), actorA), {
      authenticated: actorA, deadlineAtMs: DEADLINE(), grants: [],
    })
    expect(out.report).toBe('AWAITING_APPROVAL')
    expect(out.actionType).toBe('create_task')
    // Nothing was written to the CRM.
    expect(await db('tasks').where({ clientId: LEAD_A })).toHaveLength(0)
  })

  it('2 — a malformed proposal never becomes an action', () => {
    const r = parseActionProposal({ args: { clientId: LEAD_A } }, { agentRunId: 'r', actor: actorA, actionId: 'a' })
    expect(r).toEqual({ ok: false, reason: 'malformed-proposal' })
  })

  it('3 — a forged agencyId is stripped before the runtime sees it', async () => {
    const r = parseActionProposal(
      { actionType: 'create_task', args: okArgs(LEAD_A), agencyId: AGENCY_B },
      { agentRunId: 'r', actor: actorA, actionId: 'act_forged' },
    )
    expect(r.ok && r.proposal.agencyId).toBe(AGENCY_A)
  })

  it('4 — a task against another tenant\'s lead is refused at execution', async () => {
    // Agency A, approved, but the lead belongs to agency B. `tasks` has no
    // agency column, so this is the check that keeps it from being misfiled.
    const first = await runtime().execute(propose(okArgs(LEAD_B), actorA), {
      authenticated: actorA, deadlineAtMs: DEADLINE(), grants: [],
    })
    const out = await approveAndRun(first, actorA)
    expect(out.execution).toMatchObject({ status: 'NOT_AUTHORIZED', reason: 'lead-not-in-agency' })
    expect(await db('tasks').where({ clientId: LEAD_B })).toHaveLength(0)
  })

  it('5 — a missing actor is refused', () => {
    const r = parseActionProposal(
      { actionType: 'create_task', args: okArgs(LEAD_A) },
      { agentRunId: 'r', actor: undefined as never, actionId: 'a' },
    )
    expect(r).toEqual({ ok: false, reason: 'missing-actor' })
  })
})

// ── 6-10 · approval ─────────────────────────────────────────────────────────

describe('approval governs the write', () => {
  it('6 — an agent-initiated create_task requires approval', async () => {
    const out = await runtime().execute(propose(okArgs(LEAD_A), actorA), {
      authenticated: actorA, deadlineAtMs: DEADLINE(), grants: [],
    })
    expect(out.approval).toBe('PENDING')
    expect(await db('tasks').where({ clientId: LEAD_A })).toHaveLength(0)
  })

  it('7 — approval for the exact arguments creates the task', async () => {
    const first = await runtime().execute(propose(okArgs(LEAD_A), actorA), {
      authenticated: actorA, deadlineAtMs: DEADLINE(), grants: [],
    })
    const out = await approveAndRun(first, actorA)
    expect(out.report).toBe('VERIFIED_SUCCESS')
    const rows = await db('tasks').where({ clientId: LEAD_A })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: 'להתקשר לדניאל', userId: USER_A })
  })

  it('8 — a grant does not authorise different arguments', async () => {
    // The approval is real, from a real approver, and still does not apply: it
    // is bound to the hash of what was shown, and the title changed.
    const shown = propose(okArgs(LEAD_A), actorA)
    const grant: ApprovalGrant = {
      agencyId: AGENCY_A, actionId: 'act_edited', argsHash: shown.argsHash,
      grantedByUserId: USER_A, grantedAtMs: Date.now(), expiresAtMs: Date.now() + 600_000, decision: 'APPROVED',
    }
    const edited = propose({ ...okArgs(LEAD_A), title: 'משהו אחר לגמרי' }, actorA, 'act_edited')
    const out = await runtime().execute(edited, { authenticated: actorA, deadlineAtMs: DEADLINE(), grants: [grant] })
    expect(out.report).toBe('AWAITING_APPROVAL')
    expect(await db('tasks').where({ clientId: LEAD_A })).toHaveLength(0)
  })

  it('8b — reusing one action id for different arguments is refused outright', async () => {
    /**
     * The stronger form of the same protection, and a case a real database
     * surfaced: different arguments derive a different idempotency key, so the
     * claim misses the key conflict and hits the action-id index instead.
     * Treating that as a retry would let an approval slot be re-pointed at
     * arguments nobody approved.
     */
    await runtime().execute(propose(okArgs(LEAD_A), actorA, 'act_reused'), {
      authenticated: actorA, deadlineAtMs: DEADLINE(), grants: [],
    })
    const out = await runtime().execute(propose({ ...okArgs(LEAD_A), title: 'כותרת אחרת' }, actorA, 'act_reused'), {
      authenticated: actorA, deadlineAtMs: DEADLINE(), grants: [],
    })
    expect(out.execution).toMatchObject({ status: 'INVALID_ACTION', reason: 'action-id-reused' })
    expect(await db('tasks').where({ clientId: LEAD_A })).toHaveLength(0)
  })

  it('9 — a rejected action executes nothing', async () => {
    const first = await runtime().execute(propose(okArgs(LEAD_A), actorA), {
      authenticated: actorA, deadlineAtMs: DEADLINE(), grants: [],
    })
    const out = await approveAndRun(first, actorA, 'REJECTED')
    expect(out.report).toBe('REJECTED')
    expect(await db('tasks').where({ clientId: LEAD_A })).toHaveLength(0)
  })

  it('10 — an expired approval executes nothing', async () => {
    const proposal = propose(okArgs(LEAD_A), actorA)
    await runtime().execute(proposal, { authenticated: actorA, deadlineAtMs: DEADLINE(), grants: [] })
    const expired: ApprovalGrant = {
      agencyId: AGENCY_A, actionId: proposal.actionId, argsHash: proposal.argsHash,
      grantedByUserId: USER_A, grantedAtMs: Date.now() - 3_600_000,
      expiresAtMs: Date.now() - 1, decision: 'APPROVED',
    }
    const out = await runtime().execute(proposal, { authenticated: actorA, deadlineAtMs: DEADLINE(), grants: [expired] })
    expect(out.approval).toBe('EXPIRED')
    expect(await db('tasks').where({ clientId: LEAD_A })).toHaveLength(0)
  })
})

// ── 11-15 · duplicates and failure modes ────────────────────────────────────

describe('duplicates and failures', () => {
  it('11 — an approved action submitted twice creates one task', async () => {
    const first = await runtime().execute(propose(okArgs(LEAD_A), actorA), {
      authenticated: actorA, deadlineAtMs: DEADLINE(), grants: [],
    })
    const a = await approveAndRun(first, actorA)
    const b = await approveAndRun(first, actorA)
    expect(a.report).toBe('VERIFIED_SUCCESS')
    expect(b.report).toBe('DUPLICATE_NOOP')
    expect(await db('tasks').where({ clientId: LEAD_A })).toHaveLength(1)
  })

  it('12 — concurrent approved duplicates create one task', async () => {
    const first = await runtime().execute(propose(okArgs(LEAD_A), actorA), {
      authenticated: actorA, deadlineAtMs: DEADLINE(), grants: [],
    })
    const record = await findActionByActionId(AGENCY_A, first.actionId)
    await recordApprovalDecision({
      agencyId: AGENCY_A, actionId: record!.actionId, argsHash: record!.argsHash,
      decision: 'APPROVED', decidedByUserId: USER_A,
    })
    const grants = await loadApprovalGrants({ agencyId: AGENCY_A, actionId: record!.actionId })
    const run = () =>
      runtime().execute(
        { ...propose(record!.args, actorA, record!.actionId), idempotencyKey: record!.idempotencyKey },
        { authenticated: actorA, deadlineAtMs: DEADLINE(), grants },
      )
    await Promise.all([run(), run(), run()])
    expect(await db('tasks').where({ clientId: LEAD_A })).toHaveLength(1)
  })

  it('13 — an executor refusal is recorded and creates nothing', async () => {
    // A lead id that exists nowhere: the executor's tenant read finds no row.
    const first = await runtime().execute(propose({ ...okArgs(LEAD_A), clientId: 99_999_999 }, actorA), {
      authenticated: actorA, deadlineAtMs: DEADLINE(), grants: [],
    })
    const out = await approveAndRun(first, actorA)
    expect(out.execution.status).toBe('NOT_AUTHORIZED')
    const row = await findActionByActionId(AGENCY_A, out.actionId)
    expect(row).toMatchObject({ executionState: 'FAILED', executionStatus: 'NOT_AUTHORIZED' })
  })

  it('14 — a verifier that finds the wrong row reports MISMATCH, not success', async () => {
    const { createTaskAction } = await import('@/lib/agent/actions/domain/createTask')
    const proposal = propose(okArgs(LEAD_A), actorA)
    const verification = await createTaskAction.verify(
      // The action asked for one title; the task in the database has another.
      { ...proposal, args: { ...proposal.args, title: 'כותרת אחרת' } },
      { status: 'SUCCESS', targetIds: [{ kind: 'task', id: String(await seedTask()) }] },
      { actor: actorA, deadlineAtMs: DEADLINE(), nowMs: Date.now() },
    )
    expect(verification.verified).toBe(false)
    expect(verification.state).toBe('MISMATCH')
    expect(verification.checks.find((c) => c.name === 'title')?.ok).toBe(false)
  })

  it('15 — a task in another agency verifies as NOT_FOUND, never as success', async () => {
    const { createTaskAction } = await import('@/lib/agent/actions/domain/createTask')
    const [taskId] = await db('tasks')
      .insert({ clientId: LEAD_B, title: 'של סוכנות אחרת', userId: USER_B, dueDate: '2026-09-07', tasks: [], notes: [], files: [] })
      .returning('id')
    const id = typeof taskId === 'object' ? (taskId as { id: number }).id : (taskId as number)
    const verification = await createTaskAction.verify(
      propose(okArgs(LEAD_A), actorA),
      { status: 'SUCCESS', targetIds: [{ kind: 'task', id: String(id) }] },
      { actor: actorA, deadlineAtMs: DEADLINE(), nowMs: Date.now() },
    )
    expect(verification.state).toBe('NOT_FOUND')
    expect(verification.verified).toBe(false)
  })
})

// ── 16-22 · verification, audit, isolation ──────────────────────────────────

describe('verification, audit and isolation', () => {
  it('16 — a created task is verified against the database, field by field', async () => {
    const first = await runtime().execute(propose(okArgs(LEAD_A), actorA), {
      authenticated: actorA, deadlineAtMs: DEADLINE(), grants: [],
    })
    const out = await approveAndRun(first, actorA)
    const names = out.verification!.checks.map((c) => c.name).sort()
    expect(names).toEqual(['agencyOwnership', 'assignee', 'clientId', 'dueDate', 'title'])
    expect(out.verification!.checks.every((c) => c.ok)).toBe(true)
    const row = await db('tasks').where({ clientId: LEAD_A }).first()
    // The due date really is the one asked for, not today.
    // The column is a DATE; pg hands back a Date, so compare on the calendar
    // day rather than on however JS chooses to stringify it.
    const due = new Date(row.dueDate)
    expect(
      `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`,
    ).toBe('2026-09-07')
  })

  it('17 — the audit row carries the whole lifecycle', async () => {
    const first = await runtime().execute(propose(okArgs(LEAD_A), actorA), {
      authenticated: actorA, deadlineAtMs: DEADLINE(), grants: [],
    })
    const out = await approveAndRun(first, actorA)
    const row = await findActionByActionId(AGENCY_A, out.actionId)
    expect(row).toMatchObject({
      agencyId: AGENCY_A, userId: USER_A, actionType: 'create_task',
      risk: 'LOW_RISK_WRITE', intent: 'AGENT_PROPOSAL', approvalState: 'APPROVED', approvedByUserId: USER_A,
      executionState: 'SUCCEEDED', executionStatus: 'SUCCESS', verificationState: 'VERIFIED',
    })
    expect(row!.targetIds[0]!.kind).toBe('task')
    expect(row!.args).toMatchObject({ clientId: LEAD_A, title: 'להתקשר לדניאל' })
  })

  it('18 — a refusal is audited even though nothing ran', async () => {
    const out = await runtime().execute({ ...propose(okArgs(LEAD_A), actorA), actionType: 'delete_everything' }, {
      authenticated: actorA, deadlineAtMs: DEADLINE(), grants: [],
    })
    expect(out.execution.status).toBe('INVALID_ACTION')
    const row = await findActionByActionId(AGENCY_A, out.actionId)
    expect(row).toMatchObject({ executionState: 'NOT_EXECUTED', executionStatus: 'INVALID_ACTION' })
  })

  it('19 — the model cannot reach the task service by naming a different action', async () => {
    for (const type of ['createTask', 'create_system_task', 'db.tasks.insert']) {
      const out = await runtime().execute({ ...propose(okArgs(LEAD_A), actorA), actionType: type }, {
        authenticated: actorA, deadlineAtMs: DEADLINE(), grants: [],
      })
      expect(out.execution.status, type).toBe('INVALID_ACTION')
    }
    expect(await db('tasks').where({ clientId: LEAD_A })).toHaveLength(0)
  })

  it('20 — an unverified execution never reports success', async () => {
    const { reportFor } = await import('@/lib/agent/actions')
    // The exact shape a create_task run takes when the row cannot be read back.
    expect(reportFor({ status: 'SUCCESS' }, { state: 'NOT_FOUND', verified: false, checks: [] }, 'APPROVED').report)
      .toBe('EXECUTED_UNVERIFIED')
  })

  it('21 — a deadline already passed cannot produce a false success', async () => {
    const first = await runtime().execute(propose(okArgs(LEAD_A), actorA), {
      authenticated: actorA, deadlineAtMs: DEADLINE(), grants: [],
    })
    const record = await findActionByActionId(AGENCY_A, first.actionId)
    await recordApprovalDecision({
      agencyId: AGENCY_A, actionId: record!.actionId, argsHash: record!.argsHash,
      decision: 'APPROVED', decidedByUserId: USER_A,
    })
    const grants = await loadApprovalGrants({ agencyId: AGENCY_A, actionId: record!.actionId })
    const out = await runtime().execute(
      { ...propose(record!.args, actorA, record!.actionId), idempotencyKey: record!.idempotencyKey },
      { authenticated: actorA, deadlineAtMs: Date.now() - 1, grants },
    )
    expect(out.report).toBe('FAILED')
    expect(out.failureReason).toBe('deadline-before-execution')
    expect(await db('tasks').where({ clientId: LEAD_A })).toHaveLength(0)
  })

  it('22 — two agencies acting at once stay entirely separate', async () => {
    const [a, b] = await Promise.all([
      runtime().execute(propose(okArgs(LEAD_A), actorA), { authenticated: actorA, deadlineAtMs: DEADLINE(), grants: [] }),
      runtime().execute(propose(okArgs(LEAD_B), actorB), { authenticated: actorB, deadlineAtMs: DEADLINE(), grants: [] }),
    ])
    const [ra, rb] = await Promise.all([approveAndRun(a, actorA), approveAndRun(b, actorB)])
    expect([ra.report, rb.report]).toEqual(['VERIFIED_SUCCESS', 'VERIFIED_SUCCESS'])

    const tasksA = await db('tasks').where({ clientId: LEAD_A })
    const tasksB = await db('tasks').where({ clientId: LEAD_B })
    expect(tasksA).toHaveLength(1)
    expect(tasksB).toHaveLength(1)
    expect(tasksA[0].userId).toBe(USER_A)
    expect(tasksB[0].userId).toBe(USER_B)
    // Neither agency's action row is visible to the other.
    expect(await findActionByActionId(AGENCY_B, ra.actionId)).toBeNull()
    expect(await findActionByActionId(AGENCY_A, rb.actionId)).toBeNull()
  })
})

/** A real task row for agency A, matching `okArgs`. */
async function seedTask(): Promise<number> {
  const [id] = await db('tasks')
    .insert({ clientId: LEAD_A, title: 'להתקשר לדניאל', userId: USER_A, dueDate: '2026-09-07', tasks: [], notes: [], files: [] })
    .returning('id')
  return typeof id === 'object' ? (id as { id: number }).id : (id as number)
}
