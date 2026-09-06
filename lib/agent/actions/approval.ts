import type { ActionProposal, ApprovalGrant, ApprovalState } from './types'

/**
 * The approval gate — why "yes" is not authorisation.
 *
 * A rep types "כן" and a naive runtime treats the next action as approved. That
 * is the vulnerability this file exists to make unrepresentable: there is no
 * function here that takes text. A grant is a structured object naming the exact
 * action and the exact arguments a human saw, and the gate compares it against
 * the action about to run.
 *
 * BOUND TO ARGUMENTS, NOT ONLY TO IDENTITY. Matching on `actionId` alone would
 * let an action be approved and then edited — same id, different date, same
 * "yes". The grant carries `argsHash`, so changing any argument invalidates the
 * approval it was granted under. This is also what stops one approval from being
 * spent on an unrelated action: a grant for action X cannot match action Y,
 * whatever a caller passes.
 *
 * EXPIRY IS PART OF THE GRANT, not a global setting, because the window that is
 * reasonable for "send this message" is not the one for "create this task", and
 * a stale approval acted on an hour later is a different decision than the one
 * the human made.
 */

export type ApprovalVerdict = {
  state: ApprovalState
  reason: string | null
}

const NOT_REQUIRED: ApprovalVerdict = { state: 'NOT_REQUIRED', reason: null }

/**
 * Does this grant authorise this exact action, right now?
 *
 * Every check is a reason a grant does NOT apply; the function is written as a
 * list of refusals so adding one later cannot accidentally widen it.
 */
function grantApplies(grant: ApprovalGrant, action: ActionProposal): boolean {
  if (grant.agencyId !== action.agencyId) return false
  // The grant must name THIS action, or the plan this action belongs to.
  const namesAction = grant.actionId != null && grant.actionId === action.actionId
  const namesPlan = grant.planId != null && action.planId != null && grant.planId === action.planId
  if (!namesAction && !namesPlan) return false
  // The arguments must be the ones the human was shown.
  if (grant.argsHash !== action.argsHash) return false
  if (!Number.isFinite(grant.expiresAtMs)) return false
  return true
}

export function evaluateApproval(
  action: ActionProposal,
  approvalRequired: boolean,
  grants: readonly ApprovalGrant[],
  nowMs: number,
): ApprovalVerdict {
  if (!approvalRequired) return NOT_REQUIRED

  const applicable = grants.filter((g) => grantApplies(g, action))
  if (applicable.length === 0) return { state: 'PENDING', reason: 'no-matching-grant' }

  // An explicit rejection wins over any approval, whenever it was made. A human
  // who said no must not be overridden by an earlier or a concurrent yes.
  const rejection = applicable.find((g) => g.decision === 'REJECTED')
  if (rejection) return { state: 'REJECTED', reason: 'rejected-by-user' }

  const live = applicable.filter((g) => g.decision === 'APPROVED' && g.expiresAtMs > nowMs)
  if (live.length === 0) return { state: 'EXPIRED', reason: 'grant-expired' }

  return { state: 'APPROVED', reason: null }
}
