/**
 * `create_follow_up` — the second action, and the test of whether the runtime
 * was actually generic or merely worked once.
 *
 * IT IS SHAPED NOTHING LIKE `create_task`. A task is a row in `tasks`; a
 * follow-up is two columns on the lead — so this is an UPDATE, the target id is
 * an input rather than something the mutation returns, and setting one REPLACES
 * any existing one. If the runtime had quietly assumed "mutation = insert
 * returning an id", this file is where that would surface.
 *
 * Everything runs through the real bridge, so the authorization decision under
 * test is the real one: a user's sentence goes in, and an updated lead or an
 * approval card comes out.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { enableAgentFor, restoreAgentRollout } from './_agentRollout'

vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { findActionByActionId } from '@/db/agentActions'
import { submitProposedAction, decideOnAction } from '@/lib/agent/actions/bridge'
import { registerDomainActions } from '@/lib/agent/actions/domain'
import { businessMidnightMs } from '@/lib/agent/actions/domain/createFollowUp'
import { startOfBusinessDayMs } from '@/lib/today/time'
import { Roles } from '@/types/roles'
import type { AgentScope, ProposedAction } from '@/lib/agent/types'
import type { ActionOutcome } from '@/lib/agent/actions'

const AGENCY_A = 93_001
const AGENCY_B = 93_002
const ADMIN_A = 93_101
const ADMIN_B = 93_102
const REP_A = 93_103
let LEAD_A = 0
let LEAD_B = 0
/** Owned by REP_A, so the owner restriction can be exercised. */
let LEAD_OWNED = 0

const AT = '2026-09-10'
const COMMAND = 'תעשה לי follow-up ליוסי כהן ל־10/9'
const SUGGESTION = 'מצאתי 25 לידים שהתקררו. כדאי לעשות ליוסי כהן follow-up ל־10/9.'

const adminA = (): AgentScope => ({ agencyId: AGENCY_A, userId: ADMIN_A, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'א' })
const adminB = (): AgentScope => ({ agencyId: AGENCY_B, userId: ADMIN_B, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'ב' })
const rep = (gotPermIds: number[]): AgentScope => ({ agencyId: AGENCY_A, userId: REP_A, role: Roles.AGNT, gotPermIds, plan: 'pro', firstName: 'נ' })

function proposal(clientId: number, at = AT, note: string | null = 'לחזור אליו'): ProposedAction {
  return { actionType: 'create_follow_up', args: { clientId, at, note }, evidenceRefs: [`lead:${clientId}`] }
}

let seq = 0
const submit = (p: ProposedAction, scope: AgentScope, userMessage: string, prior?: string | null, runId?: string) =>
  submitProposedAction({ proposal: p, scope, agentRunId: runId ?? `run_fu_${++seq}`, userMessage, priorAssistantMessage: prior })

const lead = (id: number) => db('clients').where({ id }).first('id', 'agencyId', 'nextFollowUpAt', 'followUpNote', 'userId')

async function seedAgency(agencyId: number, adminId: number): Promise<number> {
  await db('agencies').insert({
    id: agencyId, name: `fu-${agencyId}`, plan: 'pro', country: 'IL',
    defaultCurrency: 'ILS', locale: 'he', docNumberFormat: '{n}', bankDetails: '{}',
  } as never).onConflict('id').ignore()
  await db('users').insert({ id: adminId, agencyId, email: `f${adminId}@t.test`, role: 'ADMIN', firstName: 'מנהל', lastName: String(adminId) })
    .onConflict('id').ignore()
  const [row] = await db('clients').insert({ firstName: 'יוסי', lastName: String(agencyId), agencyId, createdById: adminId }).returning('id')
  return typeof row === 'object' ? (row as { id: number }).id : (row as number)
}

beforeAll(async () => {
  enableAgentFor([AGENCY_A, AGENCY_B])
  registerDomainActions()
  LEAD_A = await seedAgency(AGENCY_A, ADMIN_A)
  LEAD_B = await seedAgency(AGENCY_B, ADMIN_B)
  await db('users').insert({ id: REP_A, agencyId: AGENCY_A, email: `f${REP_A}@t.test`, role: 'AGNT', firstName: 'נציג', lastName: 'א' })
    .onConflict('id').ignore()
  const [owned] = await db('clients')
    .insert({ firstName: 'דנה', lastName: 'שלי', agencyId: AGENCY_A, createdById: ADMIN_A, userId: REP_A })
    .returning('id')
  LEAD_OWNED = typeof owned === 'object' ? (owned as { id: number }).id : (owned as number)
})

afterEach(async () => {
  await db('clients').whereIn('id', [LEAD_A, LEAD_B, LEAD_OWNED]).update({ nextFollowUpAt: null, followUpNote: null })
  await db('agent_action_approvals').whereIn('agencyId', [AGENCY_A, AGENCY_B]).del()
  await db('agent_actions').whereIn('agencyId', [AGENCY_A, AGENCY_B]).del()
})

