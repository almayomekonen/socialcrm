import 'server-only'
import { z } from 'zod'
import { db } from '@/config/db'
import { LEAD_STATUSES } from '@/lib/mcp/present'
import { updateLeadStatusSystem } from '@/lib/system/updateLeadStatusSystem'
import type { AgentActionDefinition, ExecuteContext } from '../registry'
import type { ActionProposal, ExecutionResult, VerificationResult } from '../types'

/**
 * `update_lead_status` — move a lead to one of the five SocialCRM statuses.
 *
 * WHATSAPP ONLY for now: the web Agent's action card has no rendering for it
 * (actions/ai/askAgent.ts drops it there). The write is
 * `updateLeadStatusSystem`, the session-less counterpart of the web status
 * dropdown, so the transition log, notifications and automations are the same
 * ones a manual change fires.
 *
 * `fromStatus` is part of the ARGUMENTS, so it is inside the argsHash the
 * approval card binds: the owner approved "from X to Y", and the executor
 * refuses if the lead is no longer X (FAILED, `status-changed-since-proposal`),
 * rather than overwriting a change the owner never saw.
 *
 * ALWAYS A CARD (`requiresApproval`), whatever the phrasing: a status change can
 * fire the business's own automations, including messages to the lead.
 */

const updateLeadStatusArgs = z.object({
  clientId: z.number().int().positive(),
  status: z.enum(LEAD_STATUSES),
  /** Filled by the application from the lead row before the card is shown. Never the model's. */
  fromStatus: z.string().nullable(),
})

export type UpdateLeadStatusArgs = z.infer<typeof updateLeadStatusArgs>

async function execute(action: ActionProposal, ctx: ExecuteContext): Promise<ExecutionResult> {
  const parsed = updateLeadStatusArgs.safeParse(action.args)
  if (!parsed.success) return { status: 'INVALID_ACTION', reason: 'invalid-args' }
  const args = parsed.data

  const r = await updateLeadStatusSystem({
    leadId: args.clientId,
    agencyId: ctx.actor.agencyId,
    role: ctx.actor.role,
    gotPermIds: ctx.actor.gotPermIds,
    actorUserId: ctx.actor.userId,
    fromStatus: args.fromStatus,
    toStatus: args.status,
    nowMs: ctx.nowMs,
  })
  if (r.result === 'not_permitted') return { status: 'NOT_AUTHORIZED', reason: 'lead-not-in-agency-or-not-permitted' }
  if (r.result === 'stale') return { status: 'FAILED', reason: 'status-changed-since-proposal' }
  return {
    status: 'SUCCESS',
    targetIds: [{ kind: 'lead', id: String(args.clientId) }],
    detail: { alreadyInStatus: r.result === 'already' },
  }
}

/** Re-read by the ARGUMENTS' lead and the authenticated agency: the status must be the one approved. */
async function readBack(action: ActionProposal, ctx: ExecuteContext): Promise<VerificationResult> {
  const parsed = updateLeadStatusArgs.safeParse(action.args)
  if (!parsed.success) return { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'invalid-args' }
  const args = parsed.data
  const row = (await db('clients')
    .where({ id: args.clientId, agencyId: ctx.actor.agencyId })
    .first('id', 'status', 'firstName', 'lastName')) as
    | { id: number; status: string | null; firstName: string | null; lastName: string | null }
    | undefined
  if (!row) return { state: 'NOT_FOUND', verified: false, checks: [], reason: 'lead-not-found-in-agency' }
  const ok = row.status === args.status
  const label = [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || undefined
  return {
    state: ok ? 'VERIFIED' : 'MISMATCH',
    verified: ok,
    checks: [{ name: 'status', ok, expected: args.status, actual: row.status }],
    targetIds: [{ kind: 'lead', id: String(row.id), label }],
    reason: ok ? null : 'postcondition-mismatch',
  }
}

export const updateLeadStatusAction: AgentActionDefinition = {
  type: 'update_lead_status',
  argsSchema: updateLeadStatusArgs as never,
  risk: 'LOW_RISK_WRITE',
  requiresApproval: true,
  execute,
  verify: (action, _execution, ctx) => readBack(action, ctx),
  // From the arguments alone: is the lead in the approved status?
  probe: readBack,
}
