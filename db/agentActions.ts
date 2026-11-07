import { db } from '@/config/db'
import type { ActionExecutionState, ActionRecord, ActionStore, ClaimOutcome } from '@/lib/agent/actions/store'
import type { ActionTargetRef, ApprovalState, RiskLevel, VerificationCheck, VerificationState } from '@/lib/agent/actions/types'

/**
 * Durable action records — the idempotency claim and the audit trail, one row.
 *
 * THE CLAIM IS THE INSERT. `ON CONFLICT ("agencyId","idempotencyKey") DO NOTHING
 * RETURNING *` is atomic: of two concurrent duplicates exactly one gets a row
 * back and the other gets nothing, and the one that got nothing then reads what
 * already exists. A `SELECT` followed by an `INSERT` would let both believe they
 * were first, which is the duplicate mutation this table exists to prevent.
 *
 * TENANT ISOLATION IS IN THE KEY, NOT ONLY IN THE WHERE CLAUSE. The unique index
 * is on ("agencyId","idempotencyKey"), so two agencies deriving the same key —
 * same action type, same arguments — do not collide, and no read can reach
 * another tenant's row even with a key that belongs to it, because every query
 * here carries `agencyId`.
 *
 * WHAT IS NOT STORED. No customer message text, no claim prose, no provider or
 * model identifier. `args` holds the normalised arguments an action was invoked
 * with, which is the minimum an audit trail can be useful with — a follow-up
 * date, a lead id — and `evidenceRefs` holds references, never the sentences the
 * agent wrote around them.
 */

export const AGENT_ACTIONS_TABLE = 'agent_actions'

type Row = {
  agencyId: number
  userId: number
  actionId: string
  agentRunId: string
  planId: string | null
  idempotencyKey: string
  actionType: string
  args: unknown
  argsHash: string
  risk: string
  intent: string | null
  approvalState: string
  approvedByUserId: number | null
  executionState: string
  executionStatus: string | null
  verificationState: string
  verificationChecks: unknown
  targetIds: unknown
  evidenceRefs: unknown
  retryable: boolean | null
  failureReason: string | null
  timingsMs: unknown
  createdAt: Date | string
  updatedAt: Date | string
}

const ms = (v: Date | string): number => new Date(v).getTime()

/** jsonb arrives parsed from pg; the fallbacks keep a hand-written row readable. */
function json<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  return value as T
}

export function toActionRecord(row: Row): ActionRecord {
  return {
    agencyId: row.agencyId,
    userId: row.userId,
    actionId: row.actionId,
    agentRunId: row.agentRunId,
    planId: row.planId,
    idempotencyKey: row.idempotencyKey,
    actionType: row.actionType,
    args: json<Record<string, unknown>>(row.args, {}),
    argsHash: row.argsHash,
    risk: row.risk as RiskLevel,
    intent: (row.intent as ActionRecord['intent']) ?? null,
    approvalState: row.approvalState as ApprovalState,
    approvedByUserId: row.approvedByUserId,
    executionState: row.executionState as ActionExecutionState,
    executionStatus: row.executionStatus,
    verificationState: row.verificationState as VerificationState,
    verificationChecks: json<VerificationCheck[]>(row.verificationChecks, []),
    targetIds: json<ActionTargetRef[]>(row.targetIds, []),
    evidenceRefs: json<string[]>(row.evidenceRefs, []),
    retryable: row.retryable,
    failureReason: row.failureReason,
    timingsMs: json<Record<string, number>>(row.timingsMs, {}),
    createdAtMs: ms(row.createdAt),
    updatedAtMs: ms(row.updatedAt),
  }
}

/** Pure mapping, so the insert shape is testable without a database. */
export function toRow(record: ActionRecord): Record<string, unknown> {
  return {
    agencyId: record.agencyId,
    userId: record.userId,
    actionId: record.actionId,
    agentRunId: record.agentRunId,
    planId: record.planId,
    idempotencyKey: record.idempotencyKey,
    actionType: record.actionType,
    args: JSON.stringify(record.args),
    argsHash: record.argsHash,
    risk: record.risk,
    intent: record.intent,
    approvalState: record.approvalState,
    approvedByUserId: record.approvedByUserId,
    executionState: record.executionState,
    executionStatus: record.executionStatus,
    verificationState: record.verificationState,
    verificationChecks: JSON.stringify(record.verificationChecks),
    targetIds: JSON.stringify(record.targetIds),
    evidenceRefs: JSON.stringify(record.evidenceRefs),
    retryable: record.retryable,
    failureReason: record.failureReason,
    timingsMs: JSON.stringify(record.timingsMs),
    createdAt: new Date(record.createdAtMs),
    updatedAt: new Date(record.updatedAtMs),
  }
}

/**
 * The claim as a query builder, so the conflict target is assertable from the
 * generated SQL. Changing `.ignore()` or the target changes that SQL — the only
 * way the atomicity guarantee can be defended, since a mocked writer would
 * accept any clause.
 */
