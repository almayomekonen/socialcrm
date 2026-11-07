import { agentTrace } from '../trace'
import { EXECUTION_LEASE_MS } from './idempotency'
import { getAgentAction } from './registry'
import type { ExecuteContext } from './registry'
import type { ActionRecord, ActionStore } from './store'
import type { ActionProposal, VerificationResult } from './types'

/**
 * Reconciliation — resolving the rows whose outcome nobody knows.
 *
 * THE ROW THIS EXISTS FOR is one left at `EXECUTING` by a process that died
 * mid-mutation, or one an executor marked `UNKNOWN` because it could not tell
 * whether its write committed. The runtime deliberately refuses to guess about
 * either: it will not retry them, because a retry is exactly how one lost
 * response becomes two records, and it will not report them as failed, because
 * something may well exist in the CRM.
 *
 * That refusal is correct and it is not a resolution. Without this file those
 * rows accumulate forever, and a queue nobody can drain is indistinguishable
 * from a queue nobody is keeping.
 *
 * THE ONLY HONEST WAY TO RESOLVE ONE is to look at the CRM, so that is the whole
 * mechanism: ask the action's own probe whether its postcondition exists, and
 * let the answer decide. Nothing is inferred from elapsed time, from the fact
 * that an executor usually succeeds, or from how a similar action turned out.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It performs no recovery. It never re-runs an
 * executor, never repairs a half-finished mutation, and never deletes anything.
 * It reaches one of three conclusions and writes it down; acting on
 * SAFE_TO_RETRY is the caller's decision, and NEEDS_HUMAN means exactly that.
 */

export type ReconciliationVerdict =
  /** The row was never ambiguous. Nothing to do. */
  | { kind: 'NOT_REQUIRED' }
  /** The postcondition exists: the mutation DID land. The row is now settled. */
  | { kind: 'RESOLVED_SUCCEEDED'; verification: VerificationResult }
  /** The postcondition provably does not exist, so re-running cannot duplicate. */
  | { kind: 'SAFE_TO_RETRY'; reason: string }
  /** Nothing here can safely decide. A person must look. */
  | { kind: 'NEEDS_HUMAN'; reason: string }

/**
 * Is this row's outcome genuinely unknown?
 *
 * `UNKNOWN` always is. `EXECUTING` only once the lease has passed — inside it a
 * twin is running this instant, and calling that unresolved would put healthy
 * in-flight work into a queue meant for casualties.
 */
export function requiresReconciliation(record: ActionRecord, nowMs: number): boolean {
  if (record.executionState === 'UNKNOWN') return true
  if (record.executionState !== 'EXECUTING') return false
  return nowMs - record.updatedAtMs >= EXECUTION_LEASE_MS
}

/** The stored row, back in the shape a probe expects. Identity comes from the row. */
function proposalFromRecord(record: ActionRecord): ActionProposal {
  return {
    actionId: record.actionId,
    agentRunId: record.agentRunId,
    agencyId: record.agencyId,
    // A reconciliation probe READS to establish what happened; it must never
    // need write authority, so none is reconstructed here.
    actor: { agencyId: record.agencyId, userId: record.userId, role: '', gotPermIds: [] },
    actionType: record.actionType,
    args: record.args,
    argsHash: record.argsHash,
    evidenceRefs: record.evidenceRefs,
    risk: record.risk,
    approvalRequired: record.approvalState !== 'NOT_REQUIRED',
    idempotencyKey: record.idempotencyKey,
    expectedPostcondition: {},
    planId: record.planId,
  }
}

export type ReconcileDeps = {
  store: ActionStore
  now?: () => number
}

/**
 * Resolve one unresolved row, and record what was decided.
 *
 * The audit write is part of the contract, not a side effect: a reconciliation
 * that reached a conclusion and did not persist it leaves the row exactly as
 * ambiguous as it found it, and the next pass would repeat the work.
 */
