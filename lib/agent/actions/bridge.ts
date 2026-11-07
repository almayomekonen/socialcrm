import 'server-only'
import { randomUUID } from 'node:crypto'
import { createDbActionStore, findActionByActionId, hasRecentlyExecutedAction, listActionsForPlan } from '@/db/agentActions'
import { loadApprovalGrants, recordApprovalDecision } from '@/db/agentActionApprovals'
import { registerDomainActions } from './domain'
import { deriveActionIntent } from './intent'
import { isAgentAvailableForUser } from '@/lib/ai/agentAvailability'
import { parseActionProposal } from './proposal'
import { createActionRuntime } from './runtime'
import { DEFAULT_DEADLINE_MS } from '../budget'
import { aggregateBatch, expandBatch, planHashOf, refusedBatch, type BatchOutcome } from './batch'
import { MAX_BATCH_TARGETS } from './batchLimits'
import type { AgentScope, ProposedAction, ProposedBatch } from '../types'
import type { ActionOutcome, ActionPlan, ActionProposal } from './types'
import type { SystemActionProposal } from './systemProposal'

/**
 * The seam between the Brain and the Action Runtime.
 *
 * THE MODEL NEVER ARRIVES HERE. What arrives is a `ProposedAction` that has
 * already survived two gates: the answer schema, which shapes it, and
 * `groundedProposal`, which drops it unless its target lead is in the evidence
 * the tools collected. This function then strips whatever identity it still
 * carries and stamps the authenticated scope, which is the last point at which
 * anything model-shaped exists.
 *
 * NO MODEL CALL HAPPENS IN THIS FILE, on either path. Proposing costs the turn
 * the investigation already paid for; approving costs nothing at all, because
 * the approved action is rebuilt from its own durable row rather than
 * regenerated. A second model call to "confirm" an action the user has just
 * confirmed would be the most expensive redundancy in the system — Phase 3a
 * measured ~15.5s of model wait against ~100ms of tool work.
 *
 * TWO ENTRY POINTS, ONE RUNTIME. Proposing and approving both run the identical
 * policy → claim → approval → execute → verify sequence; the only difference is
 * whether a grant exists yet. That is why an approval needs no special path and
 * cannot accidentally skip a check.
 */

function runtimeFor() {
  // Explicit, not an import side effect: nothing becomes executable merely
  // because a module was loaded.
  registerDomainActions()
  return createActionRuntime({ store: createDbActionStore() })
}

/**
 * How long a command can still be "in progress" before it is treated as stale.
 *
 * The outer bound on the standing-command lifecycle. The inner bound — and the
 * one that actually fires — is fulfilment: a command that produced its action is
 * spent immediately, whatever the clock says.
 */
export const STANDING_COMMAND_WINDOW_MS = 10 * 60 * 1000

/**
 * COMMAND_STARTED → COLLECTING_REQUIRED_FIELDS → READY → EXECUTED → CLOSED.
 *
 * The application owns this lifecycle, and this function is where it CLOSES. A
 * standing command authorises the turns that complete the action it asked for;
 * once that action exists, the instruction has been carried out and a later
 * fragment must stand on its own words.
 *
 * Determined from the durable action record rather than from anything the
 * client sent, because a client that could report "nothing executed yet" could
 * keep an authorization open indefinitely — which is the one direction this must
 * never fail in.
 */
async function standingCommandIsSpent(scope: AgentScope, nowMs: number): Promise<boolean> {
  // Any executed action spends it — see the note on `recentExecutedActionQuery`.
  return hasRecentlyExecutedAction({
    agencyId: scope.agencyId,
    userId: scope.userId,
    sinceMs: nowMs - STANDING_COMMAND_WINDOW_MS,
  })
}

/**
 * The authorization decision, identical for one action and for a batch.
 *
 * Derived from the rep's own words first; the standing command is consulted only
 * when the current turn is a bare value, and only while it is unspent. Shared so
 * a batch can never accidentally be authorised on softer terms than a single
 * action.
 */
