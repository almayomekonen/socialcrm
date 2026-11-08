import 'server-only'
import { z } from 'zod'
import { db } from '@/config/db'
import { isAdmin } from '@/types/roles'
import type { AgentActionDefinition, ExecuteContext } from '../registry'
import type { ActionProposal, ExecutionResult, VerificationCheck, VerificationResult } from '../types'

/**
 * `update_task` and `complete_task`: changes to a task that already exists.
 *
 * The arguments come from the application, never the model. The model names a
 * lead and describes the task; lib/waAssistant/recordChanges/ resolves the row
 * inside the agency and freezes its id here, along with what the owner saw on
 * the card. So the write is conditional on the row still being what was shown:
 * a task edited after the card is reported, not overwritten.
 *
 * `tasks` has no agency column. Its tenant is its lead's, so every read goes
 * through the join, and a rep is limited to the leads of reps they have
 * permission for (the same bound as lib/tasks/taskAccess.ts).
 *
 * `requiresApproval` is set: unlike creating a row, these change something the
 * owner already relies on, so an approval card is required whatever the wording.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const ids = { taskId: z.number().int().positive(), clientId: z.number().int().positive() }

const updateArgs = z.object({
  ...ids,
  fromTitle: z.string(),
  fromDueDate: z.string().regex(DATE_RE).nullable(),
  title: z.string().trim().min(1).max(255),
  dueDate: z.string().regex(DATE_RE).nullable(),
})
const completeArgs = z.object(ids)

type Row = { id: number; clientId: number; title: string; dueDate: string | null; completed: boolean | null }

function readTask(ctx: ExecuteContext, taskId: number, clientId: number) {
  const q = db('tasks as t')
    .join('clients as c', 'c.id', 't.clientId')
    .where('c.agencyId', ctx.actor.agencyId)
    .where('t.id', taskId)
    .where('t.clientId', clientId)
  if (!isAdmin(ctx.actor.role as Parameters<typeof isAdmin>[0])) {
    const perms = ctx.actor.gotPermIds
    q.where((b) => b.whereIn('c.userId', perms).orWhereIn('c.createdById', perms))
  }
  return q.first('t.id', 't.clientId', 't.title', 't.completed', db.raw(`to_char(t."dueDate", 'YYYY-MM-DD') as "dueDate"`)) as Promise<Row | undefined>
}

const done = (taskId: number): ExecutionResult => ({ status: 'SUCCESS', targetIds: [{ kind: 'task', id: String(taskId) }] })

async function executeUpdate(action: ActionProposal, ctx: ExecuteContext): Promise<ExecutionResult> {
  const parsed = updateArgs.safeParse(action.args)
  if (!parsed.success) return { status: 'INVALID_ACTION', reason: 'invalid-args' }
  const a = parsed.data
  if (a.title === a.fromTitle && a.dueDate === a.fromDueDate) return { status: 'INVALID_ACTION', reason: 'nothing-to-change' }
  const row = await readTask(ctx, a.taskId, a.clientId)
  if (!row) return { status: 'NOT_AUTHORIZED', reason: 'task-not-in-agency' }
  if (row.title === a.title && row.dueDate === a.dueDate) return done(a.taskId)
  const changed = await db('tasks')
    .where({ id: a.taskId, title: a.fromTitle })
    .whereRaw(`to_char("dueDate", 'YYYY-MM-DD') IS NOT DISTINCT FROM ?`, [a.fromDueDate])
    .whereRaw('COALESCE(completed, false) = false')
    .update({ title: a.title, dueDate: a.dueDate })
  return changed === 1 ? done(a.taskId) : { status: 'FAILED', reason: 'changed-since-card' }
}

async function executeComplete(action: ActionProposal, ctx: ExecuteContext): Promise<ExecutionResult> {
  const parsed = completeArgs.safeParse(action.args)
  if (!parsed.success) return { status: 'INVALID_ACTION', reason: 'invalid-args' }
  const row = await readTask(ctx, parsed.data.taskId, parsed.data.clientId)
  if (!row) return { status: 'NOT_AUTHORIZED', reason: 'task-not-in-agency' }
  if (row.completed !== true) await db('tasks').where({ id: row.id }).update({ completed: true })
  return done(row.id)
}

function verifyWith(checksFor: (row: Row, args: never) => VerificationCheck[], schema: z.ZodTypeAny) {
  return async (action: ActionProposal, execution: ExecutionResult, ctx: ExecuteContext): Promise<VerificationResult> => {
    const parsed = schema.safeParse(action.args)
    if (!parsed.success) return { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'invalid-args' }
    const target = execution.targetIds?.find((t) => t.kind === 'task')
    if (!target) return { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'no-target-id' }
    const { taskId, clientId } = parsed.data as { taskId: number; clientId: number }
    const row = await readTask(ctx, taskId, clientId)
    if (!row) return { state: 'NOT_FOUND', verified: false, checks: [], reason: 'task-not-found-in-agency', targetIds: [target] }
    const checks = checksFor(row, parsed.data as never)
    const ok = checks.every((c) => c.ok)
    return { state: ok ? 'VERIFIED' : 'MISMATCH', verified: ok, checks, targetIds: [target], reason: ok ? null : 'postcondition-mismatch' }
  }
}

export const updateTaskAction: AgentActionDefinition = {
  type: 'update_task',
  argsSchema: updateArgs as never,
  risk: 'LOW_RISK_WRITE',
  requiresApproval: true,
  execute: executeUpdate,
  verify: verifyWith(
    (row, a: z.infer<typeof updateArgs>) => [
      { name: 'title', ok: row.title === a.title, expected: a.title, actual: row.title },
      { name: 'dueDate', ok: row.dueDate === a.dueDate, expected: a.dueDate, actual: row.dueDate },
    ],
    updateArgs,
  ),
}

export const completeTaskAction: AgentActionDefinition = {
  type: 'complete_task',
  argsSchema: completeArgs as never,
  risk: 'LOW_RISK_WRITE',
  requiresApproval: true,
  execute: executeComplete,
  verify: verifyWith((row) => [{ name: 'completed', ok: row.completed === true, expected: true, actual: row.completed }], completeArgs),
}
