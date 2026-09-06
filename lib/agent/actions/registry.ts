import type { z } from 'zod'
import type {
  ActionActor,
  ActionProposal,
  ExecutionResult,
  RiskLevel,
  VerificationResult,
} from './types'

/**
 * The registry — the complete, closed set of things the agent can ask for.
 *
 * IT IS EMPTY, AND THAT IS THE POINT OF THIS PHASE. The runtime is finished; the
 * domain actions are not written yet. An empty registry means every possible
 * action type resolves to `INVALID_ACTION`, so the runtime can be exercised end
 * to end — approval, idempotency, verification, audit — while it remains
 * impossible for anything to mutate the CRM. Adding `create_task` later is one
 * entry here plus one executor; it changes no line of the runtime.
 *
 * A CLOSED SET, NEVER DYNAMIC REGISTRATION. The model supplies an action TYPE,
 * which is looked up. It cannot supply an executor, a risk level, a schema, or a
 * verifier — those are code, written by a person, reviewed. If the lookup misses,
 * the action is invalid; there is no path from a string the model invented to
 * something that runs.
 *
 * EXECUTORS CALL THE CRM SERVICES THAT ALREADY EXIST. When `create_task` is
 * written its executor calls `createTask` from `actions/tasks.ts`; a follow-up
 * executor calls `setLeadFollowUp` from `actions/leadFollowUp.ts`; a meeting
 * calls into `actions/calendar/*`. None of them re-implements what a task is.
 * The runtime owns identity, authority, idempotency, verification and audit —
 * never domain rules.
 *
 * THE VERIFIER IS MANDATORY, not optional, and it is a separate function from
 * the executor for one reason: an executor reporting on its own success is the
 * model problem moved one layer down. The verifier re-reads the source of truth.
 */

export type ExecuteContext = {
  actor: ActionActor
  /** The absolute run deadline. An executor may consult it; it must not extend it. */
  deadlineAtMs: number
  nowMs: number
}

export type AgentActionDefinition<TArgs extends Record<string, unknown> = Record<string, unknown>> = {
  type: string
  /** Shape only. Authority is never expressed in the schema. */
  argsSchema: z.ZodType<TArgs>
  risk: RiskLevel
  /**
   * Approval requirement, when it is not simply implied by the risk level.
   * Present so a deployment can start an action stricter than its risk class and
   * relax it later on evidence, without editing the risk ladder.
   */
  requiresApproval?: boolean
  /**
   * Perform the mutation by calling the existing CRM service.
   * MUST return UNKNOWN rather than guessing when it cannot tell what happened.
   */
  execute: (action: ActionProposal, ctx: ExecuteContext) => Promise<ExecutionResult>
  /**
   * Re-read the source of truth and check the postcondition.
   * MUST NOT trust anything the executor returned beyond which ids to look up.
   */
  verify: (
    action: ActionProposal,
    execution: ExecutionResult,
    ctx: ExecuteContext,
  ) => Promise<VerificationResult>
  /**
   * RECONCILIATION PROBE — optional, and its absence is meaningful.
   *
   * `verify` answers "is target 55 correct", which needs a target id. A crashed
   * execution is precisely the case where no target id was ever recorded, so
   * verification cannot resolve it. A probe answers the harder question from the
   * ARGUMENTS alone: "does the postcondition this action would have produced
   * exist in the CRM at all?"
   *
   * Writing one is domain work — searching for a task by lead, title and date is
   * not the same shape of query as searching for a sent message — and getting it
   * subtly wrong resolves a stale row the wrong way, which is worse than leaving
   * it for a human. So a definition without a probe is not a gap to be filled by
   * a generic fallback: `reconcileAction` routes it to NEEDS_HUMAN, which is the
   * correct answer when nothing can safely determine what happened.
   */
  probe?: (action: ActionProposal, ctx: ExecuteContext) => Promise<VerificationResult>
}

/**
 * PHASE 4 NOTE — intentionally empty.
 *
 * Populating this is the next phase and is gated on review of this runtime.
 * Until then the runtime is fully testable with fake definitions and completely
 * inert against production data.
 */
const REGISTRY = new Map<string, AgentActionDefinition>()

export function registerAgentAction(definition: AgentActionDefinition): void {
  if (REGISTRY.has(definition.type)) {
    throw new Error(`agent action already registered: ${definition.type}`)
  }
  REGISTRY.set(definition.type, definition)
}

export function getAgentAction(type: string): AgentActionDefinition | null {
  return REGISTRY.get(type) ?? null
}

export function registeredActionTypes(): string[] {
  return [...REGISTRY.keys()].sort()
}

/**
 * Test seam. Production never calls this — the registry is built once at module
 * load from static definitions — but a test that registers a fake executor must
 * be able to leave the process as it found it.
 */
export function __resetAgentActionRegistry(): void {
  REGISTRY.clear()
}

/** Does this action need a human before it runs? */
export function approvalRequiredFor(definition: AgentActionDefinition): boolean {
  if (definition.requiresApproval !== undefined) return definition.requiresApproval
  return definition.risk === 'APPROVAL_REQUIRED' || definition.risk === 'HIGH_RISK'
}