export function claimQuery(record: ActionRecord) {
  return db(AGENT_ACTIONS_TABLE)
    .insert(toRow(record))
    .onConflict(['agencyId', 'idempotencyKey'])
    .ignore()
    .returning('*')
}

/** Only these columns may be changed after the claim. Identity is immutable. */
const MUTABLE: (keyof ActionRecord)[] = [
  'approvalState', 'approvedByUserId', 'executionState', 'executionStatus',
  'verificationState', 'verificationChecks', 'targetIds', 'retryable',
  'failureReason', 'timingsMs',
]

function patchSet(patch: Partial<ActionRecord>): Record<string, unknown> {
  const set: Record<string, unknown> = { updatedAt: new Date(patch.updatedAtMs ?? Date.now()) }
  for (const key of MUTABLE) {
    if (!(key in patch)) continue
    const value = patch[key]
    set[key] = Array.isArray(value) || (value && typeof value === 'object') ? JSON.stringify(value) : (value as unknown)
  }
  return set
}

export function updateQuery(agencyId: number, idempotencyKey: string, patch: Partial<ActionRecord>) {
  // agencyId in the WHERE clause, always: an idempotency key is not a capability.
  return db(AGENT_ACTIONS_TABLE).where({ agencyId, idempotencyKey }).update(patchSet(patch))
}

/** `updateQuery`, guarded on the state and timestamp the caller read (compare-and-swap). */
export function updateIfQuery(
  agencyId: number,
  idempotencyKey: string,
  expected: { executionState: string; updatedAtMs: number },
  patch: Partial<ActionRecord>,
) {
  return db(AGENT_ACTIONS_TABLE)
    .where({ agencyId, idempotencyKey, executionState: expected.executionState })
    .andWhere('updatedAt', new Date(expected.updatedAtMs))
    .update(patchSet(patch))
}

/**
 * The transition into EXECUTING, expressed as a guarded UPDATE.
 *
 * The `whereIn` on the current state is the lock: two callers racing to start
 * the same action both issue this, and Postgres applies them in order, so the
 * second finds no row in a startable state and updates zero rows.
 */
export function beginExecutionQuery(
  agencyId: number,
  idempotencyKey: string,
  from: readonly string[],
  patch: Partial<ActionRecord>,
) {
  const set: Record<string, unknown> = {
    executionState: 'EXECUTING',
    updatedAt: new Date(patch.updatedAtMs ?? Date.now()),
  }
  if ('approvalState' in patch) set.approvalState = patch.approvalState
  if ('approvedByUserId' in patch) set.approvedByUserId = patch.approvedByUserId
  return db(AGENT_ACTIONS_TABLE)
    .where({ agencyId, idempotencyKey })
    .whereIn('executionState', from as string[])
    .update(set)
}

export function createDbActionStore(): ActionStore {
  return {
    async claim(record): Promise<ClaimOutcome> {
      let inserted: Row[]
      try {
        inserted = (await claimQuery(record)) as Row[]
      } catch (err) {
        /**
         * `ON CONFLICT` names the idempotency key, so the OTHER unique index —
         * ("agencyId","actionId") — still raises. That happens when one action
         * id is reused with different arguments, which derives a different key
         * and therefore misses the conflict target entirely.
         *
         * It is an integrity violation rather than a retry, and it must not
         * escape as a raw driver error. The row that already owns the id is
         * returned, and the runtime refuses it after comparing argument hashes.
         */
        if ((err as { code?: string })?.code !== '23505') throw err
        const owner = (await db(AGENT_ACTIONS_TABLE)
          .where({ agencyId: record.agencyId, actionId: record.actionId })
          .first()) as Row | undefined
        if (!owner) throw err
        return { claimed: false, existing: toActionRecord(owner) }
      }

      if (inserted.length > 0) return { claimed: true, record: toActionRecord(inserted[0]!) }
      const existing = (await db(AGENT_ACTIONS_TABLE)
        .where({ agencyId: record.agencyId, idempotencyKey: record.idempotencyKey })
        .first()) as Row | undefined
      // A conflict with no readable row would mean the unique index fired on
      // something this query cannot see — a different tenant's row is the only
      // candidate, and returning it would be a leak. Fail closed instead.
      if (!existing) throw new Error('agent action claim conflicted but no row is visible in this agency')
      return { claimed: false, existing: toActionRecord(existing) }
    },

    async beginExecution(agencyId, idempotencyKey, from, patch) {
      const updated = await beginExecutionQuery(agencyId, idempotencyKey, from, patch)
      return Number(updated) > 0
    },

    async update(agencyId, idempotencyKey, patch) {
      await updateQuery(agencyId, idempotencyKey, patch)
    },

    async updateIf(agencyId, idempotencyKey, expected, patch) {
      return Number(await updateIfQuery(agencyId, idempotencyKey, expected, patch)) > 0
    },

    async audit(record) {
      await claimQuery(record)
    },

    async find(agencyId, idempotencyKey) {
      const row = (await db(AGENT_ACTIONS_TABLE).where({ agencyId, idempotencyKey }).first()) as Row | undefined
      return row ? toActionRecord(row) : null
    },
  }
}

