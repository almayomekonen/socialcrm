/**
 * The Agent Action Runtime — vocabulary.
 *
 * THE ONE SENTENCE THIS LAYER EXISTS TO ENFORCE: the model proposes, the
 * application decides, executes and verifies, and nothing may be reported as
 * done that the application did not itself confirm against the source of truth.
 *
 * Everything here is deliberately DOMAIN-FREE. There is no task, follow-up,
 * meeting or message in this file, and there must not be — those arrive later as
 * registry entries with their own executors, calling the CRM services that
 * already exist (`actions/tasks.ts`, `actions/leadFollowUp.ts`,
 * `actions/calendar/*`). Duplicating their business logic here would create a
 * second, divergent definition of what a task is.
 *
 * WHY SO MANY DISTINCT OUTCOMES. A boolean cannot tell "the mutation did not
 * happen" from "the mutation happened and the answer was lost", and those two
 * demand opposite responses: retry the first, never retry the second. Most of
 * the vocabulary below exists to keep that distinction expressible all the way
 * from the executor to the sentence the rep reads.
 */

/**
 * Server-resolved authority. Never built from model output or a request body.
 *
 * `gotPermIds` was added when `create_follow_up` arrived and showed the actor
 * was carrying less authority than the scope had resolved. The product's own
 * follow-up write is agency-scoped AND, for non-admins, restricted to the leads
 * the rep owns (`applyFollowUp` in actions/leadFollowUp.ts); an executor holding
 * only the agency could not reproduce that second half, and would have written
 * to leads the rep cannot see. It is REQUIRED rather than optional so a call
 * site that forgets it fails to compile instead of silently widening — and an
 * empty list for a non-admin grants nothing, which is the safe direction.
 */
export type ActionActor = {
  agencyId: number
  userId: number
  role: string
  /** The lead owners this actor may write to. Ignored for admins, as elsewhere. */
  gotPermIds: number[]
}

/**
 * How much damage a wrong call does, which is what decides whether a human is
 * asked first. The ladder is about REVERSIBILITY and REACH, not about how
 * complicated the action is to perform.
 */
export const RISK_LEVELS = ['READ', 'LOW_RISK_WRITE', 'APPROVAL_REQUIRED', 'HIGH_RISK'] as const
export type RiskLevel = (typeof RISK_LEVELS)[number]

export const APPROVAL_STATES = ['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'] as const
export type ApprovalState = (typeof APPROVAL_STATES)[number]

/**
 * What an executor is allowed to say happened.
 *
 * `UNKNOWN` is the load-bearing member. An executor that cannot tell whether its
 * mutation landed MUST return it; the runtime then marks the action for
 * reconciliation and never retries it, because a retry is exactly how one lost
 * response becomes two created records.
 */
export const EXECUTION_STATUSES = [
  'SUCCESS',
  'FAILED',
  'RETRYABLE_FAILURE',
  'ALREADY_EXECUTED',
  'NOT_AUTHORIZED',
  'APPROVAL_REQUIRED',
  'INVALID_ACTION',
  'UNKNOWN',
] as const
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number]

export type ExecutionResult = {
  status: ExecutionStatus
  /** Ids the mutation created or touched. What verification will read back. */
  targetIds?: ActionTargetRef[]
  /** Machine-readable cause. Never provider prose, never customer content. */
  reason?: string | null
  /** Executor-supplied detail for the audit row. Must carry no customer content. */
  detail?: Record<string, unknown>
}

/** A thing in the CRM the action claims to have affected. */
export type ActionTargetRef = { kind: string; id: string }

export const VERIFICATION_STATES = ['NOT_ATTEMPTED', 'VERIFIED', 'MISMATCH', 'NOT_FOUND', 'UNVERIFIABLE'] as const
export type VerificationState = (typeof VERIFICATION_STATES)[number]

/** One postcondition, read back from the database rather than asserted. */
export type VerificationCheck = {
  name: string
  ok: boolean
  expected?: unknown
  actual?: unknown
}

