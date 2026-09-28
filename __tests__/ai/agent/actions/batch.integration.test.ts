/**
 * A batch, end to end, against a real database.
 *
 * THE CLAIM UNDER TEST is that batching is orchestration and nothing more: N
 * ordinary actions, each with its own policy check, its own idempotency claim,
 * its own verification and its own audit row — and no bulk mutation anywhere.
 * The way to prove that is to count rows in `tasks` and `agent_actions` after
 * every interesting failure, which a mock cannot do.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { enableAgentFor, restoreAgentRollout } from './_agentRollout'

vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

const generateTextSpy = vi.hoisted(() => vi.fn())
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return { ...actual, generateText: generateTextSpy }
})

import { db } from '@/config/db'
import { listActionsForPlan } from '@/db/agentActions'
import { submitProposedBatch, decideOnBatch } from '@/lib/agent/actions/bridge'
import { registerDomainActions } from '@/lib/agent/actions/domain'
import { MAX_BATCH_TARGETS } from '@/lib/agent/actions/batchLimits'
import { createEvidenceCollector } from '@/lib/agent/evidence'
import { validateAgentAnswerDetailed } from '@/lib/agent/validate'
import { Roles } from '@/types/roles'
import type { AgentAnswer, AgentScope, ProposedBatch } from '@/lib/agent/types'
import type { BatchOutcome } from '@/lib/agent/actions/batch'

const AGENCY_A = 96_001
const AGENCY_B = 96_002
const ADMIN_A = 96_101
const ADMIN_B = 96_102
const REP_A = 96_103
/** Twelve, so the maximum and one-over-the-maximum are both reachable. */
const LEADS_A: number[] = []
let LEAD_B = 0
let LEAD_OWNED = 0

const TITLE = 'לחזור אליו'
const DUE = '2026-09-10'
const COMMAND = 'תיצור משימה לכל הלידים שאין להם צעד הבא'

const adminA = (): AgentScope => ({ agencyId: AGENCY_A, userId: ADMIN_A, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'א' })
const rep = (gotPermIds: number[]): AgentScope => ({ agencyId: AGENCY_A, userId: REP_A, role: Roles.AGNT, gotPermIds, plan: 'pro', firstName: 'נ' })

const batch = (targets: number[], over: Partial<{ title: string; dueDate: string }> = {}): ProposedBatch => ({
  actionType: 'create_task',
  targets,
  args: { title: TITLE, dueDate: DUE, ...over },
  evidenceRefs: targets.map((t) => `lead:${t}`),
})

let seq = 0
const submit = (b: ProposedBatch, scope: AgentScope, userMessage: string, runId?: string) =>
  submitProposedBatch({ batch: b, scope, agentRunId: runId ?? `run_b_${++seq}`, userMessage }) as Promise<BatchOutcome>

const tasksIn = (leadIds: number[]) => db('tasks').whereIn('clientId', leadIds)

async function seedLead(agencyId: number, createdById: number, userId?: number): Promise<number> {
  const [row] = await db('clients')
    .insert({ firstName: 'ליד', lastName: String(Math.random()).slice(2, 8), agencyId, createdById, lead: true, ...(userId ? { userId } : {}) })
    .returning('id')
  return typeof row === 'object' ? (row as { id: number }).id : (row as number)
}

beforeAll(async () => {
  enableAgentFor([AGENCY_A, AGENCY_B])
  registerDomainActions()
  for (const [agencyId, adminId] of [[AGENCY_A, ADMIN_A], [AGENCY_B, ADMIN_B]] as const) {
    await db('agencies').insert({
      id: agencyId, name: `b-${agencyId}`, plan: 'pro', country: 'IL',
      defaultCurrency: 'ILS', locale: 'he', docNumberFormat: '{n}', bankDetails: '{}',
    } as never).onConflict('id').ignore()
    await db('users').insert({ id: adminId, agencyId, email: `b${adminId}@t.test`, role: 'ADMIN', firstName: 'מנהל', lastName: String(adminId) })
      .onConflict('id').ignore()
  }
  await db('users').insert({ id: REP_A, agencyId: AGENCY_A, email: `b${REP_A}@t.test`, role: 'AGNT', firstName: 'נציג', lastName: 'א' })
    .onConflict('id').ignore()
  for (let i = 0; i < MAX_BATCH_TARGETS + 2; i++) LEADS_A.push(await seedLead(AGENCY_A, ADMIN_A))
  LEAD_B = await seedLead(AGENCY_B, ADMIN_B)
  LEAD_OWNED = await seedLead(AGENCY_A, ADMIN_A, REP_A)
})

