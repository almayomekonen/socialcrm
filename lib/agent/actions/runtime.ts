import { agentTrace } from '../trace'
import { decideOnExistingClaim } from './idempotency'
import { evaluatePolicy } from './policy'
import { evaluateApproval } from './approval'
import { baseRecord, reportFor, ZERO_TIMINGS } from './outcome'
import type { ActionStore } from './store'
import type {
  ActionActor,
  ActionOutcome,
  ActionPlan,
  ActionPlanOutcome,
  ActionProposal,
  ActionReport,
  ActionTimings,
  ApprovalGrant,
  ApprovalState,
  ExecutionResult,
  RiskLevel,
  VerificationResult,
} from './types'

/**
 * The Action Runtime — propose, decide, claim, execute, verify, report.
 *
 * READ THE ORDER, IT IS THE DESIGN:
 *
 *   policy → claim → approval → deadline → execute → verify → audit
 *
 * Policy comes FIRST so an unknown action type or a foreign tenant is refused
 * before any durable state exists; there is no point reserving an idempotency
 * key for something that will never run. The claim comes BEFORE approval so an
 * action awaiting a human is a real, findable row that a grant can later be
 * attached to, rather than a promise held in memory. And execution is bracketed
 * by two durable writes — EXECUTING before, the result after — because the gap
 * between them is the only place the truth can be lost, and a row frozen at
 * EXECUTING is precisely the evidence that it was.
 *
 * NOTHING HERE KNOWS WHAT A TASK IS. The runtime moves an action through its
 * lifecycle; the registry entry performs it by calling the CRM service that
 * already owns that domain.
 *
 * NO MODEL CALL HAPPENS IN THIS FILE, and none may be added. Phase 3a measured
 * where the wall clock goes — ~15.5s waiting on the provider against ~100ms of
 * tool work — so an extra turn to confirm an action would cost more than every
 * other part of this layer put together.
 */

export type ActionRuntimeContext = {
  /** The authenticated scope. Beats anything on the proposal, always. */
  authenticated: ActionActor
  /** The investigation's single absolute deadline. This layer never extends it. */
  deadlineAtMs: number
  grants?: readonly ApprovalGrant[]
  investigationId?: string
}

export type ActionRuntime = {
  execute(proposal: ActionProposal, ctx: ActionRuntimeContext): Promise<ActionOutcome>
  executePlan(plan: ActionPlan, ctx: ActionRuntimeContext): Promise<ActionPlanOutcome>
}

