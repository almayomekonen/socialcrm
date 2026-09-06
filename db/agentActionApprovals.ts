import { db } from '@/config/db'
import type { ApprovalGrant } from '@/lib/agent/actions/types'

/**
 * Persisted approval grants — the durable half of the approval gate.
 *
 * `evaluateApproval` is pure and decides from a list of grants; this module is
 * where that list comes from and where a rep's decision is written down. The
 * split is deliberate: the RULES (bound to argsHash, rejection dominates,
 * expiry) stay testable without a database, and the STORAGE has no opinion about
 * what a valid approval is.
 *
 * TENANT ISOLATION IS IN EVERY QUERY. `agencyId` is on the row and in every
 * WHERE clause, so a grant recorded by one agency can never be loaded for
 * another's action even if the action ids collided.
 *
 * NOTHING IS UPDATED OR DELETED. A change of mind is a new row, so the table
 * says what was decided and when rather than only what the answer is now.
 */

export const AGENT_ACTION_APPROVALS_TABLE = 'agent_action_approvals'

/**
 * How long a decision stands.
 *
 * Fifteen minutes is the span of the conversation the approval belongs to. The
 * failure it guards is not malice, it is drift: a rep who approves "create a
 * task for דוד" and comes back an hour later has a different business in front
 * of them, and the action they authorised may no longer be the one they would
 * choose. Short enough that a stale yes cannot be spent; long enough that
 * reading the proposal carefully does not cost the approval.
 */
export const DEFAULT_APPROVAL_TTL_MS = 15 * 60 * 1000

export type ApprovalDecisionInput = {
  agencyId: number
  actionId: string
  planId?: string | null
  /** Must be the hash of what the approver was shown. Never recomputed here. */
  argsHash: string
  decision: 'APPROVED' | 'REJECTED'
  decidedByUserId: number
  nowMs?: number
  ttlMs?: number
}

type Row = {
  agencyId: number
  actionId: string | null
  planId: string | null
  argsHash: string
  decision: string
  decidedByUserId: number
  decidedAt: Date | string
  expiresAt: Date | string
}

function toGrant(row: Row): ApprovalGrant {
  return {
    agencyId: row.agencyId,
    actionId: row.actionId ?? undefined,
    planId: row.planId ?? undefined,
    argsHash: row.argsHash,
    grantedByUserId: row.decidedByUserId,
    grantedAtMs: new Date(row.decidedAt).getTime(),
    expiresAtMs: new Date(row.expiresAt).getTime(),
    decision: row.decision === 'REJECTED' ? 'REJECTED' : 'APPROVED',
  }
}

/**
 * Record one decision. A repeated identical decision is a no-op rather than a
 * second grant — a double-clicked approve button is one approval.
 */
export function approvalInsertQuery(input: ApprovalDecisionInput) {
  const nowMs = input.nowMs ?? Date.now()
  return db(AGENT_ACTION_APPROVALS_TABLE)
    .insert({
      agencyId: input.agencyId,
      actionId: input.actionId,
      planId: input.planId ?? null,
      argsHash: input.argsHash,
      decision: input.decision,
      decidedByUserId: input.decidedByUserId,
      decidedAt: new Date(nowMs),
      expiresAt: new Date(nowMs + (input.ttlMs ?? DEFAULT_APPROVAL_TTL_MS)),
    })
    .onConflict(['agencyId', 'actionId', 'decidedByUserId', 'decision'])
    .ignore()
}

export async function recordApprovalDecision(input: ApprovalDecisionInput): Promise<void> {
  await approvalInsertQuery(input)
}

/** Every grant that could bear on this action. The gate decides which apply. */
export function grantsForActionQuery(args: { agencyId: number; actionId: string; planId?: string | null }) {
  const q = db(AGENT_ACTION_APPROVALS_TABLE).where({ agencyId: args.agencyId })
  if (args.planId) {
    q.andWhere((b) => b.where({ actionId: args.actionId }).orWhere({ planId: args.planId }))
  } else {
    q.andWhere({ actionId: args.actionId })
  }
  return q.orderBy('decidedAt', 'desc').limit(50)
}

export async function loadApprovalGrants(args: {
  agencyId: number
  actionId: string
  planId?: string | null
}): Promise<ApprovalGrant[]> {
  const rows = (await grantsForActionQuery(args)) as Row[]
  return rows.map(toGrant)
}