afterEach(async () => {
  await db('tasks').whereIn('clientId', [...LEADS_A, LEAD_B, LEAD_OWNED]).del()
  await db('agent_action_approvals').whereIn('agencyId', [AGENCY_A, AGENCY_B]).del()
  await db('agent_actions').whereIn('agencyId', [AGENCY_A, AGENCY_B]).del()
  generateTextSpy.mockClear()
})

afterAll(async () => {
  restoreAgentRollout()
  await db('clients').whereIn('id', [...LEADS_A, LEAD_B, LEAD_OWNED]).del()
  await db('users').whereIn('id', [ADMIN_A, ADMIN_B, REP_A]).del()
  await db('agencies').whereIn('id', [AGENCY_A, AGENCY_B]).del()
})

// ── size ────────────────────────────────────────────────────────────────────

describe('batch size', () => {
  it('1 — a single target still goes through the batch path', async () => {
    const out = await submit(batch([LEADS_A[0]!]), adminA(), COMMAND)
    expect(out.report).toBe('ALL_SUCCEEDED')
    expect(out.summary).toMatchObject({ total: 1, verified: 1 })
    expect(await tasksIn(LEADS_A)).toHaveLength(1)
  })

  it('2 — several targets create one task each', async () => {
    const targets = LEADS_A.slice(0, 4)
    const out = await submit(batch(targets), adminA(), COMMAND)
    expect(out.report).toBe('ALL_SUCCEEDED')
    expect(out.summary.verified).toBe(4)
    const rows = await tasksIn(targets)
    expect(rows).toHaveLength(4)
    // One task per lead — never two on one, never none on another.
    expect(new Set(rows.map((r) => r.clientId)).size).toBe(4)
  })

  it('3 — zero eligible targets is NO_ACTIONS, and touches nothing', async () => {
    const out = await submit(batch([]), adminA(), COMMAND)
    expect(out.report).toBe('NO_ACTIONS')
    expect(out.planId).toBeNull()
    expect(await tasksIn(LEADS_A)).toHaveLength(0)
    // Never reached the runtime, so it left no audit row either.
    expect(await db('agent_actions').where({ agencyId: AGENCY_A })).toHaveLength(0)
  })

  it('4 — exactly the maximum runs', async () => {
    const targets = LEADS_A.slice(0, MAX_BATCH_TARGETS)
    const out = await submit(batch(targets), adminA(), COMMAND)
    expect(out.report).toBe('ALL_SUCCEEDED')
    expect(await tasksIn(targets)).toHaveLength(MAX_BATCH_TARGETS)
  })

  it('5 — one over the maximum runs NOTHING and reports the real count', async () => {
    const targets = LEADS_A.slice(0, MAX_BATCH_TARGETS + 1)
    const out = await submit(batch(targets), adminA(), COMMAND)
    expect(out).toMatchObject({ report: 'OVER_LIMIT', eligible: MAX_BATCH_TARGETS + 1, limit: MAX_BATCH_TARGETS })
    // Emphatically not a partial execution of the first ten.
    expect(await tasksIn(targets)).toHaveLength(0)
    expect(await db('agent_actions').where({ agencyId: AGENCY_A })).toHaveLength(0)
  })
})

// ── tenancy and permissions ─────────────────────────────────────────────────

describe('tenancy and permissions apply per action', () => {
  it('6 — a cross-tenant candidate is refused without blocking the rest', async () => {
    const targets = [LEADS_A[0]!, LEAD_B, LEADS_A[1]!]
    const out = await submit(batch(targets), adminA(), COMMAND)
    expect(out.report).toBe('PARTIAL_SUCCESS')
    expect(out.summary).toMatchObject({ total: 3, verified: 2, failed: 1 })
    expect(await tasksIn([LEAD_B])).toHaveLength(0)
  })

  it('7 — a non-owned lead is refused for a rep, and the owned one succeeds', async () => {
    const out = await submit(batch([LEAD_OWNED, LEADS_A[0]!]), rep([REP_A]), COMMAND)
    expect(out.report).toBe('PARTIAL_SUCCESS')
    expect(await tasksIn([LEAD_OWNED])).toHaveLength(1)
    expect(await tasksIn([LEADS_A[0]!])).toHaveLength(0)
  })
})

// ── authorization ───────────────────────────────────────────────────────────