export type VerificationResult = {
  state: VerificationState
  /**
   * True ONLY when the source of truth was read and every postcondition held.
   * A verifier that cannot read (`UNVERIFIABLE`) must leave this false — the
   * whole point is that absence of a check is never evidence of success.
   */
  verified: boolean
  checks: VerificationCheck[]
  targetIds?: ActionTargetRef[]
  reason?: string | null
}

/**
 * A proposed action, after the application has normalised it.
 *
 * `agencyId` and `actor` are NOT part of what a model may propose — see
 * ./proposal. They are stamped here from the authenticated scope, and the
 * runtime re-checks that nothing overrode them.
 */
export type ActionProposal = {
  actionId: string
  agentRunId: string
  agencyId: number
  actor: ActionActor
  actionType: string
  /** Canonicalised arguments. Key order is normalised so the hash is stable. */
  args: Record<string, unknown>
  /** Stable digest of `args`, which is what an approval is bound to. */
  argsHash: string
  /** Evidence the recommendation rested on. Refs only — never claim prose. */
  evidenceRefs: string[]
  risk: RiskLevel
  approvalRequired: boolean
  idempotencyKey: string
  /** What must be true afterwards, in the verifier's own vocabulary. */
  expectedPostcondition: Record<string, unknown>
  /** Set when the action belongs to a batch. */
  planId?: string | null
}

/**
 * A human's authorisation, bound to ONE action's exact arguments.
 *
 * Binding to `argsHash` as well as `actionId` is what makes "yes" un-replayable:
 * an approval granted for a follow-up on lead 161 tomorrow does not authorise the
 * same action id with a different date, because changing the date changes the
 * hash and the grant stops matching.
 */
export type ApprovalGrant = {
  agencyId: number
  /** Exactly one of these is set. A plan grant covers every action in the plan. */
  actionId?: string
  planId?: string
  /** The hash the human actually saw. */
  argsHash: string
  grantedByUserId: number
  grantedAtMs: number
  expiresAtMs: number
  decision: 'APPROVED' | 'REJECTED'
}

/** Where the wall clock went. No model call happens anywhere in this layer. */
export type ActionTimings = {
  validationMs: number
  policyMs: number
  approvalMs: number
  claimMs: number
  executionMs: number
  verificationMs: number
  auditMs: number
  totalMs: number
}

/**
 * The ONLY thing an answer may be built from.
 *
 * `reported` collapses the whole run into the single claim the agent is allowed
 * to make about it, so a caller cannot accidentally read `execution.status ===
 * 'SUCCESS'` and call it done while verification says otherwise.
 */
export const ACTION_REPORTS = [
  'VERIFIED_SUCCESS',
  'EXECUTED_UNVERIFIED',
  'DUPLICATE_NOOP',
  'AWAITING_APPROVAL',
  'REJECTED',
  'NOT_EXECUTED',
  'FAILED',
  'UNKNOWN_RECONCILE',
] as const
export type ActionReport = (typeof ACTION_REPORTS)[number]

export type ActionOutcome = {
  actionId: string
  agentRunId: string
  agencyId: number
  actionType: string
  /**
   * The exact arguments this outcome pertains to.
   *
   * Carried out to the caller so an approval UI can echo back the hash of what
   * it displayed. That echo is what makes the approval mean "yes to THIS": the
   * server compares it against the stored row and refuses when they differ, so a
   * card showing stale arguments cannot authorise the current ones.
   */
  argsHash: string
  risk: RiskLevel
  approval: ApprovalState
  execution: ExecutionResult
  /** Null when execution never got far enough for a postcondition to exist. */
  verification: VerificationResult | null
  report: ActionReport
  /** True when the runtime cannot say whether the mutation landed. */
  reconciliationRequired: boolean
  failureReason: string | null
  timings: ActionTimings
}

export type ActionPlan = {
  planId: string
  agentRunId: string
  actions: ActionProposal[]
}

/** Partial success is reported as partial success. Nothing is rounded up. */
export type ActionPlanOutcome = {
  planId: string
  agentRunId: string
  outcomes: ActionOutcome[]
  summary: {
    total: number
    verified: number
    failed: number
    awaitingApproval: number
    duplicates: number
    unknown: number
  }
  report: 'ALL_VERIFIED' | 'PARTIAL' | 'NONE_EXECUTED'
}
