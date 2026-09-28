import { createHash, randomUUID } from 'node:crypto'
import { MAX_BATCH_TARGETS } from './batchLimits'
import { canonicalJson } from './idempotency'
import { parseActionProposal } from './proposal'
import type { ActionActor, ActionOutcome, ActionPlan, ActionPlanOutcome, ActionProposal } from './types'
import type { ProposedBatch } from '../types'

/**
 * Batching is ORCHESTRATION, not a second execution runtime.
 *
 * Everything here happens above `lib/agent/actions/*`, which is frozen and
 * unchanged. A batch is expanded into N ordinary `ActionProposal`s — each with
 * its own action id, its own idempotency key, its own policy evaluation, its own
 * verification and its own audit row — and handed to the existing
 * `executePlan`. There is no bulk mutation anywhere; the word "batch" describes
 * how the actions were PROPOSED, never how they run.
 *
 * TWO LIMITATIONS IN THE FROZEN CONTRACT ARE WORKED AROUND HERE RATHER THAN
 * PATCHED INTO IT, and both are worth stating plainly:
 *
 *   1. A PLAN-LEVEL APPROVAL GRANT CANNOT AUTHORISE A MULTI-ACTION PLAN.
 *      `grantApplies` requires `grant.argsHash === action.argsHash` even when
 *      the grant names a `planId`, and every action in a batch has a different
 *      args hash — so one plan grant matches at most one action. Approving a
 *      batch therefore writes ONE GRANT PER ACTION, each bound to that action's
 *      own hash, which the approval model already supports untouched and which
 *      is strictly stronger: changing any single target, title or date voids
 *      that action's grant specifically. `planHash` then guards the SET, so an
 *      action cannot be added to or removed from an approved batch either.
 *
 *   2. `ActionPlanOutcome` CANNOT EXPRESS "NOTHING WAS ELIGIBLE". An empty plan
 *      yields `verified === 0`, which the runtime reports as NONE_EXECUTED —
 *      indistinguishable from "everything failed". So an empty or over-limit
 *      batch is answered HERE and never reaches the runtime at all.
 *
 * Neither required editing the runtime, which is why it was not edited.
 */

export type BatchReport =
  /** Every action verified against the source of truth. */
  | 'ALL_SUCCEEDED'
  /** Some verified, some not. Never rounded in either direction. */
  | 'PARTIAL_SUCCESS'
  /** Nothing landed. */
  | 'ALL_FAILED'
  /** The agent proposed it; a human has not said yes yet. */
  | 'AWAITING_APPROVAL'
  /** Nothing matched. Distinct from "everything failed". */
  | 'NO_ACTIONS'
  /** More candidates than one batch may touch. Nothing ran. */
  | 'OVER_LIMIT'

export type BatchExpansion =
  | { ok: false; reason: 'NO_ACTIONS' | 'OVER_LIMIT' | 'MALFORMED'; eligible: number; limit: number }
  | { ok: true; plan: ActionPlan; planHash: string }

/**
 * The identity of a SET of actions.
 *
 * Each action's own `argsHash` already stops its arguments changing under an
 * approval. This stops the composition changing: add a lead, drop a lead, or
 * swap the action type, and the hash moves, so a grant issued against the batch
 * a rep read no longer describes the batch about to run.
 *
 * Order-independent by construction — the entries are sorted — because the model
 * does not emit targets in a stable order and a reshuffle is not a different
 * batch.
 */
export function planHashOf(actions: readonly { actionType: string; argsHash: string }[]): string {
  const entries = actions.map((a) => `${a.actionType}:${a.argsHash}`).sort()
  return createHash('sha256').update(canonicalJson(entries)).digest('hex').slice(0, 32)
}

/**
 * Turn one batch proposal into N independent action proposals.
 *
 * Targets are sorted so the same set always expands identically, which is what
 * makes `planHash` and every derived idempotency key stable across turns.
 */