afterAll(async () => {
  restoreAgentRollout()
  await db('clients').whereIn('id', [LEAD_A, LEAD_B, LEAD_OWNED]).del()
  await db('users').whereIn('id', [ADMIN_A, ADMIN_B, REP_A]).del()
  await db('agencies').whereIn('id', [AGENCY_A, AGENCY_B]).del()
})

// ── explicit command ────────────────────────────────────────────────────────

describe('an explicit command executes', () => {
  it('sets the follow-up immediately, with no approval', async () => {
    const out = (await submit(proposal(LEAD_A), adminA(), COMMAND))!
    expect(out.report).toBe('VERIFIED_SUCCESS')
    expect(out.approval).toBe('NOT_REQUIRED')
    const row = await lead(LEAD_A)
    expect(row.nextFollowUpAt).not.toBeNull()
    expect(row.followUpNote).toBe('לחזור אליו')
  })

  it('writes the BUSINESS day\'s midnight, not the server\'s', async () => {
    /**
     * The bug this pins: `new Date('2026-09-10')` on a UTC server is three hours
     * before Jerusalem midnight, which puts a follow-up "for the 10th" on the
     * wrong side of the boundary `getFollowUpsDueToday` computes — so it would
     * surface a day early.
     */
    await submit(proposal(LEAD_A), adminA(), COMMAND)
    const row = await lead(LEAD_A)
    const stored = new Date(row.nextFollowUpAt).getTime()
    expect(stored).toBe(businessMidnightMs(AT))
    // And that instant really is the start of that business day.
    expect(startOfBusinessDayMs(stored)).toBe(stored)
  })

  it('reports every postcondition it checked', async () => {
    const out = (await submit(proposal(LEAD_A), adminA(), COMMAND))!
    expect(out.verification!.checks.map((c) => c.name).sort())
      .toEqual(['agencyOwnership', 'clientId', 'followUpDate', 'followUpExists', 'note'])
    expect(out.verification!.checks.every((c) => c.ok)).toBe(true)
    // The target carries the lead's name, read back by the VERIFIER from the
    // database — which is what lets the confirmation say "עבור יוסי" instead of
    // "#93001" without the model supplying a name.
    expect(out.verification!.targetIds).toEqual([
      { kind: 'lead', id: String(LEAD_A), label: `יוסי ${AGENCY_A}` },
    ])
  })

  it('reports whether it SET or REPLACED, so the confirmation can be truthful', async () => {
    /**
     * "קבעתי מעקב" and "עדכנתי את המעקב" are different statements, and a rep
     * whose hand-picked date was overwritten should be told the second one. The
     * executor reports what it found; nothing infers it from the words.
     */
    const first = (await submit(proposal(LEAD_A), adminA(), COMMAND, null, 'run_fu_set'))!
    expect(first.execution.detail).toMatchObject({ replacedExisting: false })

    const second = (await submit(proposal(LEAD_A, '2026-09-11'), adminA(), COMMAND, null, 'run_fu_set'))!
    expect(second.execution.detail).toMatchObject({ replacedExisting: true })
  })

  it('replaces an existing follow-up, as the product does everywhere else', async () => {
    await db('clients').where({ id: LEAD_A }).update({ nextFollowUpAt: new Date('2026-01-01T00:00:00Z') })
    const out = (await submit(proposal(LEAD_A), adminA(), COMMAND))!
    expect(out.report).toBe('VERIFIED_SUCCESS')
    expect(new Date((await lead(LEAD_A)).nextFollowUpAt).getTime()).toBe(businessMidnightMs(AT))
  })
})

// ── proposal and confirmation ───────────────────────────────────────────────

