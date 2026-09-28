/**
 * Batch expansion, bounds and aggregation — the deterministic half.
 *
 * The model chooses which leads qualify; everything below decides what actually
 * happens to them, and none of it can be influenced by the model. These are the
 * rules that keep "one action across many leads" from becoming "a bulk mutation
 * nobody reviewed".
 */
import { describe, expect, it } from 'vitest'
import { createEvidenceCollector } from '@/lib/agent/evidence'
import { groundedBatch } from '@/lib/agent/batchGate'
import { aggregateBatch, expandBatch, planHashOf, refusedBatch } from '@/lib/agent/actions/batch'
import { MAX_BATCH_TARGETS } from '@/lib/agent/actions/batchLimits'
import type { ActionActor, ActionOutcome, ActionPlanOutcome } from '@/lib/agent/actions/types'
import type { ProposedBatch } from '@/lib/agent/types'

const ACTOR: ActionActor = { agencyId: 7, userId: 3, role: 'ADMIN', gotPermIds: [] }
const batch = (targets: number[]): ProposedBatch => ({
  actionType: 'create_task',
  targets,
  args: { title: 'לחזור אליו', dueDate: '2026-09-10' },
  evidenceRefs: targets.map((t) => `lead:${t}`),
})

function evidenceFor(ids: number[]) {
  const e = createEvidenceCollector()
  for (const id of ids) e.add({ kind: 'lead', refId: String(id) })
  return e
}

// ── the evidence gate ───────────────────────────────────────────────────────

describe('every target must be a lead the tools returned', () => {
  it('keeps a batch whose targets are all grounded', () => {
    expect(groundedBatch(batch([1, 2, 3]), evidenceFor([1, 2, 3]))?.targets).toEqual([1, 2, 3])
  })

  it('drops the WHOLE batch when one target is ungrounded', () => {
    /**
     * Not trimmed to the grounded subset. The rep asked about "all the leads
     * with no next step"; quietly acting on four of five is a different
     * instruction than the one they gave.
     */
    expect(groundedBatch(batch([1, 2, 999]), evidenceFor([1, 2]))).toBeNull()
  })

  it('drops a batch with a repeated target', () => {
    // Two identical tasks on one lead is never what was meant.
    expect(groundedBatch(batch([1, 1, 2]), evidenceFor([1, 2]))).toBeNull()
  })

  it('drops an empty, non-task or absurd batch', () => {
    expect(groundedBatch(batch([]), evidenceFor([]))).toBeNull()
    expect(groundedBatch({ ...batch([1]), actionType: 'create_meeting' as never }, evidenceFor([1]))).toBeNull()
    const huge = Array.from({ length: MAX_BATCH_TARGETS * 10 + 1 }, (_, i) => i + 1)
    expect(groundedBatch(batch(huge), evidenceFor(huge))).toBeNull()
  })

  it('drops a non-integer or non-positive id', () => {
    for (const bad of [0, -1, 1.5]) {
      expect(groundedBatch(batch([1, bad]), evidenceFor([1, bad])), String(bad)).toBeNull()
    }
  })
})

// ── expansion and bounds ────────────────────────────────────────────────────

describe('expansion produces ordinary independent actions', () => {
  const expand = (targets: number[]) => expandBatch({ batch: batch(targets), actor: ACTOR, agentRunId: 'run_b' })

  it('creates one proposal per target, each with its own identity', () => {
    const out = expand([3, 1, 2])
    expect(out.ok).toBe(true)
    if (out.ok !== true) return
    expect(out.plan.actions).toHaveLength(3)
    // Sorted, so the same set always expands identically.
    expect(out.plan.actions.map((a) => a.args.clientId)).toEqual([1, 2, 3])
    // Independent identities and independent idempotency.
    expect(new Set(out.plan.actions.map((a) => a.actionId)).size).toBe(3)
    expect(new Set(out.plan.actions.map((a) => a.idempotencyKey)).size).toBe(3)
    // One plan.
    expect(new Set(out.plan.actions.map((a) => a.planId)).size).toBe(1)
  })

  it('stamps the authenticated actor on every member', () => {
    const out = expand([1, 2])
    if (out.ok !== true) throw new Error('expected expansion')
    for (const action of out.plan.actions) {
      expect(action.agencyId).toBe(7)
      expect(action.actor).toEqual(ACTOR)
    }
  })

  it('accepts exactly the maximum', () => {
    const at = Array.from({ length: MAX_BATCH_TARGETS }, (_, i) => i + 1)
    expect(expand(at).ok).toBe(true)
  })

  it('refuses one over the maximum, WHOLE, with the real count', () => {
    /**
     * Executing the first ten of eleven silently would leave the rep believing
     * the job was done. They are told how many actually match.
     */
    const over = Array.from({ length: MAX_BATCH_TARGETS + 1 }, (_, i) => i + 1)
    const out = expand(over)
    expect(out).toMatchObject({ ok: false, reason: 'OVER_LIMIT', eligible: MAX_BATCH_TARGETS + 1, limit: MAX_BATCH_TARGETS })
  })

  it('reports an empty set as NO_ACTIONS, never as failure', () => {
    expect(expand([])).toMatchObject({ ok: false, reason: 'NO_ACTIONS', eligible: 0 })
  })
})

