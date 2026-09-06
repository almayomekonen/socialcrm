import type { ActionRecord } from './store'
import type {
  ActionProposal,
  ActionReport,
  ActionTimings,
  ApprovalState,
  ExecutionResult,
  RiskLevel,
  VerificationResult,
} from './types'

/**
 * Turning a lifecycle into a row and into a sentence.
 *
 * Split out of the runtime so the ONE invariant that carries this whole layer —
 * a mutation that was not verified is never reported as verified — lives in a
 * single total function that can be read, and tested, without the orchestration
 * around it.
 */

export const ZERO_TIMINGS: ActionTimings = {
  validationMs: 0, policyMs: 0, approvalMs: 0, claimMs: 0,
  executionMs: 0, verificationMs: 0, auditMs: 0, totalMs: 0,
}

export function baseRecord(p: ActionProposal, risk: RiskLevel, nowMs: number): ActionRecord {
  return {
    agencyId: p.agencyId,
    userId: p.actor.userId,
    actionId: p.actionId,
    agentRunId: p.agentRunId,
    planId: p.planId ?? null,
    idempotencyKey: p.idempotencyKey,
    actionType: p.actionType,
    args: p.args,
    argsHash: p.argsHash,
    risk,
    approvalState: 'NOT_REQUIRED',
    approvedByUserId: null,
    executionState: 'PENDING',
    executionStatus: null,
    verificationState: 'NOT_ATTEMPTED',
    verificationChecks: [],
    targetIds: [],
    evidenceRefs: p.evidenceRefs,
    retryable: null,
    failureReason: null,
    timingsMs: {},
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  }
}

/**
 * The single place a lifecycle becomes a sentence.
 *
 * Kept as one total function rather than assignments scattered through the flow,
 * because the invariant that matters — SUCCESS without verification is never
 * reported as verified — is only checkable if the mapping is in one place.
 */
export function reportFor(
  execution: ExecutionResult,
  verification: VerificationResult | null,
  approval: ApprovalState,
): { report: ActionReport; reconciliationRequired: boolean } {
  if (approval === 'PENDING') return { report: 'AWAITING_APPROVAL', reconciliationRequired: false }
  if (approval === 'REJECTED') return { report: 'REJECTED', reconciliationRequired: false }

  switch (execution.status) {
    case 'SUCCESS':
      if (verification?.verified === true) return { report: 'VERIFIED_SUCCESS', reconciliationRequired: false }
      // It ran, and we could not confirm it. Never VERIFIED_SUCCESS, and never
      // FAILED either — something may well exist in the CRM.
      return {
        report: 'EXECUTED_UNVERIFIED',
        reconciliationRequired: verification?.state !== 'UNVERIFIABLE',
      }
    case 'ALREADY_EXECUTED':
      return { report: 'DUPLICATE_NOOP', reconciliationRequired: false }
    case 'UNKNOWN':
      return { report: 'UNKNOWN_RECONCILE', reconciliationRequired: true }
    case 'FAILED':
    case 'RETRYABLE_FAILURE':
      return { report: 'FAILED', reconciliationRequired: false }
    default:
      // INVALID_ACTION, NOT_AUTHORIZED, APPROVAL_REQUIRED — nothing ran.
      return { report: 'NOT_EXECUTED', reconciliationRequired: false }
  }
}