describe('an agent-initiated follow-up waits', () => {
  it('creates a durable action and leaves the CRM untouched', async () => {
    const out = (await submit(proposal(LEAD_A), adminA(), 'מה הבעיה הכי גדולה שלי?'))!
    expect(out.report).toBe('AWAITING_APPROVAL')
    expect((await lead(LEAD_A)).nextFollowUpAt).toBeNull()
    const row = await findActionByActionId(AGENCY_A, out.actionId)
    expect(row).toMatchObject({ actionType: 'create_follow_up', intent: 'AGENT_PROPOSAL', executionState: 'NOT_EXECUTED' })
  })

  it('approval executes it exactly once', async () => {
    const proposed = (await submit(proposal(LEAD_A), adminA(), 'מה קורה בעסק שלי?'))!
    const first = await decideOnAction({ actionId: proposed.actionId, argsHash: proposed.argsHash, decision: 'APPROVED', scope: adminA() })
    const second = await decideOnAction({ actionId: proposed.actionId, argsHash: proposed.argsHash, decision: 'APPROVED', scope: adminA() })
    expect(first.ok && first.outcome.report).toBe('VERIFIED_SUCCESS')
    expect(second.ok && second.outcome.report).toBe('DUPLICATE_NOOP')
    expect((await lead(LEAD_A)).nextFollowUpAt).not.toBeNull()
  })

  it('rejection executes nothing', async () => {
    const proposed = (await submit(proposal(LEAD_A), adminA(), 'מה קורה בעסק שלי?'))!
    const decided = await decideOnAction({ actionId: proposed.actionId, argsHash: proposed.argsHash, decision: 'REJECTED', scope: adminA() })
    expect(decided.ok && decided.outcome.report).toBe('REJECTED')
    expect((await lead(LEAD_A)).nextFollowUpAt).toBeNull()
  })

  it('"כן, תעשה" after the suggestion executes it', async () => {
    const out = (await submit(proposal(LEAD_A), adminA(), 'כן, תעשה', SUGGESTION))!
    expect(out.report).toBe('VERIFIED_SUCCESS')
    expect((await lead(LEAD_A)).nextFollowUpAt).not.toBeNull()
  })
})

// ── security ────────────────────────────────────────────────────────────────

describe('tenant and permission boundaries', () => {
  it('refuses a cross-tenant lead and mutates nothing', async () => {
    const out = (await submit(proposal(LEAD_B), adminA(), COMMAND))!
    expect(out.execution.status).toBe('NOT_AUTHORIZED')
    expect((await lead(LEAD_B)).nextFollowUpAt).toBeNull()
  })

  it('ignores a forged agency and actor in the payload', async () => {
    const forged = { ...proposal(LEAD_A), agencyId: AGENCY_B, actor: { agencyId: AGENCY_B, userId: ADMIN_B } } as unknown as ProposedAction
    const out = (await submit(forged, adminA(), COMMAND))!
    expect(out.agencyId).toBe(AGENCY_A)
    expect(out.report).toBe('VERIFIED_SUCCESS')
  })

  it('holds a non-admin to the leads they own', async () => {
    // The half an agency-only check would have missed: same tenant, someone
    // else's lead.
    const denied = (await submit(proposal(LEAD_A), rep([]), COMMAND))!
    expect(denied.execution).toMatchObject({ status: 'NOT_AUTHORIZED', reason: 'lead-not-in-agency-or-not-permitted' })
    expect((await lead(LEAD_A)).nextFollowUpAt).toBeNull()

    const allowed = (await submit(proposal(LEAD_OWNED), rep([REP_A]), COMMAND))!
    expect(allowed.report).toBe('VERIFIED_SUCCESS')
    expect((await lead(LEAD_OWNED)).nextFollowUpAt).not.toBeNull()
  })
})

// ── ambiguity and malformed input ───────────────────────────────────────────

describe('nothing ambiguous mutates', () => {
  it('a lead that does not exist mutates nothing', async () => {
    const out = (await submit(proposal(99_999_999), adminA(), COMMAND))!
    expect(out.execution.status).toBe('NOT_AUTHORIZED')
    expect(out.report).toBe('NOT_EXECUTED')
  })

  it('a malformed date is refused before any write', async () => {
    for (const at of ['10/9/2026', '2026-9-10', 'מחר', '2026-09-10T10:00:00']) {
      const out = (await submit(proposal(LEAD_A, at), adminA(), COMMAND))!
      expect(out.execution, at).toMatchObject({ status: 'INVALID_ACTION', reason: 'invalid-args' })
    }
    expect((await lead(LEAD_A)).nextFollowUpAt).toBeNull()
  })

  it('a hedged request never executes, however complete its arguments', async () => {
    for (const message of ['כדאי לעשות ליוסי follow-up ל-10/9', 'אולי תקבע מעקב ליוסי', 'מה אם תיצור מעקב ליוסי?']) {
      const out = (await submit(proposal(LEAD_A), adminA(), message))!
      expect(out.report, message).toBe('AWAITING_APPROVAL')
    }
    expect((await lead(LEAD_A)).nextFollowUpAt).toBeNull()
  })
})

// ── idempotency ─────────────────────────────────────────────────────────────

