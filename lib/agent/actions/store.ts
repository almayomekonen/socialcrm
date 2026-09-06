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
  /** Addressed by the DURABLE identity, never by actionId — see the runtime. */
  update(agencyId: number, idempotencyKey: string, patch: Partial<ActionRecord>): Promise<void>
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
      rows.set(k, { ...record })
      return { claimed: true, record: { ...record } }
    },
    async update(agencyId, idempotencyKey, patch) {
      const k = key(agencyId, idempotencyKey)
      const existing = rows.get(k)
      if (!existing) return
      rows.set(k, { ...existing, ...patch, updatedAtMs: patch.updatedAtMs ?? existing.updatedAtMs })
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
