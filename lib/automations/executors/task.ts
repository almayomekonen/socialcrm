import { createSystemTask } from '@/lib/system/createSystemTask'
import { getLeadHandlerId } from '@/db/automations/leadFacts'
import type { ActionExecutor, ExecutionContext, PreflightResult } from './types'

/**
 * `task.create` — the second action, and the one the frozen §3.8 table names
 * as the correctness case: a SUPPRESSED lead must still get a task.
 *
 * Suppression is consent not to be contacted; it says nothing about the rep's
 * own workflow. That is expressed entirely in the catalog entry's `laws` list
 * (`send_once` and nothing else), so nothing here enforces it.
 *
 * B6b proved this costs a catalog entry and an executor. This file is the
 * whole of the second half.
 */

export type TaskReady = { title: string; handlerId: number | null }

export type TaskDeps = {
  handlerId: (agencyId: number, leadId: number) => Promise<number | null>
  createTask: (input: { clientId: number; title: string; userId: number }) => Promise<number>
}

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export const taskExecutor: ActionExecutor<TaskReady, TaskDeps> = {
  actionKey: 'task.create',
  // A task title is read by the rep, not the lead. The lead's own name is the
  // only variable that makes it more useful, so that is all it resolves.
  resolvableFields: ['leadFirstName'],

  defaultDeps: () => ({ handlerId: getLeadHandlerId, createTask: createSystemTask }),

  /**
   * A task needs an owner. A lead with no handler has nobody to assign to, and
   * inventing one would put work in a stranger's list — so it is a
   * configuration fault, resolved before the claim like every other.
   */
  async preflight(ctx: ExecutionContext, deps: TaskDeps): Promise<PreflightResult<TaskReady>> {
    const handlerId = await deps.handlerId(ctx.agencyId, ctx.leadId)
    const title = asText(ctx.parameters.title)
    const ready: TaskReady = { title, handlerId }
    if (handlerId) return { ready, problem: null }
    return {
      ready,
      problem: {
        reason: 'no_handler',
        deadReason: 'task_unavailable:no_handler',
        warnTransition: 'task_incomplete',
        logClass: 'assignment',
      },
    }
  },

  async execute(ctx: ExecutionContext, ready: TaskReady, deps: TaskDeps) {
    const name = typeof ctx.subject.leadFirstName === 'string' ? ctx.subject.leadFirstName : ''
    const title = ready.title
      .split('{{שם הליד}}')
      .join(name)
      .replace(/\s{2,}/g, ' ')
      .trim()

    if (ctx.mode !== 'live' || !ready.handlerId) {
      return { kind: 'would_send' as const, summary: title, log: { reason: 'log_mode', title } }
    }

    const id = await deps.createTask({ clientId: ctx.leadId, title, userId: ready.handlerId })
    return {
      kind: 'sent' as const,
      summary: title,
      log: { reason: 'task_created', taskId: id },
    }
  },
}