describe('idempotency', () => {
  it('the same command twice writes once', async () => {
    const a = (await submit(proposal(LEAD_A), adminA(), COMMAND, null, 'run_fu_dupe'))!
    const b = (await submit(proposal(LEAD_A), adminA(), COMMAND, null, 'run_fu_dupe'))!
    expect(a.report).toBe('VERIFIED_SUCCESS')
    expect(b.report).toBe('DUPLICATE_NOOP')
  })

  it('concurrent duplicates write once', async () => {
    const [a, b, c] = (await Promise.all([
      submit(proposal(LEAD_A), adminA(), COMMAND, null, 'run_fu_conc'),
      submit(proposal(LEAD_A), adminA(), COMMAND, null, 'run_fu_conc'),
      submit(proposal(LEAD_A), adminA(), COMMAND, null, 'run_fu_conc'),
    ])) as ActionOutcome[]
    const verified = [a, b, c].filter((o) => o.report === 'VERIFIED_SUCCESS')
    expect(verified).toHaveLength(1)
    expect([a, b, c].filter((o) => o.report === 'DUPLICATE_NOOP')).toHaveLength(2)
  })

  it('a different date is a different action', async () => {
    await submit(proposal(LEAD_A, '2026-09-10'), adminA(), COMMAND, null, 'run_fu_diff')
    const second = (await submit(proposal(LEAD_A, '2026-09-11'), adminA(), COMMAND, null, 'run_fu_diff'))!
    expect(second.report).toBe('VERIFIED_SUCCESS')
    expect(new Date((await lead(LEAD_A)).nextFollowUpAt).getTime()).toBe(businessMidnightMs('2026-09-11'))
  })
})

// ── verification honesty ────────────────────────────────────────────────────

describe('verification cannot be talked into success', () => {
  it('reports MISMATCH when the row does not match the request', async () => {
    const { createFollowUpAction } = await import('@/lib/agent/actions/domain')
    await submit(proposal(LEAD_A, '2026-09-10', 'הערה אחת'), adminA(), COMMAND)
    // Verify the SAME lead against a different requested date.
    const v = await createFollowUpAction.verify(
      { args: { clientId: LEAD_A, at: '2026-12-25', note: 'הערה אחת' } } as never,
      { status: 'SUCCESS' },
      { actor: { agencyId: AGENCY_A, userId: ADMIN_A, role: 'ADMIN', gotPermIds: [] }, deadlineAtMs: Date.now() + 40_000, nowMs: Date.now() },
    )
    expect(v.state).toBe('MISMATCH')
    expect(v.verified).toBe(false)
    expect(v.checks.find((c) => c.name === 'followUpDate')?.ok).toBe(false)
  })

  it('a lead in another agency is NOT_FOUND, never verified', async () => {
    const { createFollowUpAction } = await import('@/lib/agent/actions/domain')
    const v = await createFollowUpAction.verify(
      { args: { clientId: LEAD_B, at: AT, note: null } } as never,
      { status: 'SUCCESS' },
      { actor: { agencyId: AGENCY_A, userId: ADMIN_A, role: 'ADMIN', gotPermIds: [] }, deadlineAtMs: Date.now() + 40_000, nowMs: Date.now() },
    )
    expect(v.state).toBe('NOT_FOUND')
    expect(v.verified).toBe(false)
  })

  it('an unset follow-up fails the existence check rather than passing quietly', async () => {
    const { createFollowUpAction } = await import('@/lib/agent/actions/domain')
    const v = await createFollowUpAction.verify(
      { args: { clientId: LEAD_A, at: AT, note: null } } as never,
      { status: 'SUCCESS' },
      { actor: { agencyId: AGENCY_A, userId: ADMIN_A, role: 'ADMIN', gotPermIds: [] }, deadlineAtMs: Date.now() + 40_000, nowMs: Date.now() },
    )
    expect(v.checks.find((c) => c.name === 'followUpExists')?.ok).toBe(false)
    expect(v.verified).toBe(false)
  })
})

// ── audit ───────────────────────────────────────────────────────────────────

describe('the audit distinguishes the three paths', () => {
  it('records intent and approval state for each', async () => {
    const commanded = (await submit(proposal(LEAD_A), adminA(), COMMAND))!
    expect(await findActionByActionId(AGENCY_A, commanded.actionId)).toMatchObject({
      actionType: 'create_follow_up', intent: 'EXPLICIT_COMMAND',
      approvalState: 'NOT_REQUIRED', executionState: 'SUCCEEDED', verificationState: 'VERIFIED',
    })

    const suggested = (await submit(proposal(LEAD_OWNED), adminA(), 'מה קורה בעסק?'))!
    expect(await findActionByActionId(AGENCY_A, suggested.actionId)).toMatchObject({
      intent: 'AGENT_PROPOSAL', approvalState: 'PENDING', executionState: 'NOT_EXECUTED',
    })

    const approved = await decideOnAction({
      actionId: suggested.actionId, argsHash: suggested.argsHash, decision: 'APPROVED', scope: adminA(),
    })
    expect(approved.ok).toBe(true)
    expect(await findActionByActionId(AGENCY_A, suggested.actionId)).toMatchObject({
      intent: 'AGENT_PROPOSAL', approvalState: 'APPROVED', approvedByUserId: ADMIN_A, executionState: 'SUCCEEDED',
    })
  })
})