// ── the plan hash ───────────────────────────────────────────────────────────

describe('the plan hash binds the composition', () => {
  const hashOf = (targets: number[]) => {
    const out = expandBatch({ batch: batch(targets), actor: ACTOR, agentRunId: 'run_b' })
    if (out.ok !== true) throw new Error('expected expansion')
    return out.planHash
  }

  it('is stable for the same set in any order', () => {
    expect(hashOf([1, 2, 3])).toBe(hashOf([3, 2, 1]))
  })

  it('changes when a lead is added or removed', () => {
    expect(hashOf([1, 2, 3])).not.toBe(hashOf([1, 2]))
    expect(hashOf([1, 2, 3])).not.toBe(hashOf([1, 2, 3, 4]))
  })

  it('changes when the shared arguments change', () => {
    const a = expandBatch({ batch: batch([1, 2]), actor: ACTOR, agentRunId: 'r' })
    const b = expandBatch({
      batch: { ...batch([1, 2]), args: { title: 'משהו אחר', dueDate: '2026-09-10' } },
      actor: ACTOR,
      agentRunId: 'r',
    })
    if (a.ok !== true || b.ok !== true) throw new Error('expected expansion')
    expect(a.planHash).not.toBe(b.planHash)
  })

  it('changes when the action type changes', () => {
    expect(planHashOf([{ actionType: 'create_task', argsHash: 'x' }]))
      .not.toBe(planHashOf([{ actionType: 'create_follow_up', argsHash: 'x' }]))
  })
})

// ── aggregation ─────────────────────────────────────────────────────────────

describe('aggregation never rounds', () => {
  const outcome = (report: string): ActionOutcome =>
    ({ report, verification: null, execution: { status: 'SUCCESS' } }) as unknown as ActionOutcome
  const plan = (reports: string[]): ActionPlanOutcome =>
    ({ planId: 'p', agentRunId: 'r', outcomes: reports.map(outcome), summary: {} as never, report: 'PARTIAL' })
  const meta = { actionType: 'create_task', planHash: 'h', eligible: 0, limit: MAX_BATCH_TARGETS }

  it('all verified is ALL_SUCCEEDED', () => {
    expect(aggregateBatch(plan(['VERIFIED_SUCCESS', 'VERIFIED_SUCCESS']), meta).report).toBe('ALL_SUCCEEDED')
  })

  it('six of seven is PARTIAL_SUCCESS, in both directions', () => {
    const r = aggregateBatch(plan([...Array(6).fill('VERIFIED_SUCCESS'), 'FAILED']), meta)
    expect(r.report).toBe('PARTIAL_SUCCESS')
    expect(r.summary).toMatchObject({ total: 7, verified: 6, failed: 1 })
  })

  it('nothing landed is ALL_FAILED', () => {
    expect(aggregateBatch(plan(['FAILED', 'NOT_EXECUTED']), meta).report).toBe('ALL_FAILED')
  })

  it('a re-run of a finished batch is ALL_SUCCEEDED, not ALL_FAILED', () => {
    // Every member is a duplicate: the rep's intent — these leads have tasks —
    // is satisfied, and it is still reported separately from "created".
    const r = aggregateBatch(plan(['DUPLICATE_NOOP', 'DUPLICATE_NOOP']), meta)
    expect(r.report).toBe('ALL_SUCCEEDED')
    expect(r.summary).toMatchObject({ verified: 0, duplicates: 2 })
  })

  it('all awaiting is its own state, not a failure', () => {
    expect(aggregateBatch(plan(['AWAITING_APPROVAL', 'AWAITING_APPROVAL']), meta).report).toBe('AWAITING_APPROVAL')
  })

  it('unverified execution is counted apart from success and failure', () => {
    const r = aggregateBatch(plan(['VERIFIED_SUCCESS', 'EXECUTED_UNVERIFIED', 'UNKNOWN_RECONCILE']), meta)
    expect(r.report).toBe('PARTIAL_SUCCESS')
    expect(r.summary.unknown).toBe(2)
  })

  it('an empty plan is NO_ACTIONS', () => {
    expect(aggregateBatch(plan([]), meta).report).toBe('NO_ACTIONS')
  })

  it('a refusal reports its reason and ran nothing', () => {
    expect(refusedBatch('create_task', 'OVER_LIMIT', 47, 10)).toMatchObject({
      report: 'OVER_LIMIT', eligible: 47, limit: 10, planId: null, outcomes: [],
    })
    expect(refusedBatch('create_task', 'NO_ACTIONS', 0, 10).report).toBe('NO_ACTIONS')
  })
})