describe('authorization is the same as for one action', () => {
  it('8 — an explicit command executes with no approval', async () => {
    const out = await submit(batch(LEADS_A.slice(0, 3)), adminA(), COMMAND)
    expect(out.report).toBe('ALL_SUCCEEDED')
    expect(out.outcomes.every((o) => o.approval === 'NOT_REQUIRED')).toBe(true)
  })

  it('9 — an agent-initiated batch waits, and writes nothing', async () => {
    const out = await submit(batch(LEADS_A.slice(0, 3)), adminA(), 'מה הבעיה הכי גדולה שלי?')
    expect(out.report).toBe('AWAITING_APPROVAL')
    expect(out.summary.awaitingApproval).toBe(3)
    expect(await tasksIn(LEADS_A)).toHaveLength(0)
  })

  it('10 — a hedged request never executes', async () => {
    const out = await submit(batch(LEADS_A.slice(0, 3)), adminA(), 'אולי כדאי ליצור משימות לכולם')
    expect(out.report).toBe('AWAITING_APPROVAL')
    expect(await tasksIn(LEADS_A)).toHaveLength(0)
  })
})

// ── approval ────────────────────────────────────────────────────────────────

describe('one decision for the whole set', () => {
  it('11 — approval executes every member', async () => {
    const targets = LEADS_A.slice(0, 3)
    const proposed = await submit(batch(targets), adminA(), 'מה קורה בעסק?')
    const decided = await decideOnBatch({
      planId: proposed.planId!, planHash: proposed.planHash!, decision: 'APPROVED', scope: adminA(),
    })
    expect(decided.ok && decided.outcome.report).toBe('ALL_SUCCEEDED')
    expect(await tasksIn(targets)).toHaveLength(3)
    // One grant per member — a plan-level grant cannot authorise differing hashes.
    expect(await db('agent_action_approvals').where({ agencyId: AGENCY_A })).toHaveLength(3)
  })

  it('11b — rejection executes nothing', async () => {
    const proposed = await submit(batch(LEADS_A.slice(0, 3)), adminA(), 'מה קורה בעסק?')
    const decided = await decideOnBatch({
      planId: proposed.planId!, planHash: proposed.planHash!, decision: 'REJECTED', scope: adminA(),
    })
    expect(decided.ok && decided.outcome.report).toBe('ALL_FAILED')
    expect(await tasksIn(LEADS_A)).toHaveLength(0)
  })

  it('12 — a hash from a DIFFERENT batch cannot approve this one', async () => {
    /**
     * The composition guard. Per-action grants already stop a member's arguments
     * changing; this stops a member being added or removed between what the rep
     * read and what would run.
     */
    const proposed = await submit(batch(LEADS_A.slice(0, 3)), adminA(), 'מה קורה בעסק?')
    const other = await submit(batch(LEADS_A.slice(0, 4)), adminA(), 'מה קורה בעסק?', 'run_other')
    const decided = await decideOnBatch({
      planId: proposed.planId!, planHash: other.planHash!, decision: 'APPROVED', scope: adminA(),
    })
    expect(decided).toEqual({ ok: false, reason: 'batch-changed' })
    expect(await tasksIn(LEADS_A)).toHaveLength(0)
  })

  it('12b — another tenant cannot approve this plan', async () => {
    const proposed = await submit(batch(LEADS_A.slice(0, 2)), adminA(), 'מה קורה בעסק?')
    const decided = await decideOnBatch({
      planId: proposed.planId!, planHash: proposed.planHash!, decision: 'APPROVED',
      scope: { ...adminA(), agencyId: AGENCY_B, userId: ADMIN_B },
    })
    expect(decided).toEqual({ ok: false, reason: 'not-found' })
    expect(await tasksIn(LEADS_A)).toHaveLength(0)
  })
})

// ── idempotency ─────────────────────────────────────────────────────────────

