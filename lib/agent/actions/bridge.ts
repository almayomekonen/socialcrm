import 'server-only'
import { randomUUID } from 'node:crypto'
import { createDbActionStore, findActionByActionId } from '@/db/agentActions'
import { loadApprovalGrants, recordApprovalDecision } from '@/db/agentActionApprovals'
import { registerDomainActions } from './domain'
import { deriveActionIntent } from './intent'
import { parseActionProposal } from './proposal'
import { createActionRuntime } from './runtime'
import { DEFAULT_DEADLINE_MS } from '../budget'
import type { AgentScope, ProposedAction } from '../types'
import type { ActionOutcome, ActionProposal } from './types'

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
  proposal: ProposedAction
  scope: AgentScope
  agentRunId: string
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
    { agentRunId: input.agentRunId, actor: scopeToActor(input.scope), actionId: `act_${randomUUID()}` },
  )
  // A proposal that cannot be parsed is not an error to surface — the answer
  // around it may be perfectly good. It simply does not become an action.
  if (parsed.ok === false) return null

  const intent = deriveActionIntent({
    userMessage: input.userMessage ?? '',
    priorAssistantMessage: input.priorAssistantMessage,
    priorUserMessages: input.priorUserMessages,
  })

  return runtimeFor().execute(parsed.proposal, {
    authenticated: scopeToActor(input.scope),
    deadlineAtMs: input.deadlineAtMs ?? nowMs + DEFAULT_DEADLINE_MS,
    grants: [],
    intent: intent.intent,
    investigationId: input.agentRunId,
  })
}

export type ActionDecisionResult =
  | { ok: false; reason: 'not-found' | 'args-changed' }
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
  // Agency-scoped read: an action id from another tenant simply does not exist.
  const record = await findActionByActionId(input.scope.agencyId, input.actionId)
  if (!record) return { ok: false, reason: 'not-found' }
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
