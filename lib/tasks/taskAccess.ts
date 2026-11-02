import 'server-only'
import { db } from '@/config/db'
import { getPerms } from '@/db/filter'
import { isAdmin } from '@/types/roles'

/**
 * WHO MAY ACT ON A LEAD'S TASKS — the user-facing task actions (actions/tasks.ts).
 *
 * Before, the asserts checked the agency only, so a rep could edit or delete a
 * colleague's task inside the same agency. Now:
 *   - the lead must be in the actor's agency (a task has no agency of its own:
 *     its tenant IS its lead's);
 *   - unless the actor is an admin, the lead must be owned (`userId`) or created
 *     (`createdById`) by a rep the actor has permission for — the same
 *     visibility the task list (`createdById`, db/tasks.ts) and the Agent's
 *     task executor (`userId`, lib/agent/actions/domain/createTask.ts) use.
 */

type Actor = { id: number; agencyId?: number | null; role?: string | null; name?: string | null }

export async function canActOnLead(actor: Actor, clientId: unknown): Promise<boolean> {
  const id = Number(clientId)
  if (!actor?.agencyId || !Number.isSafeInteger(id) || id <= 0) return false
  const q = db('clients').where({ id, agencyId: actor.agencyId })
  if (!isAdmin(actor.role as Parameters<typeof isAdmin>[0])) {
    const { gotPermIds } = (await getPerms(actor as never)) as { gotPermIds: number[] }
    q.where((b) => b.whereIn('userId', gotPermIds).orWhereIn('createdById', gotPermIds))
  }
  return !!(await q.first('id'))
}

export async function canActOnTask(actor: Actor, taskId: unknown): Promise<boolean> {
  const id = Number(taskId)
  if (!Number.isSafeInteger(id) || id <= 0) return false
  const task = (await db('tasks').where({ id }).first('clientId')) as { clientId: number } | undefined
  return !!task && canActOnLead(actor, task.clientId)
}
