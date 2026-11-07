import 'server-only'
import { db } from '@/config/db'
import { AGENT_ACTIONS_TABLE, createDbActionStore, toActionRecord } from '@/db/agentActions'
import { reconcileAction, type ReconciliationVerdict } from '@/lib/agent/actions/reconcile'
import { EXECUTION_LEASE_MS } from '@/lib/agent/actions/idempotency'
import { registerDomainActions } from '@/lib/agent/actions/domain'

/**
 * T16: resolve personal-reminder actions whose outcome nobody knows (an
 * executor that died mid-transaction), across agencies. Architecture v1.6 §2.
 *
 * Each row goes through the runtime's own `reconcileAction`: the action's probe
 * reads the reminder row, and the verdict is written with a guarded update.
 *   VERIFIED  → SUCCEEDED (the scheduling did land)
 *   NOT_FOUND → FAILED, retryable (it did not; a resume may run it again, and
 *               the executor's guard makes a second run safe)
 *   otherwise → left for a person
 * It never runs an executor itself. Not scheduled yet: the reminder cron
 * arrives in a later phase.
 */

export const REMINDER_ACTION_TYPES = ['create_reminder', 'cancel_reminder', 'reschedule_reminder'] as const

export async function reconcileReminderActions(nowMs: number, limit = 50): Promise<ReconciliationVerdict['kind'][]> {
  registerDomainActions()
  const rows = await db(AGENT_ACTIONS_TABLE)
    .whereIn('actionType', REMINDER_ACTION_TYPES as unknown as string[])
    .andWhere((b) =>
      b.where({ executionState: 'UNKNOWN' }).orWhere((c) =>
        c.where({ executionState: 'EXECUTING' }).andWhere('updatedAt', '<', new Date(nowMs - EXECUTION_LEASE_MS)),
      ),
    )
    .orderBy('updatedAt', 'asc')
    .limit(Math.min(Math.max(limit, 1), 200))
  const store = createDbActionStore()
  const verdicts: ReconciliationVerdict['kind'][] = []
  for (const row of rows) {
    verdicts.push((await reconcileAction(toActionRecord(row), { store, now: () => nowMs })).kind)
  }
  return verdicts
}