export function expandBatch(input: {
  batch: ProposedBatch
  actor: ActionActor
  agentRunId: string
  planId?: string
}): BatchExpansion {
  const limit = MAX_BATCH_TARGETS
  const targets = [...new Set(input.batch.targets)].sort((a, b) => a - b)

  if (targets.length === 0) return { ok: false, reason: 'NO_ACTIONS', eligible: 0, limit }
  /**
   * Refused whole, with the real count. Running the first ten of forty-seven
   * would leave the rep believing the job was done.
   */
  if (targets.length > limit) return { ok: false, reason: 'OVER_LIMIT', eligible: targets.length, limit }

  const planId = input.planId ?? `plan_${randomUUID()}`
  const actions: ActionProposal[] = []

  for (const clientId of targets) {
    const parsed = parseActionProposal(
      {
        actionType: input.batch.actionType,
        args: { clientId, title: input.batch.args.title, dueDate: input.batch.args.dueDate },
        evidenceRefs: [`lead:${clientId}`],
        expectedPostcondition: { clientId },
      },
      { agentRunId: input.agentRunId, actor: input.actor, actionId: `act_${randomUUID()}`, planId },
    )
    // One unparseable member invalidates the batch: a rep who asked for "all of
    // them" must not silently get most of them.
    if (parsed.ok === false) return { ok: false, reason: 'MALFORMED', eligible: targets.length, limit }
    actions.push(parsed.proposal)
  }

  return { ok: true, plan: { planId, agentRunId: input.agentRunId, actions }, planHash: planHashOf(actions) }
}

export type BatchOutcome = {
  planId: string | null
  planHash: string | null
  actionType: string
  report: BatchReport
  /** How many leads the batch would have touched, before any limit applied. */
  eligible: number
  limit: number
  summary: { total: number; verified: number; duplicates: number; failed: number; awaitingApproval: number; unknown: number }
  outcomes: ActionOutcome[]
}

const EMPTY_SUMMARY = { total: 0, verified: 0, duplicates: 0, failed: 0, awaitingApproval: 0, unknown: 0 }

/** A refusal that never reached the runtime, in the shape a caller can render. */
export function refusedBatch(
  actionType: string,
  reason: 'NO_ACTIONS' | 'OVER_LIMIT' | 'MALFORMED',
  eligible: number,
  limit: number,
): BatchOutcome {
  return {
    planId: null,
    planHash: null,
    actionType,
    // A malformed expansion produced nothing and ran nothing; reported as the
    // failure it is rather than as an empty result.
    report: reason === 'OVER_LIMIT' ? 'OVER_LIMIT' : reason === 'NO_ACTIONS' ? 'NO_ACTIONS' : 'ALL_FAILED',
    eligible,
    limit,
    summary: { ...EMPTY_SUMMARY },
    outcomes: [],
  }
}

/**
 * Aggregate N independent outcomes into one honest verdict.
 *
 * DUPLICATES COUNT AS SETTLED, not as failures. A batch re-submitted after it
 * succeeded produces DUPLICATE_NOOP for every member, and the rep's intent —
 * that these leads have tasks — is satisfied; calling that ALL_FAILED would be
 * false. It is still reported separately in the summary, because "created" and
 * "already existed" are different things to read.
 *
 * PARTIAL IS NEVER ROUNDED. Six of seven is six of seven, in both directions.
 */
export function aggregateBatch(
  planOutcome: ActionPlanOutcome,
  meta: { actionType: string; planHash: string; eligible: number; limit: number },
): BatchOutcome {
  const outcomes = planOutcome.outcomes
  const count = (report: string) => outcomes.filter((o) => o.report === report).length

  const summary = {
    total: outcomes.length,
    verified: count('VERIFIED_SUCCESS'),
    duplicates: count('DUPLICATE_NOOP'),
    failed: outcomes.filter((o) => o.report === 'FAILED' || o.report === 'NOT_EXECUTED' || o.report === 'REJECTED').length,
    awaitingApproval: count('AWAITING_APPROVAL'),
    unknown: outcomes.filter((o) => o.report === 'UNKNOWN_RECONCILE' || o.report === 'EXECUTED_UNVERIFIED').length,
  }

  const settled = summary.verified + summary.duplicates
  const report: BatchReport =
    summary.total === 0 ? 'NO_ACTIONS'
    : summary.awaitingApproval === summary.total ? 'AWAITING_APPROVAL'
    : settled === summary.total ? 'ALL_SUCCEEDED'
    : settled > 0 ? 'PARTIAL_SUCCESS'
    : 'ALL_FAILED'

  return {
    planId: planOutcome.planId,
    planHash: meta.planHash,
    actionType: meta.actionType,
    report,
    eligible: meta.eligible,
    limit: meta.limit,
    summary,
    outcomes,
  }
}