describe('idempotency is per action, not per batch', () => {
  it('13 — concurrent identical batches create one task each', async () => {
    const targets = LEADS_A.slice(0, 3)
    const outs = await Promise.all([
      submit(batch(targets), adminA(), COMMAND, 'run_conc'),
      submit(batch(targets), adminA(), COMMAND, 'run_conc'),
      submit(batch(targets), adminA(), COMMAND, 'run_conc'),
    ])
    expect(await tasksIn(targets)).toHaveLength(3)
    expect(outs.filter((o) => o.report === 'ALL_SUCCEEDED').length).toBeGreaterThan(0)
  })

  it('14 — a replayed batch becomes duplicates, not new tasks', async () => {
    const targets = LEADS_A.slice(0, 3)
    const first = await submit(batch(targets), adminA(), COMMAND, 'run_replay')
    const second = await submit(batch(targets), adminA(), COMMAND, 'run_replay')
    expect(first.summary.verified).toBe(3)
    expect(second.summary.duplicates).toBe(3)
    expect(second.report).toBe('ALL_SUCCEEDED')
    expect(await tasksIn(targets)).toHaveLength(3)
  })

  it('14b — a batch with a different title is a different batch', async () => {
    const targets = LEADS_A.slice(0, 2)
    await submit(batch(targets), adminA(), COMMAND, 'run_diff')
    const second = await submit(batch(targets, { title: 'כותרת אחרת' }), adminA(), COMMAND, 'run_diff')
    expect(second.summary.verified).toBe(2)
    expect(await tasksIn(targets)).toHaveLength(4)
  })

  it('14c — overlapping batches only create what is missing', async () => {
    await submit(batch(LEADS_A.slice(0, 2)), adminA(), COMMAND, 'run_overlap')
    const second = await submit(batch(LEADS_A.slice(0, 4)), adminA(), COMMAND, 'run_overlap')
    expect(second.summary).toMatchObject({ total: 4, verified: 2, duplicates: 2 })
    expect(await tasksIn(LEADS_A)).toHaveLength(4)
  })
})

// ── aggregation, audit, cost ────────────────────────────────────────────────

describe('what the batch reports and records', () => {
  it('15+17 — a partial batch reports the split, never a single verdict', async () => {
    const out = await submit(batch([LEADS_A[0]!, LEAD_B, LEADS_A[1]!, 99_999_999]), adminA(), COMMAND)
    expect(out.report).toBe('PARTIAL_SUCCESS')
    expect(out.summary).toMatchObject({ total: 4, verified: 2, failed: 2 })
  })

  it('16 — every member is verified against the database individually', async () => {
    const targets = LEADS_A.slice(0, 3)
    const out = await submit(batch(targets), adminA(), COMMAND)
    for (const o of out.outcomes) {
      expect(o.verification?.verified).toBe(true)
      expect(o.verification!.checks).toHaveLength(5)
    }
  })

  it('18 — each action has its own audit row, sharing one plan id', async () => {
    const targets = LEADS_A.slice(0, 3)
    const out = await submit(batch(targets), adminA(), COMMAND)
    const rows = await listActionsForPlan(AGENCY_A, out.planId!)
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row).toMatchObject({
        actionType: 'create_task', intent: 'EXPLICIT_COMMAND',
        executionState: 'SUCCEEDED', verificationState: 'VERIFIED', planId: out.planId,
      })
    }
    // Independently auditable: distinct ids, distinct idempotency keys.
    expect(new Set(rows.map((r) => r.actionId)).size).toBe(3)
    expect(new Set(rows.map((r) => r.idempotencyKey)).size).toBe(3)
  })

  it('19 — no model call per mutation, or at all', async () => {
    await submit(batch(LEADS_A.slice(0, MAX_BATCH_TARGETS)), adminA(), COMMAND)
    // Ten mutations, zero conversations. Expansion is deterministic code.
    expect(generateTextSpy).not.toHaveBeenCalled()
  })

  it('20 — evaluating an answer that CONTAINS a batch mutates nothing', async () => {
    /**
     * The intelligence half runs on every question, including ones nobody
     * approved. Producing and grounding a `proposedBatch` is evaluation: it
     * decides what COULD be asked for, and the runtime alone decides whether
     * anything happens. If validation could write, every investigation would be
     * a mutation and the approval gate would be decoration.
     */
    const targets = LEADS_A.slice(0, 3)
    const evidence = createEvidenceCollector()
    for (const id of targets) evidence.add({ kind: 'lead', refId: String(id) })

    const answer: AgentAnswer = {
      headline: 'שלושה לידים בלי צעד הבא.',
      claims: [{ claimClass: 'FACT', text: 'שלושה לידים ללא צעד הבא.', entityEvidence: targets.map(String) }],
      unknown: null,
      proposedBatch: batch(targets),
    }

    const validated = validateAgentAnswerDetailed(answer, evidence)

    // The proposal survives evaluation — and stays a proposal.
    expect(validated.answer.proposedBatch?.targets).toEqual(targets)
    expect(await tasksIn(targets)).toHaveLength(0)
    expect(await db('agent_actions').where({ agencyId: AGENCY_A })).toHaveLength(0)
    expect(await db('agent_action_approvals').where({ agencyId: AGENCY_A })).toHaveLength(0)
  })
})