export async function reconcileAction(record: ActionRecord, deps: ReconcileDeps): Promise<ReconciliationVerdict> {
  const now = deps.now ?? (() => Date.now())
  const nowMs = now()
  const trace = { agencyId: record.agencyId, userId: record.userId, investigationId: record.agentRunId }

  if (!requiresReconciliation(record, nowMs)) return { kind: 'NOT_REQUIRED' }

  /**
   * GUARDED. The verdict is written only if the row is still exactly as it was
   * read. If a concurrent reconcile, a resume or a late executor moved it on,
   * this pass decided about a row that no longer exists: it writes nothing and
   * reports NOT_REQUIRED, and the next pass reads the new state.
   */
  const settle = async (verdict: ReconciliationVerdict, patch: Partial<ActionRecord>): Promise<ReconciliationVerdict> => {
    const expected = { executionState: record.executionState, updatedAtMs: record.updatedAtMs }
    const written = await deps.store.updateIf(record.agencyId, record.idempotencyKey, expected, { ...patch, updatedAtMs: nowMs })
    if (!written) return { kind: 'NOT_REQUIRED' }
    agentTrace('ACTION_RECONCILED', trace, {
      actionId: record.actionId, actionType: record.actionType, verdict: verdict.kind,
      reason: 'reason' in verdict ? verdict.reason : null,
    })
    return verdict
  }

  const definition = getAgentAction(record.actionType)
  if (!definition) {
    return settle(
      { kind: 'NEEDS_HUMAN', reason: 'unknown-action-type' },
      { failureReason: 'reconcile:unknown-action-type' },
    )
  }

  // No probe is not a missing feature to paper over with a generic guess — it is
  // the statement that this action type cannot be safely resolved automatically.
  if (!definition.probe) {
    return settle(
      { kind: 'NEEDS_HUMAN', reason: 'no-probe-for-action-type' },
      { failureReason: 'reconcile:no-probe' },
    )
  }

  const ctx: ExecuteContext = {
    actor: { agencyId: record.agencyId, userId: record.userId, role: '', gotPermIds: [] },
    deadlineAtMs: nowMs + EXECUTION_LEASE_MS,
    nowMs,
  }

  let probed: VerificationResult
  try {
    probed = await definition.probe(proposalFromRecord(record), ctx)
  } catch {
    // Could not read the CRM. That is not evidence either way, and guessing here
    // is the one thing this file must never do.
    return settle({ kind: 'NEEDS_HUMAN', reason: 'probe-threw' }, { failureReason: 'reconcile:probe-threw' })
  }

  if (probed.state === 'VERIFIED' && probed.verified === true) {
    // The mutation landed after all. The row becomes an ordinary success and
    // leaves the queue.
    return settle({ kind: 'RESOLVED_SUCCEEDED', verification: probed }, {
      executionState: 'SUCCEEDED',
      executionStatus: 'SUCCESS',
      verificationState: 'VERIFIED',
      verificationChecks: probed.checks,
      targetIds: probed.targetIds ?? record.targetIds,
      failureReason: null,
      retryable: null,
    })
  }

  if (probed.state === 'NOT_FOUND') {
    // The postcondition is absent from the source of truth, so the mutation did
    // not land and re-running it cannot duplicate anything.
    return settle({ kind: 'SAFE_TO_RETRY', reason: 'postcondition-absent' }, {
      executionState: 'FAILED',
      executionStatus: 'FAILED',
      retryable: true,
      verificationState: 'NOT_FOUND',
      verificationChecks: probed.checks,
      failureReason: 'reconcile:postcondition-absent',
    })
  }

  // MISMATCH — something exists but is not what was asked for — and UNVERIFIABLE
  // both mean a person has to look. Retrying a mismatch would add a second,
  // equally wrong record beside the first.
  return settle({ kind: 'NEEDS_HUMAN', reason: `probe-${probed.state.toLowerCase()}` }, {
    verificationState: probed.state,
    verificationChecks: probed.checks,
    failureReason: `reconcile:probe-${probed.state.toLowerCase()}`,
  })
}