export function createActionRuntime(deps: { store: ActionStore; now?: () => number }): ActionRuntime {
  const now = deps.now ?? (() => Date.now())

  async function execute(proposal: ActionProposal, ctx: ActionRuntimeContext): Promise<ActionOutcome> {
    const startedAt = now()
    const timings: ActionTimings = { ...ZERO_TIMINGS }
    const trace = { investigationId: ctx.investigationId ?? proposal.agentRunId, agencyId: ctx.authenticated.agencyId, userId: ctx.authenticated.userId }

    const finish = (
      execution: ExecutionResult,
      verification: VerificationResult | null,
      approval: ApprovalState,
      risk: RiskLevel,
    ): ActionOutcome => {
      timings.totalMs = now() - startedAt
      const { report, reconciliationRequired } = reportFor(execution, verification, approval)
      agentTrace('ACTION_COMPLETE', trace, {
        actionId: proposal.actionId, actionType: proposal.actionType,
        risk, approval, execution: execution.status, verification: verification?.state ?? 'NOT_ATTEMPTED',
        report, reconciliationRequired, ...timings,
      })
      return {
        actionId: proposal.actionId, agentRunId: proposal.agentRunId, agencyId: proposal.agencyId,
        actionType: proposal.actionType, argsHash: proposal.argsHash, risk, approval, execution, verification, report,
        reconciliationRequired, failureReason: execution.reason ?? null, timings,
      }
    }

    // ── POLICY ────────────────────────────────────────────────────────────────
    const policyStart = now()
    const verdict = evaluatePolicy(proposal, ctx.authenticated)
    timings.policyMs = now() - policyStart
    if (verdict.allowed === false) {
      // Audited even though nothing ran: an attempt to act outside the tenant is
      // the single most important thing in this table.
      const auditStart = now()
      const record = baseRecord(proposal, proposal.risk, startedAt)
      await deps.store.audit({
        ...record,
        agencyId: ctx.authenticated.agencyId,
        executionState: 'NOT_EXECUTED',
        executionStatus: verdict.status,
        failureReason: verdict.reason,
      })
      timings.auditMs = now() - auditStart
      return finish({ status: verdict.status, reason: verdict.reason }, null, 'NOT_REQUIRED', proposal.risk)
    }

    const { definition, risk, approvalRequired } = verdict

    // ── CLAIM ─────────────────────────────────────────────────────────────────
    const claimStart = now()
    const claim = await deps.store.claim(baseRecord(proposal, risk, startedAt))
    timings.claimMs = now() - claimStart

    if (claim.claimed === false) {
      /**
       * The row that already owns this identity must be the SAME action. It is
       * not when one action id is reused with different arguments — which
       * derives a different idempotency key, so the claim conflicts on the
       * action-id index instead. Treating that as a retry would let an approval
       * granted for one set of arguments be spent on another.
       */
      if (claim.existing.argsHash !== proposal.argsHash) {
        return finish({ status: 'INVALID_ACTION', reason: 'action-id-reused' }, null, 'NOT_REQUIRED', risk)
      }
      const decision = decideOnExistingClaim(claim.existing, now())
      if (decision.kind === 'ALREADY_EXECUTED') {
        return finish(
          { status: 'ALREADY_EXECUTED', targetIds: claim.existing.targetIds, reason: 'duplicate-suppressed' },
          claim.existing.verificationState === 'VERIFIED'
            ? { state: 'VERIFIED', verified: true, checks: claim.existing.verificationChecks, targetIds: claim.existing.targetIds }
            : null,
          claim.existing.approvalState,
          risk,
        )
      }
      if (decision.kind === 'IN_FLIGHT') {
        // A twin holds the claim and is running now. Nothing was started twice,
        // and this caller has no outcome to report beyond that.
        return finish(
          { status: 'ALREADY_EXECUTED', reason: 'in-flight-elsewhere', targetIds: claim.existing.targetIds },
          null, claim.existing.approvalState, risk,
        )
      }
      if (decision.kind === 'RECONCILE') {
        return finish(
          { status: 'UNKNOWN', reason: 'prior-attempt-unresolved', targetIds: claim.existing.targetIds },
          null, claim.existing.approvalState, risk,
        )
      }
      // RETRY_ALLOWED — a prior attempt definitively did not mutate anything.
    }

    // ── APPROVAL ──────────────────────────────────────────────────────────────
    const approvalStart = now()
    const approval = evaluateApproval(proposal, approvalRequired, ctx.grants ?? [], now())
    timings.approvalMs = now() - approvalStart
    if (approval.state !== 'APPROVED' && approval.state !== 'NOT_REQUIRED') {
      await deps.store.update(proposal.agencyId, proposal.idempotencyKey, {
        approvalState: approval.state, executionState: 'NOT_EXECUTED',
        executionStatus: 'APPROVAL_REQUIRED', failureReason: approval.reason, updatedAtMs: now(),
      })
      return finish({ status: 'APPROVAL_REQUIRED', reason: approval.reason }, null, approval.state, risk)
    }

    // ── DEADLINE ──────────────────────────────────────────────────────────────
    // Checked BEFORE starting, never during: aborting a mutation already in
    // flight converts a knowable outcome into an unknown one, which is strictly
    // worse than answering a second late.
    if (now() >= ctx.deadlineAtMs) {
      await deps.store.update(proposal.agencyId, proposal.idempotencyKey, {
        approvalState: approval.state, executionState: 'NOT_EXECUTED',
        executionStatus: 'FAILED', failureReason: 'deadline-before-execution', updatedAtMs: now(),
      })
      return finish({ status: 'FAILED', reason: 'deadline-before-execution' }, null, approval.state, risk)
    }

    // ── EXECUTE ───────────────────────────────────────────────────────────────
    /**
     * THE LOCK, and the claim is not it.
     *
     * An action that stopped at AWAITING_APPROVAL leaves its row at
     * NOT_EXECUTED, which is a legitimately resumable state — so several
     * approved duplicates can all pass the claim check, having each read that
     * state before any of them wrote EXECUTING. An integration test with three
     * concurrent approvals created three tasks exactly this way.
     *
     * Moving the row into EXECUTING is therefore a guarded transition rather
     * than a write: exactly one caller can make it, and a caller that loses
     * re-reads instead of proceeding.
     */
    const started = await deps.store.beginExecution(
      proposal.agencyId,
      proposal.idempotencyKey,
      ['PENDING', 'NOT_EXECUTED', 'FAILED'],
      {
        approvalState: approval.state,
        approvedByUserId: approval.state === 'APPROVED' ? ctx.authenticated.userId : null,
        updatedAtMs: now(),
      },
    )

    if (!started) {
      // Someone else moved it. Whatever they are doing, this caller must not do
      // it as well — the current row decides what to report.
      const current = await deps.store.find(proposal.agencyId, proposal.idempotencyKey)
      const decision = decideOnExistingClaim(current, now())
      if (decision.kind === 'ALREADY_EXECUTED') {
        return finish(
          { status: 'ALREADY_EXECUTED', targetIds: current?.targetIds ?? [], reason: 'duplicate-suppressed' },
          current?.verificationState === 'VERIFIED'
            ? { state: 'VERIFIED', verified: true, checks: current.verificationChecks, targetIds: current.targetIds }
            : null,
          approval.state, risk,
        )
      }
      if (decision.kind === 'IN_FLIGHT') {
        return finish(
          { status: 'ALREADY_EXECUTED', reason: 'in-flight-elsewhere', targetIds: current?.targetIds ?? [] },
          null, approval.state, risk,
        )
      }
      return finish({ status: 'UNKNOWN', reason: 'concurrent-transition-lost' }, null, approval.state, risk)
    }

    const execCtx = { actor: ctx.authenticated, deadlineAtMs: ctx.deadlineAtMs, nowMs: now() }
    const executionStart = now()
    let execution: ExecutionResult
    try {
      execution = await definition.execute(proposal, execCtx)
    } catch {
      /**
       * A THROW IS UNKNOWN, never FAILED. The executor was interrupted at a point
       * it did not choose, so it cannot know whether its write committed — and
       * "probably not" is the assumption that creates the duplicate. An executor
       * that genuinely knows nothing happened must RETURN `FAILED` rather than
       * throw; that is the contract stated on the registry definition.
       */
      execution = { status: 'UNKNOWN', reason: 'executor-threw' }
    }
    timings.executionMs = now() - executionStart

    // ── VERIFY ────────────────────────────────────────────────────────────────
    let verification: VerificationResult | null = null
    if (execution.status === 'SUCCESS' || execution.status === 'ALREADY_EXECUTED') {
      const verifyStart = now()
      try {
        verification = await definition.verify(proposal, execution, execCtx)
      } catch {
        // Unable to read the source of truth. Not a failure of the mutation, and
        // emphatically not a confirmation of it.
        verification = { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'verifier-threw' }
      }
      timings.verificationMs = now() - verifyStart
    }

    // ── AUDIT ─────────────────────────────────────────────────────────────────
    const auditStart = now()
    const executionState =
      execution.status === 'SUCCESS' ? 'SUCCEEDED'
      : execution.status === 'UNKNOWN' ? 'UNKNOWN'
      : execution.status === 'ALREADY_EXECUTED' ? 'SUCCEEDED'
      : 'FAILED'
    await deps.store.update(proposal.agencyId, proposal.idempotencyKey, {
      executionState,
      executionStatus: execution.status,
      retryable: execution.status === 'RETRYABLE_FAILURE' ? true : execution.status === 'FAILED' ? true : null,
      verificationState: verification?.state ?? 'NOT_ATTEMPTED',
      verificationChecks: verification?.checks ?? [],
      targetIds: verification?.targetIds ?? execution.targetIds ?? [],
      failureReason: execution.reason ?? null,
      timingsMs: { ...timings },
      updatedAtMs: now(),
    })
    timings.auditMs = now() - auditStart

    return finish(execution, verification, approval.state, risk)
  }

  async function executePlan(plan: ActionPlan, ctx: ActionRuntimeContext): Promise<ActionPlanOutcome> {
    const outcomes: ActionOutcome[] = []
    // Sequential, deliberately: these are mutations against one tenant's data,
    // and the runtime has no way to know which of them conflict. No model turn
    // happens between them, which is the cost that actually mattered.
    for (const action of plan.actions) outcomes.push(await execute(action, ctx))

    const verified = outcomes.filter((o) => o.report === 'VERIFIED_SUCCESS').length
    const summary = {
      total: outcomes.length,
      verified,
      failed: outcomes.filter((o) => o.report === 'FAILED' || o.report === 'NOT_EXECUTED').length,
      awaitingApproval: outcomes.filter((o) => o.report === 'AWAITING_APPROVAL').length,
      duplicates: outcomes.filter((o) => o.report === 'DUPLICATE_NOOP').length,
      unknown: outcomes.filter((o) => o.report === 'UNKNOWN_RECONCILE' || o.report === 'EXECUTED_UNVERIFIED').length,
    }
    // Partial is reported as partial. 4/5 is never rounded to success.
    const report = verified === outcomes.length && outcomes.length > 0 ? 'ALL_VERIFIED' : verified === 0 ? 'NONE_EXECUTED' : 'PARTIAL'
    return { planId: plan.planId, agentRunId: plan.agentRunId, outcomes, summary, report }
  }

  return { execute, executePlan }
}
