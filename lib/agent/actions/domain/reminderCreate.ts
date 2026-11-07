import 'server-only'
import { z } from 'zod'
import { db } from '@/config/db'
import { scheduleApprovedDraft } from '@/db/ownerPersonalReminders/schedule'
import { readOwnedReminder } from '@/db/ownerPersonalReminders/lock'
import type { AgentActionDefinition, ExecuteContext } from '../registry'
import type { ActionProposal, ExecutionResult, VerificationResult } from '../types'

/**
 * `create_reminder`: an approved card turns a personal-reminder DRAFT into a
 * scheduled reminder (T5, db/ownerPersonalReminders/schedule.ts).
 *
 * Proposed by the APPLICATION, never the model (SystemActionProposal). The
 * arguments are the draft's id, version and time; the text never enters
 * `agent_actions.args`, it lives only on the draft row. Approval is always
 * required, whatever the intent.
 *
 * Not reachable from any surface yet. The WhatsApp layer that proposes it
 * comes in a later phase, and the web Agent's allowlist drops unknown types.
 */

const args = z.object({
  reminderId: z.number().int().positive(),
  version: z.number().int().positive(),
  remindAt: z.string().datetime(),
})

async function execute(action: ActionProposal, ctx: ExecuteContext): Promise<ExecutionResult> {
  const parsed = args.safeParse(action.args)
  if (!parsed.success) return { status: 'INVALID_ACTION', reason: 'invalid-args' }
  const r = await scheduleApprovedDraft({
    reminderId: parsed.data.reminderId,
    version: parsed.data.version,
    remindAtMs: Date.parse(parsed.data.remindAt),
    actionId: action.actionId,
    owner: { agencyId: ctx.actor.agencyId, userId: ctx.actor.userId },
    nowMs: ctx.nowMs,
  })
  if (r.kind === 'scheduled' || r.kind === 'replayed') {
    return { status: 'SUCCESS', targetIds: [{ kind: 'reminder', id: String(r.reminderId) }], detail: { replayed: r.kind === 'replayed' } }
  }
  if (r.kind === 'not_found') return { status: 'NOT_AUTHORIZED', reason: 'reminder-not-owned' }
  const reason = 'reason' in r ? r.reason : 'unknown'
  if (r.kind === 'rejected') return { status: 'FAILED', reason: `rejected:${reason}` }
  return { status: 'INVALID_ACTION', reason }
}

/** VERIFIED only when the row carries THIS action as its creator. */
async function readBack(action: ActionProposal, ctx: ExecuteContext): Promise<VerificationResult> {
  const parsed = args.safeParse(action.args)
  if (!parsed.success) return { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'invalid-args' }
  const row = await readOwnedReminder(db, parsed.data.reminderId, ctx.actor.agencyId)
  if (!row || row.createdByActionId === null) {
    return { state: 'NOT_FOUND', verified: false, checks: [], reason: row ? 'not-scheduled' : 'reminder-not-found' }
  }
  const ok = row.createdByActionId === action.actionId && row.status !== 'proposed'
  return {
    state: ok ? 'VERIFIED' : 'MISMATCH',
    verified: ok,
    checks: [{ name: 'createdByActionId', ok, expected: action.actionId, actual: row.createdByActionId }],
    targetIds: [{ kind: 'reminder', id: String(row.id) }],
    reason: ok ? null : 'scheduled-by-another-action',
  }
}

export const createReminderAction: AgentActionDefinition = {
  type: 'create_reminder',
  argsSchema: args as never,
  risk: 'LOW_RISK_WRITE',
  requiresApproval: true,
  execute,
  verify: (action, _execution, ctx) => readBack(action, ctx),
  // Reconciliation: the postcondition is the creator id on the row, nothing else.
  probe: readBack,
}