async function resolveIntent(
  input: { scope: AgentScope; userMessage?: string; priorAssistantMessage?: string | null; priorUserMessages?: readonly string[] },
  _actionType: string,
  nowMs: number,
) {
  const own = deriveActionIntent({
    userMessage: input.userMessage ?? '',
    priorAssistantMessage: input.priorAssistantMessage,
  })
  if (own.intent === 'EXPLICIT_COMMAND' || (input.priorUserMessages?.length ?? 0) === 0) return own.intent

  const spent = await standingCommandIsSpent(input.scope, nowMs)
  if (spent) return own.intent

  return deriveActionIntent({
    userMessage: input.userMessage ?? '',
    priorAssistantMessage: input.priorAssistantMessage,
    priorUserMessages: input.priorUserMessages,
  }).intent
}

function scopeToActor(scope: AgentScope) {
  // The WHOLE authority the scope resolved, permissions included. An actor
  // carrying less than the scope knows is an executor that cannot reproduce the
  // product's own gate.
  return { agencyId: scope.agencyId, userId: scope.userId, role: scope.role, gotPermIds: scope.gotPermIds ?? [] }
}

/**
 * Turn 1 — the model asked to do something.
 *
 * Runs the full runtime immediately. For `create_task` that ends at
 * AWAITING_APPROVAL, which is the point: the row exists, the arguments are
 * frozen, and there is now something concrete for a human to say yes to.
 */
export async function submitProposedAction(input: {
  proposal: ProposedAction | SystemActionProposal
  scope: AgentScope
  agentRunId: string
  /**
   * A stable identity chosen by the application (reminder actions:
   * `rem_<reminderId>_v<version>_<op>`). Without it every call mints a fresh
   * random id, and a re-run would claim the SAME idempotency row while
   * reporting a NEW action id that no card can be decided against
   * (architecture v1.5 §3.2). Existing callers pass nothing and are unchanged.
   */
  identity?: { actionId: string; idempotencyKey: string }
  /**
   * The question the authenticated request carried, verbatim.
   *
   * THE AUTHORIZATION INPUT. Whether this action executes now or waits for a
   * card is decided from these words — the rep's own — and not from anything
   * the model produced. Omitting it makes the action wait, which is the safe
   * direction.
   */
  userMessage?: string
  /** The assistant turn before it, so "כן, תעשה" has something to affirm. */
  priorAssistantMessage?: string | null
  /** The rep's own recent turns, newest first, so a command survives being filled in. */
  priorUserMessages?: readonly string[]
  deadlineAtMs?: number
  nowMs?: number
}): Promise<ActionOutcome | null> {
  const nowMs = input.nowMs ?? Date.now()
  const parsed = parseActionProposal(
    {
      actionType: input.proposal.actionType,
      args: input.proposal.args,
      evidenceRefs: input.proposal.evidenceRefs ?? [],
      expectedPostcondition: input.proposal.args,
    },
    {
      agentRunId: input.agentRunId,
      actor: scopeToActor(input.scope),
      actionId: input.identity?.actionId ?? `act_${randomUUID()}`,
      idempotencyKey: input.identity?.idempotencyKey,
    },
  )
  // A proposal that cannot be parsed is not an error to surface — the answer
  // around it may be perfectly good. It simply does not become an action.
  if (parsed.ok === false) return null

  // The same derivation a batch uses — one action must never be authorised on
  // softer terms than several.
  const intent = await resolveIntent(input, parsed.proposal.actionType, nowMs)

  return runtimeFor().execute(parsed.proposal, {
    authenticated: scopeToActor(input.scope),
    deadlineAtMs: input.deadlineAtMs ?? nowMs + DEFAULT_DEADLINE_MS,
    grants: [],
    intent,
    investigationId: input.agentRunId,
  })
}

export type ActionDecisionResult =
  | { ok: false; reason: 'not-found' | 'args-changed' | 'not-proposer' | 'agent-disabled' }
  | { ok: true; outcome: ActionOutcome }

/**
 * Turn 2 — a human decided.
 *
 * `argsHash` is required from the CALLER, and it is the hash the approval UI
 * displayed. Comparing it against the stored row is what makes the approval mean
 * "yes to THIS", rather than "yes to whatever is under that id now": if the two
 * ever differ, the person approved something other than what would run, and the
 * decision is refused rather than reinterpreted.
 */