/**
 * Has this rep already completed an action of this type, recently?
 *
 * THE STANDING-COMMAND LIFECYCLE DEPENDS ON THIS. "תיצור לי משימה" authorises the
 * turns that COMPLETE it — the title, the date — and nothing after that. Once
 * the command has produced its action it is spent, and a later fragment like
 * "תזכורת לדניאל" must not inherit authority from an instruction that was
 * already carried out. A pure time window cannot express that; the durable
 * record can, because an executed row IS the evidence the command was fulfilled.
 *
 * Scoped to the acting rep as well as the agency: one rep's completed command
 * says nothing about another's.
 *
 * ANY ACTION TYPE COUNTS, deliberately. A command is fulfilled by whatever it
 * produced, so narrowing this to one type would leave the hole it exists to
 * close: "תיצור לי משימה" executes a task, and the next fragment — read by the
 * model as a follow-up instead — would find no spent command of THAT type and
 * inherit the authority anyway.
 */
export function recentExecutedActionQuery(args: {
  agencyId: number
  userId: number
  sinceMs: number
  /** Optional narrowing. Omit it to ask "did anything execute", which is the rule. */
  actionType?: string
}) {
  const q = db(AGENT_ACTIONS_TABLE)
    .where({ agencyId: args.agencyId, userId: args.userId, executionState: 'SUCCEEDED' })
    .andWhere('createdAt', '>=', new Date(args.sinceMs))
  if (args.actionType) q.andWhere({ actionType: args.actionType })
  return q.orderBy('createdAt', 'desc').limit(1).select('actionId')
}

export async function hasRecentlyExecutedAction(args: {
  agencyId: number
  userId: number
  sinceMs: number
  actionType?: string
}): Promise<boolean> {
  const rows = (await recentExecutedActionQuery(args)) as unknown[]
  return rows.length > 0
}

/**
 * Every action belonging to one plan, oldest first.
 *
 * Additive read only — the store contract is unchanged. Ordered by id so a
 * batch rebuilt for approval always expands in the same sequence, which is what
 * keeps its plan hash stable between the turn that proposed it and the turn that
 * approves it.
 */
export function actionsForPlanQuery(agencyId: number, planId: string) {
  return db(AGENT_ACTIONS_TABLE).where({ agencyId, planId }).orderBy('id', 'asc')
}

export async function listActionsForPlan(agencyId: number, planId: string): Promise<ActionRecord[]> {
  const rows = (await actionsForPlanQuery(agencyId, planId)) as Row[]
  return rows.map(toActionRecord)
}

/** One action by its minted id. Agency-scoped: an id is not a capability. */
export async function findActionByActionId(agencyId: number, actionId: string): Promise<ActionRecord | null> {
  const row = (await db(AGENT_ACTIONS_TABLE).where({ agencyId, actionId }).first()) as Row | undefined
  return row ? toActionRecord(row) : null
}

/**
 * The reconciliation queue: rows whose outcome nobody knows.
 *
 * `UNKNOWN` always qualifies. `EXECUTING` only once the lease has passed, which
 * is expressed as a timestamp bound rather than filtered in memory so the
 * partial index on ("agencyId","executionState") does the work.
 */
export function unresolvedActionsQuery(args: { agencyId: number; staleBefore: Date; limit?: number }) {
  return db(AGENT_ACTIONS_TABLE)
    .where({ agencyId: args.agencyId })
    .andWhere((b) =>
      b.where({ executionState: 'UNKNOWN' }).orWhere((c) =>
        c.where({ executionState: 'EXECUTING' }).andWhere('updatedAt', '<', args.staleBefore),
      ),
    )
    .orderBy('updatedAt', 'asc')
    .limit(Math.min(Math.max(args.limit ?? 50, 1), 200))
}

export async function listUnresolvedActions(args: { agencyId: number; staleBefore: Date; limit?: number }): Promise<ActionRecord[]> {
  const rows = (await unresolvedActionsQuery(args)) as Row[]
  return rows.map(toActionRecord)
}

/** Agency-scoped audit read, newest first. Never reachable by a model. */
export function agentActionsQuery(args: { agencyId: number; agentRunId?: string; limit?: number }) {
  const q = db(AGENT_ACTIONS_TABLE).where({ agencyId: args.agencyId })
  if (args.agentRunId) q.andWhere({ agentRunId: args.agentRunId })
  return q.orderBy('createdAt', 'desc').limit(Math.min(Math.max(args.limit ?? 50, 1), 200))
}
