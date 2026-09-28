import { db } from '@/config/db'
import type { CrmCounts } from './firewall'

/**
 * The firewall's readings, taken before the first question and after the last.
 *
 * SCOPED TO THE BENCHMARK'S OWN TENANTS, never global. The dev database this
 * runs against holds other agencies' rows, and an unrelated change elsewhere
 * must not be reported as the agent mutating the CRM.
 *
 * Global rather than per-case: a snapshot around all forty is one pair of
 * queries instead of eighty, and when it trips the culprit is re-derivable from
 * the per-case records the run preserves anyway — an unrequested write shows up
 * as a `proposedAction` or `proposedBatch` on exactly one case.
 */
const one = async (q: Promise<{ count: string }[]>): Promise<number> => Number((await q)[0]!.count)

export async function crmCounts(agencyIds: readonly number[]): Promise<CrmCounts> {
  const ids = [...agencyIds]
  return {
    tasks: await one(
      db('tasks').join('clients', 'clients.id', 'tasks.clientId').whereIn('clients.agencyId', ids).count<{ count: string }[]>('tasks.id as count'),
    ),
    followUps: await one(db('clients').whereIn('agencyId', ids).whereNotNull('nextFollowUpAt').count<{ count: string }[]>('id as count')),
    meetings: await one(db('meetings').whereIn('agency_id', ids).count<{ count: string }[]>('id as count')),
    agentActions: await one(db('agent_actions').whereIn('agencyId', ids).count<{ count: string }[]>('id as count')),
    agentActionApprovals: await one(db('agent_action_approvals').whereIn('agencyId', ids).count<{ count: string }[]>('id as count')),
  }
}
