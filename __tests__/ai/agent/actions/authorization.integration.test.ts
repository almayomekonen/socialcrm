/**
 * The authorization correction, end to end through the real bridge.
 *
 * `WRITE == APPROVAL` was the rule and it was the wrong one. A rep who types
 * "תיצור לי משימה להתקשר ליוסי" has decided; a card asking whether they meant it
 * is the product failing to listen. The same action proposed by the agent on its
 * own initiative must still wait. Same action, same arguments, same risk —
 * opposite correct behaviour.
 *
 * THESE TESTS GO THROUGH `submitProposedAction`, not through the runtime
 * directly, because the thing under test is the derivation: the user's own words
 * arrive as a string and come out the other end as an executed task or an
 * approval card. Calling the runtime with a hand-picked intent would test
 * everything except the decision that matters.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { enableAgentFor, restoreAgentRollout } from './_agentRollout'
import { z } from 'zod'

vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { findActionByActionId } from '@/db/agentActions'
import { submitProposedAction, decideOnAction } from '@/lib/agent/actions/bridge'
import { registerAgentAction, getAgentAction, type ActionOutcome } from '@/lib/agent/actions'
import { registerDomainActions } from '@/lib/agent/actions/domain'
import { Roles } from '@/types/roles'
import type { AgentScope, ProposedAction } from '@/lib/agent/types'

const AGENCY_A = 92_001
const AGENCY_B = 92_002
const USER_A = 92_101
const USER_B = 92_102
let LEAD_A = 0
let LEAD_B = 0

const scopeA = (): AgentScope => ({ agencyId: AGENCY_A, userId: USER_A, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'א' })
const scopeB = (): AgentScope => ({ agencyId: AGENCY_B, userId: USER_B, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'ב' })

const COMMAND = 'תיצור לי משימה להתקשר ליוסי ב-8/9'
const SUGGESTION_TURN = 'מצאתי 25 לידים שהתקררו. כדאי ליצור להם משימת מעקב.'

function proposal(clientId: number, title = 'להתקשר ליוסי'): ProposedAction {
  return { actionType: 'create_task', args: { clientId, title, dueDate: '2026-09-08' }, evidenceRefs: [`lead:${clientId}`] }
}

let runSeq = 0
const submit = (p: ProposedAction, scope: AgentScope, userMessage: string, prior?: string | null) =>
  submitProposedAction({ proposal: p, scope, agentRunId: `run_auth_${++runSeq}`, userMessage, priorAssistantMessage: prior })

async function seed(agencyId: number, userId: number): Promise<number> {
  await db('agencies').insert({
    id: agencyId, name: `auth-${agencyId}`, plan: 'pro', country: 'IL',
    defaultCurrency: 'ILS', locale: 'he', docNumberFormat: '{n}', bankDetails: '{}',
  } as never).onConflict('id').ignore()
  await db('users').insert({
    id: userId, agencyId, email: `a${userId}@t.test`, role: 'ADMIN', firstName: 'נציג', lastName: String(userId),
  }).onConflict('id').ignore()
  const [lead] = await db('clients').insert({ firstName: 'יוסי', lastName: String(agencyId), agencyId, createdById: userId }).returning('id')
  return typeof lead === 'object' ? (lead as { id: number }).id : (lead as number)
}

const tasksIn = (leadId: number) => db('tasks').where({ clientId: leadId })

beforeAll(async () => {
  enableAgentFor([AGENCY_A, AGENCY_B])
  registerDomainActions()
  // A high-risk neighbour, so "explicit does not override the top of the ladder"
  // is proven against a real registry entry rather than asserted about one.
  if (!getAgentAction('send_customer_message')) {
    registerAgentAction({
      type: 'send_customer_message',
      argsSchema: z.object({}) as never,
      risk: 'HIGH_RISK',
      execute: async () => ({ status: 'SUCCESS' }),
      verify: async () => ({ state: 'VERIFIED', verified: true, checks: [] }),
    })
  }
  LEAD_A = await seed(AGENCY_A, USER_A)
  LEAD_B = await seed(AGENCY_B, USER_B)
})

afterEach(async () => {
  await db('tasks').whereIn('clientId', [LEAD_A, LEAD_B]).del()
  await db('agent_action_approvals').whereIn('agencyId', [AGENCY_A, AGENCY_B]).del()
  await db('agent_actions').whereIn('agencyId', [AGENCY_A, AGENCY_B]).del()
})

afterAll(async () => {
  restoreAgentRollout()
  await db('clients').whereIn('id', [LEAD_A, LEAD_B]).del()
  await db('users').whereIn('id', [USER_A, USER_B]).del()
  await db('agencies').whereIn('id', [AGENCY_A, AGENCY_B]).del()
})

// ── 1-3 · the correction itself ─────────────────────────────────────────────

describe('who asked decides', () => {
  it('1 — an explicit command executes immediately, with no approval', async () => {
    const out = (await submit(proposal(LEAD_A), scopeA(), COMMAND))!
    expect(out.report).toBe('VERIFIED_SUCCESS')
    expect(out.approval).toBe('NOT_REQUIRED')
    expect(await tasksIn(LEAD_A)).toHaveLength(1)
  })

  it('2 — the same action, agent-initiated, waits for approval', async () => {
    // The rep asked a question. The agent decided a task would help. It may not
    // act on that by itself, however low the risk.
    const out = (await submit(proposal(LEAD_A), scopeA(), 'מה הבעיה הכי גדולה שלי כרגע?'))!
    expect(out.report).toBe('AWAITING_APPROVAL')
    expect(await tasksIn(LEAD_A)).toHaveLength(0)
  })

  it('3 — confirming the agent\'s suggestion executes it', async () => {
    const out = (await submit(proposal(LEAD_A), scopeA(), 'כן, תעשה', SUGGESTION_TURN))!
    expect(out.report).toBe('VERIFIED_SUCCESS')
    expect(await tasksIn(LEAD_A)).toHaveLength(1)
  })

  it('3b — a bare "כן" with nothing to confirm does not execute', async () => {
    const out = (await submit(proposal(LEAD_A), scopeA(), 'כן'))!
    expect(out.report).toBe('AWAITING_APPROVAL')
    expect(await tasksIn(LEAD_A)).toHaveLength(0)
  })
})

// ── 4-5 · the ladder still outranks intent ──────────────────────────────────

describe('risk outranks instruction', () => {
  it('4 — a HIGH_RISK action still asks, however explicit the command', async () => {
    const out = (await submitProposedAction({
      proposal: { actionType: 'send_customer_message' as never, args: {} as never, evidenceRefs: [] },
      scope: scopeA(), agentRunId: 'run_hr', userMessage: 'תשלח ליוסי את ההודעה עכשיו',
    }))!
    expect(out.report).toBe('AWAITING_APPROVAL')
    expect(out.risk).toBe('HIGH_RISK')
  })

  it('5 — an ambiguous request mutates nothing', async () => {
    for (const message of ['אולי כדאי ליצור משימה ליוסי', 'מה דעתך על משימה ליוסי?', 'האם כדאי לפתוח משימה']) {
      const out = (await submit(proposal(LEAD_A), scopeA(), message))!
      expect(out.report, message).toBe('AWAITING_APPROVAL')
    }
    expect(await tasksIn(LEAD_A)).toHaveLength(0)
  })
})

// ── 6-9 · the guarantees that did not move ──────────────────────────────────

describe('nothing else relaxed', () => {
  it('6 — a missing target mutates nothing, even on an explicit command', async () => {
    const out = (await submit(proposal(99_999_999), scopeA(), COMMAND))!
    expect(out.execution).toMatchObject({ status: 'NOT_AUTHORIZED', reason: 'lead-not-in-agency' })
    expect(out.report).toBe('NOT_EXECUTED')
  })

  it('7 — a cross-tenant target is rejected on an explicit command', async () => {
    const out = (await submit(proposal(LEAD_B), scopeA(), COMMAND))!
    expect(out.execution.status).toBe('NOT_AUTHORIZED')
    expect(await tasksIn(LEAD_B)).toHaveLength(0)
  })

  it('8 — a forged identity in the payload is ignored', async () => {
    const forged = { ...proposal(LEAD_A), agencyId: AGENCY_B, actor: { agencyId: AGENCY_B, userId: USER_B } } as unknown as ProposedAction
    const out = (await submit(forged, scopeA(), COMMAND))!
    // It ran as agency A, under user A — the authenticated scope, not the claim.
    expect(out.agencyId).toBe(AGENCY_A)
    expect(out.report).toBe('VERIFIED_SUCCESS')
    const row = await db('tasks').where({ clientId: LEAD_A }).first()
    expect(row.userId).toBe(USER_A)
  })

  it('9 — the same explicit command twice creates one task', async () => {
    const first = (await submitProposedAction({ proposal: proposal(LEAD_A), scope: scopeA(), agentRunId: 'run_dupe', userMessage: COMMAND }))!
    const second = (await submitProposedAction({ proposal: proposal(LEAD_A), scope: scopeA(), agentRunId: 'run_dupe', userMessage: COMMAND }))!
    expect(first.report).toBe('VERIFIED_SUCCESS')
    expect(second.report).toBe('DUPLICATE_NOOP')
    expect(await tasksIn(LEAD_A)).toHaveLength(1)
  })

  it('10 — a verification failure is never reported as success', async () => {
    const { reportFor } = await import('@/lib/agent/actions')
    expect(reportFor({ status: 'SUCCESS' }, { state: 'MISMATCH', verified: false, checks: [] }, 'NOT_REQUIRED').report)
      .toBe('EXECUTED_UNVERIFIED')
  })
})

// ── 12-13 · approval still works, and the audit says why ────────────────────

describe('approval and audit', () => {
  it('12 — the approval flow still executes an agent-proposed action', async () => {
    const proposed = (await submit(proposal(LEAD_A), scopeA(), 'מה קורה בעסק שלי?'))!
    expect(proposed.report).toBe('AWAITING_APPROVAL')
    const decided = await decideOnAction({
      actionId: proposed.actionId, argsHash: proposed.argsHash, decision: 'APPROVED', scope: scopeA(),
    })
    expect(decided.ok && decided.outcome.report).toBe('VERIFIED_SUCCESS')
    expect(await tasksIn(LEAD_A)).toHaveLength(1)
  })

  it('12b — rejecting an agent-proposed action still executes nothing', async () => {
    const proposed = (await submit(proposal(LEAD_A), scopeA(), 'מה קורה בעסק שלי?'))!
    const decided = await decideOnAction({
      actionId: proposed.actionId, argsHash: proposed.argsHash, decision: 'REJECTED', scope: scopeA(),
    })
    expect(decided.ok && decided.outcome.report).toBe('REJECTED')
    expect(await tasksIn(LEAD_A)).toHaveLength(0)
  })

  it('13 — the audit records which of the three paths ran', async () => {
    const commanded = (await submit(proposal(LEAD_A), scopeA(), COMMAND))!
    const commandedRow = await findActionByActionId(AGENCY_A, commanded.actionId)
    expect(commandedRow).toMatchObject({ intent: 'EXPLICIT_COMMAND', approvalState: 'NOT_REQUIRED', executionState: 'SUCCEEDED' })

    const suggested = (await submit(proposal(LEAD_A, 'משימה אחרת'), scopeA(), 'מה קורה בעסק?'))!
    const suggestedRow = await findActionByActionId(AGENCY_A, suggested.actionId)
    // The third state — "approval was required" — is `approvalState`, not a
    // fourth intent value.
    expect(suggestedRow).toMatchObject({ intent: 'AGENT_PROPOSAL', approvalState: 'PENDING', executionState: 'NOT_EXECUTED' })
  })

  it('13b — two tenants commanding at once stay separate', async () => {
    const [a, b] = await Promise.all([
      submit(proposal(LEAD_A), scopeA(), COMMAND),
      submit(proposal(LEAD_B), scopeB(), COMMAND),
    ]) as [ActionOutcome, ActionOutcome]
    expect([a.report, b.report]).toEqual(['VERIFIED_SUCCESS', 'VERIFIED_SUCCESS'])
    expect((await tasksIn(LEAD_A))[0].userId).toBe(USER_A)
    expect((await tasksIn(LEAD_B))[0].userId).toBe(USER_B)
    expect(await findActionByActionId(AGENCY_B, a.actionId)).toBeNull()
  })
})