export async function decideOnAction(input: {
  actionId: string
  argsHash: string
  decision: 'APPROVED' | 'REJECTED'
  scope: AgentScope
  nowMs?: number
}): Promise<ActionDecisionResult> {
  const nowMs = input.nowMs ?? Date.now()
  // ROLLOUT IS RE-CHECKED AT DECISION TIME (F3). A card can outlive the rollout
  // that produced it; taking an agency off /agent must stop its pending actions
  // too, not only new questions. Checked before anything is read or written.
  if (!(await isAgentAvailableForUser(input.scope.agencyId, input.scope.userId))) return { ok: false, reason: 'agent-disabled' }
  // Agency-scoped read: an action id from another tenant simply does not exist.
  const record = await findActionByActionId(input.scope.agencyId, input.actionId)
  if (!record) return { ok: false, reason: 'not-found' }
  // ONLY THE PROPOSER DECIDES (F2). The action was proposed in one rep's
  // conversation, on that rep's question; a colleague holding its id is not
  // that rep. Refused before a grant — or a rejection — is ever recorded.
  if (record.userId !== input.scope.userId) return { ok: false, reason: 'not-proposer' }
  if (record.argsHash !== input.argsHash) return { ok: false, reason: 'args-changed' }

  await recordApprovalDecision({
    agencyId: record.agencyId,
    actionId: record.actionId,
    planId: record.planId,
    argsHash: record.argsHash,
    decision: input.decision,
    decidedByUserId: input.scope.userId,
    nowMs,
  })

  const grants = await loadApprovalGrants({
    agencyId: record.agencyId,
    actionId: record.actionId,
    planId: record.planId,
  })

  /**
   * Rebuilt from the DURABLE ROW, never from anything the client sent. The
   * client supplies an id and a hash it must already match; the arguments that
   * execute are the ones the runtime stored when the action was proposed.
   */
  const proposal: ActionProposal = {
    actionId: record.actionId,
    agentRunId: record.agentRunId,
    agencyId: record.agencyId,
    actor: scopeToActor(input.scope),
    actionType: record.actionType,
    args: record.args,
    argsHash: record.argsHash,
    evidenceRefs: record.evidenceRefs,
    risk: record.risk,
    approvalRequired: true,
    idempotencyKey: record.idempotencyKey,
    expectedPostcondition: record.args,
    planId: record.planId,
  }

  const outcome = await runtimeFor().execute(proposal, {
    authenticated: scopeToActor(input.scope),
    deadlineAtMs: nowMs + DEFAULT_DEADLINE_MS,
    grants,
    /**
     * The card path is an AGENT_PROPOSAL by construction — it exists precisely
     * because the action was not commanded — so approval stays required and the
     * grant just recorded is what satisfies it. Passing EXPLICIT_COMMAND here
     * would make the approval decorative.
     */
    intent: 'AGENT_PROPOSAL',
    investigationId: record.agentRunId,
  })

  return { ok: true, outcome }
}

/**
 * Turn 1 for a batch — the model asked to do one thing to several leads.
 *
 * Identical in every respect to the single-action path except that the plan has
 * more than one member: the SAME intent derivation, the SAME policy per action,
 * the SAME idempotency claim per action, the SAME verification. No model call
 * happens here, and none happens per mutation — that is the entire point of
 * expanding deterministically rather than conversing N times.
 */
export async function submitProposedBatch(input: {
  batch: ProposedBatch
  scope: AgentScope
  agentRunId: string
  userMessage?: string
  priorAssistantMessage?: string | null
  priorUserMessages?: readonly string[]
  deadlineAtMs?: number
  nowMs?: number
}): Promise<BatchOutcome> {
  const nowMs = input.nowMs ?? Date.now()
  const actor = scopeToActor(input.scope)

  const expansion = expandBatch({ batch: input.batch, actor, agentRunId: input.agentRunId })
  // Answered here, never by the runtime: an empty plan would come back as
  // NONE_EXECUTED, which cannot be told apart from "everything failed".
  if (expansion.ok === false) {
    return refusedBatch(input.batch.actionType, expansion.reason, expansion.eligible, expansion.limit)
  }

  const intent = await resolveIntent(input, expansion.plan.actions[0]!.actionType, nowMs)

  const planOutcome = await runtimeFor().executePlan(expansion.plan, {
    authenticated: actor,
    deadlineAtMs: input.deadlineAtMs ?? nowMs + DEFAULT_DEADLINE_MS,
    grants: [],
    intent,
    investigationId: input.agentRunId,
  })

  return aggregateBatch(planOutcome, {
    actionType: input.batch.actionType,
    planHash: expansion.planHash,
    eligible: expansion.plan.actions.length,
    limit: MAX_BATCH_TARGETS,
  })
}

