import type { ActionIntent } from './intent'
import type { ActionTargetRef, ApprovalState, RiskLevel, VerificationCheck, VerificationState } from './types'

/**
 * The durable side of the runtime: one row per attempted action, which is both
 * the idempotency claim and the audit record.
 *
 * ONE ROW, TWO JOBS, ON PURPOSE. Keeping the claim and the audit trail in
 * separate tables would allow the state where a mutation is claimed but
 * unaudited, or audited but unclaimed — and every interesting failure in this
 * system lives in exactly that gap. A single row written before execution and
 * updated after it cannot drift from itself.
 *
 * THE CLAIM IS AN INSERT, NOT A READ-THEN-WRITE. `claim` must be atomic against
 * concurrent callers; the Postgres implementation is a single
 * `INSERT … ON CONFLICT DO NOTHING RETURNING *`, so of two simultaneous
 * duplicates exactly one is told it claimed and the other is handed the row that
 * already existed. A `SELECT` followed by an `INSERT` would let both through,
 * which is the duplicate this whole layer exists to prevent.
 */

export type ActionExecutionState = 'PENDING' | 'EXECUTING' | 'SUCCEEDED' | 'FAILED' | 'NOT_EXECUTED' | 'UNKNOWN'

export type ActionRecord = {
  agencyId: number
  userId: number
  actionId: string
  agentRunId: string
  planId: string | null
  idempotencyKey: string
  actionType: string
  args: Record<string, unknown>
  argsHash: string
  risk: RiskLevel
  /**
   * Who asked — the audit's answer to "why did this run without a card?".
   * EXPLICIT_COMMAND, AGENT_PROPOSAL, or null on a row written before the
   * distinction existed.
   */
  intent: ActionIntent | null
  approvalState: ApprovalState
  approvedByUserId: number | null
  executionState: ActionExecutionState
  /** The executor's own verdict, kept beside the coarser lifecycle state. */
  executionStatus: string | null
  verificationState: VerificationState
  verificationChecks: VerificationCheck[]
  targetIds: ActionTargetRef[]
  evidenceRefs: string[]
  /** Whether a prior failure was definitive. Decides if a retry may proceed. */
  retryable: boolean | null
  failureReason: string | null
  timingsMs: Record<string, number>
  createdAtMs: number
  updatedAtMs: number
}

export type ClaimOutcome =
  | { claimed: true; record: ActionRecord }
  | { claimed: false; existing: ActionRecord }

export type ActionStore = {
  /** Atomic. First writer for ("agencyId","idempotencyKey") wins. */
  claim(record: ActionRecord): Promise<ClaimOutcome>
  /**
   * COMPARE-AND-SWAP into EXECUTING. Returns false when someone else got there.
   *
   * THE CLAIM ALONE IS NOT ENOUGH, and an integration test proved it: an action
   * that stops at AWAITING_APPROVAL leaves its row at NOT_EXECUTED, which is a
   * legitimately retryable state. Three approved duplicates then all read
   * NOT_EXECUTED before any of them wrote EXECUTING, all three passed the claim
   * check, and all three created a task. The claim prevents a duplicate ROW; it
   * cannot by itself prevent a duplicate EXECUTION of the row it created.
   *
   * This is the lock. The state transition is the guard rather than a value read
   * beforehand, so exactly one caller can move a row from a resumable state into
   * EXECUTING, and the losers are told to re-read rather than to proceed.
   */
  beginExecution(
    agencyId: number,
    idempotencyKey: string,
    from: readonly ActionExecutionState[],
    patch: Partial<ActionRecord>,
  ): Promise<boolean>
  /** Addressed by the DURABLE identity, never by actionId — see the runtime. */
  update(agencyId: number, idempotencyKey: string, patch: Partial<ActionRecord>): Promise<void>
  /**
   * `update`, only if the row is still exactly as the caller read it (same
   * execution state, same `updatedAtMs`). False when it changed meanwhile.
   * Reconciliation settles through this, so it can never overwrite a row that
   * a concurrent resume or a late executor has already moved on.
   */
  updateIf(
    agencyId: number,
    idempotencyKey: string,
    expected: { executionState: ActionExecutionState; updatedAtMs: number },
    patch: Partial<ActionRecord>,
  ): Promise<boolean>
  /**
   * Audit an attempt that never reached the claim stage — malformed, unknown
   * type, wrong tenant. Written best-effort and never allowed to fail the
   * refusal it is recording.
   */
  audit(record: ActionRecord): Promise<void>
  find(agencyId: number, idempotencyKey: string): Promise<ActionRecord | null>
}

/**
 * In-memory store. Used by the runtime's tests and by nothing else.
 *
 * It models the ONE property that matters — that `claim` is atomic — which it
 * gets for free from JavaScript's single-threaded execution: the map check and
 * the set happen with no await between them, exactly as the Postgres statement
 * is indivisible. Two concurrent claims therefore behave here as they do there.
 */
export function createInMemoryActionStore(): ActionStore & { all(): ActionRecord[] } {
  const rows = new Map<string, ActionRecord>()
  const key = (agencyId: number, idempotencyKey: string) => `${agencyId}:${idempotencyKey}`

  return {
    async claim(record) {
      const k = key(record.agencyId, record.idempotencyKey)
      const existing = rows.get(k)
      if (existing) return { claimed: false, existing }
      // An action id is unique per tenant too, mirroring the second unique index
      // in Postgres: the same id carrying different arguments is an integrity
      // violation, not a retry, and the runtime refuses it.
      const byActionId = [...rows.values()].find(
        (r) => r.agencyId === record.agencyId && r.actionId === record.actionId,
      )
      if (byActionId) return { claimed: false, existing: byActionId }
      rows.set(k, { ...record })
      return { claimed: true, record: { ...record } }
    },

    async beginExecution(agencyId, idempotencyKey, from, patch) {
      const k = key(agencyId, idempotencyKey)
      const existing = rows.get(k)
      if (!existing) return false
      // Check and set with no await between them — the same indivisibility the
      // single UPDATE statement has in Postgres.
      if (!from.includes(existing.executionState)) return false
      rows.set(k, { ...existing, ...patch, executionState: 'EXECUTING' })
      return true
    },
    async update(agencyId, idempotencyKey, patch) {
      const k = key(agencyId, idempotencyKey)
      const existing = rows.get(k)
      if (!existing) return
      rows.set(k, { ...existing, ...patch, updatedAtMs: patch.updatedAtMs ?? existing.updatedAtMs })
    },
    async updateIf(agencyId, idempotencyKey, expected, patch) {
      const k = key(agencyId, idempotencyKey)
      const existing = rows.get(k)
      if (!existing || existing.executionState !== expected.executionState || existing.updatedAtMs !== expected.updatedAtMs) return false
      rows.set(k, { ...existing, ...patch, updatedAtMs: patch.updatedAtMs ?? existing.updatedAtMs })
      return true
    },
    async audit(record) {
      const k = key(record.agencyId, record.idempotencyKey)
      if (!rows.has(k)) rows.set(k, { ...record })
    },
    async find(agencyId, idempotencyKey) {
      return rows.get(key(agencyId, idempotencyKey)) ?? null
    },
    all: () => [...rows.values()],
  }
}
