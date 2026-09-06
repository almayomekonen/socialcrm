import 'server-only'
import { z } from 'zod'
import { db } from '@/config/db'
import { isAdmin } from '@/types/roles'
import { createSystemTask } from '@/lib/system/createSystemTask'
import type { AgentActionDefinition, ExecuteContext } from '../registry'
import type { ActionProposal, ExecutionResult, VerificationCheck, VerificationResult } from '../types'

/**
 * `create_task` — the first, and for now the only, action the Agent can perform.
 *
 * IT DOES NOT CREATE A TASK. `createSystemTask` does, and it already did before
 * this file existed: the same insert the inbound-lead webhooks use. What lives
 * here is everything the runtime needs around that insert — what a valid
 * argument is, who is allowed to be the target, and how to prove afterwards that
 * the row is what was asked for. Re-implementing the insert to add an agent
 * flavour of it would give the product two definitions of what a task is.
 *
 * WHY NOT THE `createTask` SERVER ACTION. It is the USER-facing boundary and
 * calls `requireProductAccess()`, which re-derives identity from the request
 * cookie. The runtime has already resolved authority — that is the entire point
 * of `ActionActor` — and re-deriving it inside an executor would mean the actor
 * that was authorised and the actor that acts could differ, and would break the
 * session-less paths outright. `createSystemTask` is the session-independent
 * primitive for exactly this reason.
 *
 * WHICH IS WHY THE TENANT CHECK IS HERE, AND FIRST. `createSystemTask` performs
 * none, by design: its contract says the tenant was established upstream. For
 * the Agent, upstream is this function, so before anything is written the lead
 * must be shown to belong to the acting agency. `tasks` has no `agencyId` column
 * at all — a task's tenant IS its lead's — so a task created against another
 * agency's lead would be silently, permanently misfiled.
 */