export type BatchDecisionResult =
  | { ok: false; reason: 'not-found' | 'batch-changed' | 'not-proposer' | 'agent-disabled' }
  | { ok: true; outcome: BatchOutcome }

/**
 * Turn 2 for a batch — a human decided, once, about the whole set.
 *
 * ONE CARD, N GRANTS. The approval model binds a grant to one action id AND that
 * action's own args hash; a single plan-level grant cannot authorise a
 * multi-action plan, because every member has a different hash. So approving
 * writes one grant per member, which is the model used exactly as designed and
 * is strictly stronger than a plan grant would be: changing any one target's
 * title or date voids that member specifically.
 *
 * `planHash` guards what a per-action grant cannot — the COMPOSITION. The caller
 * echoes the hash of the batch it displayed, and it is recomputed from the
 * stored rows; adding or removing a member moves it and the decision is refused
 * rather than reinterpreted.
 */
export async function decideOnBatch(input: {
  planId: string
  planHash: string
  decision: 'APPROVED' | 'REJECTED'
  scope: AgentScope
  nowMs?: number
}): Promise<BatchDecisionResult> {
  const nowMs = input.nowMs ?? Date.now()
  const actor = scopeToActor(input.scope)

  // Rollout re-checked at decision time (F3) — see decideOnAction.
  if (!(await isAgentAvailableForUser(input.scope.agencyId, input.scope.userId))) return { ok: false, reason: 'agent-disabled' }

  // Agency-scoped: a plan id from another tenant simply does not exist.
  const records = await listActionsForPlan(input.scope.agencyId, input.planId)
  if (records.length === 0) return { ok: false, reason: 'not-found' }
  // Only the proposer decides (F2) — every member, not just the first, so a
  // plan can never be decided by someone who proposed none of it.
  if (records.some((r) => r.userId !== input.scope.userId)) return { ok: false, reason: 'not-proposer' }

  const storedHash = planHashOf(records.map((r) => ({ actionType: r.actionType, argsHash: r.argsHash })))
  if (storedHash !== input.planHash) return { ok: false, reason: 'batch-changed' }

  for (const record of records) {
    await recordApprovalDecision({
      agencyId: record.agencyId,
      actionId: record.actionId,
      planId: record.planId,
      argsHash: record.argsHash,
      decision: input.decision,
      decidedByUserId: input.scope.userId,
      nowMs,
    })
  }

  /**
   * Rebuilt from the DURABLE ROWS, never from anything the client sent — the
   * client supplies a plan id and a hash it must already match, and the
   * arguments that execute are the ones the runtime stored when the batch was
   * proposed.
   */
  const actions: ActionProposal[] = records.map((record) => ({
    actionId: record.actionId,
    agentRunId: record.agentRunId,
    agencyId: record.agencyId,
    actor,
    actionType: record.actionType,
    args: record.args,
    argsHash: record.argsHash,
    evidenceRefs: record.evidenceRefs,
    risk: record.risk,
    approvalRequired: true,
    idempotencyKey: record.idempotencyKey,
    expectedPostcondition: record.args,
    planId: record.planId,
  }))

  const grants = (
    await Promise.all(
      records.map((r) => loadApprovalGrants({ agencyId: r.agencyId, actionId: r.actionId, planId: r.planId })),
    )
  ).flat()

  const plan: ActionPlan = { planId: input.planId, agentRunId: records[0]!.agentRunId, actions }
  const planOutcome = await runtimeFor().executePlan(plan, {
    authenticated: actor,
    deadlineAtMs: nowMs + DEFAULT_DEADLINE_MS,
    grants,
    // The card path is an agent proposal by construction; the grants just
    // written are what satisfy the approval.
    intent: 'AGENT_PROPOSAL',
    investigationId: records[0]!.agentRunId,
  })

  return {
    ok: true,
    outcome: aggregateBatch(planOutcome, {
      actionType: records[0]!.actionType,
      planHash: storedHash,
      eligible: records.length,
      limit: MAX_BATCH_TARGETS,
    }),
  }
}
