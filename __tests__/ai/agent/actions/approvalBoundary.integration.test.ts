/**
 * Who may decide on a pending action, and when (F2, F3).
 *
 * F2 — ONLY THE PROPOSER DECIDES. An action is proposed in one rep's
 * conversation, on that rep's question. Before this, the decision path built
 * its actor from whoever called it, so any user in the same agency holding the
 * id and hash could approve — or permanently reject — a colleague's action.
 * Even an ADMIN colleague is refused here: the rule is about whose proposal it
 * is, not about rank.
 *
 * F3 — ROLLOUT IS RE-CHECKED AT DECISION TIME. A card can outlive the rollout
 * that produced it. Taking an agency off /agent must stop its pending actions,
 * not only new questions — and restoring it must make the same action
 * approvable again, which proves the refusal came from the flag and nothing
 * else.
 *
 * Every refusal is checked for its side effects too: no grant, no rejection,
 * no task.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { enableAgentFor, restoreAgentRollout } from './_agentRollout'

vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { decideOnAction, decideOnBatch, submitProposedAction, submitProposedBatch } from '@/lib/agent/actions/bridge'
import { registerDomainActions } from '@/lib/agent/actions/domain'
import { Roles } from '@/types/roles'
import type { AgentScope, ProposedAction, ProposedBatch } from '@/lib/agent/types'
import type { ActionOutcome } from '@/lib/agent/actions'
import type { BatchOutcome } from '@/lib/agent/actions/batch'

const AGENCY = 97_001
const OTHER_AGENCY = 97_002
const PROPOSER = 97_101
const COLLEAGUE = 97_102
let LEADS: number[] = []

const as = (userId: number): AgentScope => ({ agencyId: AGENCY, userId, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'א' })

// A question, so every proposal below waits for a card (see F1).
const QUESTION = 'מי צריך מעקב השבוע?'

const task = (lead: number): ProposedAction => ({
  actionType: 'create_task', args: { clientId: lead, title: 'לחזור', dueDate: '2026-10-05' }, evidenceRefs: [`lead:${lead}`],
})
const batch = (targets: number[]): ProposedBatch => ({
  actionType: 'create_task', targets, args: { title: 'לחזור', dueDate: '2026-10-05' }, evidenceRefs: targets.map((t) => `lead:${t}`),
})

let seq = 0
async function pendingAction(): Promise<ActionOutcome> {
  const out = (await submitProposedAction({
    proposal: task(LEADS[0]), scope: as(PROPOSER), agentRunId: `run_ab_${++seq}`, userMessage: QUESTION,
  })) as ActionOutcome
  expect(out.report).toBe('AWAITING_APPROVAL')
  return out
}
async function pendingBatch(): Promise<BatchOutcome> {
  const out = (await submitProposedBatch({
    batch: batch(LEADS), scope: as(PROPOSER), agentRunId: `run_abb_${++seq}`, userMessage: QUESTION,
  })) as BatchOutcome
  expect(out.report).toBe('AWAITING_APPROVAL')
  return out
}
const argsHashOf = async (actionId: string) =>
  (await db('agent_actions').where({ agencyId: AGENCY, actionId }).first('argsHash')).argsHash as string

const tasksWritten = () => db('tasks').whereIn('clientId', LEADS)
const decisionsRecorded = () => db('agent_action_approvals').where({ agencyId: AGENCY })

beforeAll(async () => {
  enableAgentFor([AGENCY])
  registerDomainActions()
  await db('agencies').insert({
    id: AGENCY, name: 'ab', plan: 'pro', country: 'IL', defaultCurrency: 'ILS',
    locale: 'he', docNumberFormat: '{n}', bankDetails: '{}',
  } as never).onConflict('id').ignore()
  for (const [id, name] of [[PROPOSER, 'מציע'], [COLLEAGUE, 'עמית']] as const) {
    await db('users').insert({ id, agencyId: AGENCY, email: `ab${id}@t.test`, role: 'ADMIN', firstName: name, lastName: 'ab' })
      .onConflict('id').ignore()
  }
  LEADS = []
  for (const firstName of ['דני', 'דנה']) {
    const [row] = await db('clients').insert({ firstName, lastName: 'ab', agencyId: AGENCY, createdById: PROPOSER, lead: true }).returning('id')
    LEADS.push(typeof row === 'object' ? (row as { id: number }).id : (row as number))
  }
})

afterEach(async () => {
  enableAgentFor([AGENCY])
  await db('tasks').whereIn('clientId', LEADS).del()
  await db('agent_action_approvals').where({ agencyId: AGENCY }).del()
  await db('agent_actions').where({ agencyId: AGENCY }).del()
})

afterAll(async () => {
  restoreAgentRollout()
  await db('clients').whereIn('id', LEADS).del()
  await db('users').whereIn('id', [PROPOSER, COLLEAGUE]).del()
  await db('agencies').where({ id: AGENCY }).del()
})

describe('F2 — only the proposer decides (single action)', () => {
  it('a same-agency colleague cannot approve, and nothing is recorded or written', async () => {
    const pending = await pendingAction()
    const hash = await argsHashOf(pending.actionId!)
    const res = await decideOnAction({ actionId: pending.actionId!, argsHash: hash, decision: 'APPROVED', scope: as(COLLEAGUE) })
    expect(res).toEqual({ ok: false, reason: 'not-proposer' })
    expect(await decisionsRecorded()).toHaveLength(0)
    expect(await tasksWritten()).toHaveLength(0)
  })

  it('a same-agency colleague cannot reject either — a rejection would be permanent', async () => {
    const pending = await pendingAction()
    const hash = await argsHashOf(pending.actionId!)
    const res = await decideOnAction({ actionId: pending.actionId!, argsHash: hash, decision: 'REJECTED', scope: as(COLLEAGUE) })
    expect(res).toEqual({ ok: false, reason: 'not-proposer' })
    expect(await decisionsRecorded()).toHaveLength(0)

    // The refused rejection left it open: the proposer can still approve it.
    const mine = await decideOnAction({ actionId: pending.actionId!, argsHash: hash, decision: 'APPROVED', scope: as(PROPOSER) })
    expect(mine.ok && mine.outcome.report).toBe('VERIFIED_SUCCESS')
    expect(await tasksWritten()).toHaveLength(1)
  })

  it('the proposer can reject, and nothing executes', async () => {
    const pending = await pendingAction()
    const hash = await argsHashOf(pending.actionId!)
    const res = await decideOnAction({ actionId: pending.actionId!, argsHash: hash, decision: 'REJECTED', scope: as(PROPOSER) })
    expect(res.ok && res.outcome.report).toBe('REJECTED')
    expect(await tasksWritten()).toHaveLength(0)
  })
})

describe('F2 — only the proposer decides (batch)', () => {
  it('a same-agency colleague cannot approve or reject the plan', async () => {
    const pending = await pendingBatch()
    for (const decision of ['APPROVED', 'REJECTED'] as const) {
      const res = await decideOnBatch({ planId: pending.planId!, planHash: pending.planHash!, decision, scope: as(COLLEAGUE) })
      expect(res).toEqual({ ok: false, reason: 'not-proposer' })
    }
    expect(await decisionsRecorded()).toHaveLength(0)
    expect(await tasksWritten()).toHaveLength(0)
  })

  it('the proposer approves the whole set', async () => {
    const pending = await pendingBatch()
    const res = await decideOnBatch({ planId: pending.planId!, planHash: pending.planHash!, decision: 'APPROVED', scope: as(PROPOSER) })
    expect(res.ok && res.outcome.report).toBe('ALL_SUCCEEDED')
    expect(await tasksWritten()).toHaveLength(LEADS.length)
  })
})

describe('F3 — a pending action follows the CURRENT rollout', () => {
  it('single: removed from rollout → the proposer cannot approve; restored → can', async () => {
    const pending = await pendingAction()
    const hash = await argsHashOf(pending.actionId!)

    enableAgentFor([OTHER_AGENCY]) // this agency is no longer on /agent
    const refused = await decideOnAction({ actionId: pending.actionId!, argsHash: hash, decision: 'APPROVED', scope: as(PROPOSER) })
    expect(refused).toEqual({ ok: false, reason: 'agent-disabled' })
    expect(await decisionsRecorded()).toHaveLength(0)
    expect(await tasksWritten()).toHaveLength(0)

    enableAgentFor([AGENCY])
    const approved = await decideOnAction({ actionId: pending.actionId!, argsHash: hash, decision: 'APPROVED', scope: as(PROPOSER) })
    expect(approved.ok && approved.outcome.report).toBe('VERIFIED_SUCCESS')
  })

  it('batch: removed from rollout → the plan cannot be approved or rejected', async () => {
    const pending = await pendingBatch()
    enableAgentFor([OTHER_AGENCY])
    for (const decision of ['APPROVED', 'REJECTED'] as const) {
      const res = await decideOnBatch({ planId: pending.planId!, planHash: pending.planHash!, decision, scope: as(PROPOSER) })
      expect(res).toEqual({ ok: false, reason: 'agent-disabled' })
    }
    expect(await decisionsRecorded()).toHaveLength(0)
    expect(await tasksWritten()).toHaveLength(0)
  })

  it('turning AI off entirely also stops a pending decision', async () => {
    const pending = await pendingAction()
    const hash = await argsHashOf(pending.actionId!)
    vi.stubEnv('AI_ENABLED', '0')
    const { _resetAiEnvCacheForTests } = await import('@/lib/ai/env')
    _resetAiEnvCacheForTests()
    const res = await decideOnAction({ actionId: pending.actionId!, argsHash: hash, decision: 'APPROVED', scope: as(PROPOSER) })
    expect(res).toEqual({ ok: false, reason: 'agent-disabled' })
    expect(await tasksWritten()).toHaveLength(0)
  })

  it('an agency excluded while still allowlisted cannot decide either — exclusion wins over the list', async () => {
    const pending = await pendingAction()
    const hash = await argsHashOf(pending.actionId!)
    process.env.AGENT_EXCLUDED_AGENCY_IDS = String(AGENCY)
    try {
      for (const decision of ['APPROVED', 'REJECTED'] as const) {
        const res = await decideOnAction({ actionId: pending.actionId!, argsHash: hash, decision, scope: as(PROPOSER) })
        expect(res).toEqual({ ok: false, reason: 'agent-disabled' })
      }
      expect(await decisionsRecorded()).toHaveLength(0)
      expect(await tasksWritten()).toHaveLength(0)
    } finally {
      delete process.env.AGENT_EXCLUDED_AGENCY_IDS
    }
  })
})