const createTaskArgs = z.object({
  /** A lead id that came from a tool result. Never a name, never a guess. */
  clientId: z.number().int().positive(),
  /** `tasks.title` is varchar(255); the bound is the column's, not a preference. */
  title: z.string().trim().min(1).max(255),
  /**
   * `YYYY-MM-DD`. The column is a DATE and stores no time of day, so a value
   * carrying one is rejected rather than silently truncated — "tomorrow at 10"
   * must not become a task the rep believes is scheduled for 10.
   */
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export type CreateTaskArgs = z.infer<typeof createTaskArgs>

type TaskRow = { id: number; clientId: number; title: string; dueDate: string; userId: number | null; agencyId: number }

/**
 * The one read that establishes a task's tenant, used by both verify and probe.
 * The join is the whole point: `tasks` carries no agency, so ownership can only
 * be proven through the lead.
 */
function taskWithTenantQuery(agencyId: number) {
  return db('tasks as t')
    .join('clients as c', 'c.id', 't.clientId')
    .where('c.agencyId', agencyId)
    .select(
      't.id',
      't.clientId',
      't.title',
      't.userId',
      'c.agencyId',
      // Rendered in SQL so a DATE column cannot arrive as a timezone-shifted
      // Date object and fail a comparison it should pass.
      db.raw(`to_char(t."dueDate", 'YYYY-MM-DD') as "dueDate"`),
    )
}

function checksFor(row: TaskRow, args: CreateTaskArgs, actorUserId: number): VerificationCheck[] {
  return [
    { name: 'agencyOwnership', ok: row.agencyId != null, expected: 'lead in acting agency', actual: row.agencyId },
    { name: 'clientId', ok: row.clientId === args.clientId, expected: args.clientId, actual: row.clientId },
    { name: 'title', ok: row.title === args.title, expected: args.title, actual: row.title },
    { name: 'dueDate', ok: row.dueDate === args.dueDate, expected: args.dueDate, actual: row.dueDate },
    { name: 'assignee', ok: row.userId === actorUserId, expected: actorUserId, actual: row.userId },
  ]
}

async function execute(action: ActionProposal, ctx: ExecuteContext): Promise<ExecutionResult> {
  const parsed = createTaskArgs.safeParse(action.args)
  // Argument validation happens BEFORE anything is written, and returns rather
  // than throws: a throw would be classified UNKNOWN by the runtime, which is
  // the one verdict this case definitely does not deserve.
  if (!parsed.success) return { status: 'INVALID_ACTION', reason: 'invalid-args' }
  const args = parsed.data

  /**
   * Agency AND owner, matching the product's own `createTask`, which calls
   * `assertClientAccess`. Agency alone would let a rep put a task on a
   * colleague's lead — an agency-scoped write that is still not an authorised
   * one. Admins are unrestricted here exactly as they are everywhere else.
   */
  const leadQuery = db('clients').where({ id: args.clientId, agencyId: ctx.actor.agencyId })
  if (!isAdmin(ctx.actor.role as Parameters<typeof isAdmin>[0])) {
    leadQuery.whereIn('userId', ctx.actor.gotPermIds)
  }
  const lead = await leadQuery.first('id')
  if (!lead) return { status: 'NOT_AUTHORIZED', reason: 'lead-not-in-agency' }

  const taskId = await createSystemTask({
    clientId: args.clientId,
    title: args.title,
    userId: ctx.actor.userId,
    dueDate: args.dueDate,
  })

  return { status: 'SUCCESS', targetIds: [{ kind: 'task', id: String(taskId) }] }
}

async function verify(
  action: ActionProposal,
  execution: ExecutionResult,
  ctx: ExecuteContext,
): Promise<VerificationResult> {
  const parsed = createTaskArgs.safeParse(action.args)
  if (!parsed.success) return { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'invalid-args' }

  const target = execution.targetIds?.find((t) => t.kind === 'task')
  if (!target) return { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'no-target-id' }

  // Scoped by agency in the query itself: a task belonging to another tenant is
  // NOT_FOUND here, never a row this function could accidentally approve.
  const row = (await taskWithTenantQuery(ctx.actor.agencyId).andWhere('t.id', Number(target.id)).first()) as TaskRow | undefined
  if (!row) {
    return { state: 'NOT_FOUND', verified: false, checks: [], reason: 'task-not-found-in-agency', targetIds: [target] }
  }

  const checks = checksFor(row, parsed.data, ctx.actor.userId)
  const allOk = checks.every((c) => c.ok)
  return {
    state: allOk ? 'VERIFIED' : 'MISMATCH',
    verified: allOk,
    checks,
    targetIds: [{ kind: 'task', id: String(row.id) }],
    reason: allOk ? null : 'postcondition-mismatch',
  }
}

/**
 * NO PROBE — deliberately, and this is a decision rather than an omission.
 *
 * A probe would have to find a crashed run's task from its arguments alone,
 * which means matching on lead + title + due date and hoping no similar task was
 * created by a person in the same window. That heuristic resolves some rows
 * correctly and silently resolves others wrongly, and a wrongly-resolved row is
 * worse than an unresolved one: it either hides a task that was never created or
 * adopts one a rep made by hand.
 *
 * So a stale `create_task` goes to NEEDS_HUMAN, which is the honest answer until
 * the insert carries a correlation id that makes the search exact.
 */
/**
 * LOW_RISK_WRITE, and the risk class is an honest description rather than a
 * convenience.
 *
 * A task is internal, visible only to the agency that owns the lead, reversible
 * by deleting a row, and sends nothing to a customer. The worst outcome of a
 * wrong one is a rep seeing a line they did not expect. It was
 * APPROVAL_REQUIRED in the first slice because it was the first write the
 * product had ever performed and caution was worth more than convenience;
 * keeping it there would have meant asking a rep who typed "תיצור לי משימה"
 * whether they meant it, which is the product failing to listen.
 *
 * `requiresApproval` is deliberately UNSET, so the risk ladder decides: an
 * explicit instruction executes, an agent-initiated proposal waits. Sending a
 * message or deleting a record will not be able to make the same claim.
 */
export const createTaskAction: AgentActionDefinition = {
  type: 'create_task',
  argsSchema: createTaskArgs as never,
  risk: 'LOW_RISK_WRITE',
  execute,
  verify,
}
