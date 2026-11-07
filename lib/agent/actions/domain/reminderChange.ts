import 'server-only'
import { z } from 'zod'
import { db } from '@/config/db'
import { cancelOwnReminder, rescheduleOwnReminder } from '@/db/ownerPersonalReminders/change'
import { readOwnedReminder } from '@/db/ownerPersonalReminders/lock'
import type { AgentActionDefinition, ExecuteContext } from '../registry'
import type { ActionProposal, ExecutionResult, VerificationResult } from '../types'

/**
 * `cancel_reminder` (T4) and `reschedule_reminder` (T6): an approved card
 * changes one version of the owner's own reminder. Application-proposed, always
 * approved, guarded on the version, and verified by reading the row back.
 * Not reachable from any surface yet.
 */

const ref = (row: { id: number }) => [{ kind: 'reminder', id: String(row.id) }]
const unverifiable = { state: 'UNVERIFIABLE' as const, verified: false, checks: [], reason: 'invalid-args' }

const cancelArgs = z.object({ reminderId: z.number().int().positive(), version: z.number().int().positive() })

async function cancelExecute(action: ActionProposal, ctx: ExecuteContext): Promise<ExecutionResult> {
  const p = cancelArgs.safeParse(action.args)
  if (!p.success) return { status: 'INVALID_ACTION', reason: 'invalid-args' }
  const r = await cancelOwnReminder({ ...p.data, actionId: action.actionId, owner: { agencyId: ctx.actor.agencyId, userId: ctx.actor.userId }, nowMs: ctx.nowMs })
  if (r.kind === 'cancelled' || r.kind === 'already_cancelled') {
    return { status: 'SUCCESS', targetIds: [{ kind: 'reminder', id: String(r.reminderId) }], detail: { alreadyCancelled: r.kind === 'already_cancelled' } }
  }
  if (r.kind === 'not_found') return { status: 'NOT_AUTHORIZED', reason: 'reminder-not-owned' }
  // An in-flight or sent reminder is a definite, honest "no": nothing was changed.
  const reason = 'reason' in r ? r.reason : 'unknown'
  return { status: reason === 'stale_version' ? 'INVALID_ACTION' : 'FAILED', reason }
}

async function cancelReadBack(action: ActionProposal, ctx: ExecuteContext): Promise<VerificationResult> {
  const p = cancelArgs.safeParse(action.args)
  if (!p.success) return unverifiable
  const row = await readOwnedReminder(db, p.data.reminderId, ctx.actor.agencyId)
  if (!row) return { state: 'NOT_FOUND', verified: false, checks: [], reason: 'reminder-not-found' }
  if (row.status === 'cancelled') return { state: 'VERIFIED', verified: true, checks: [{ name: 'status', ok: true, expected: 'cancelled', actual: row.status }], targetIds: ref(row), reason: null }
  // Still cancellable at the same version: the cancel did not land.
  if ((row.status === 'scheduled' || row.status === 'claimed') && row.version === p.data.version) {
    return { state: 'NOT_FOUND', verified: false, checks: [{ name: 'status', ok: false, expected: 'cancelled', actual: row.status }], targetIds: ref(row), reason: 'not-cancelled' }
  }
  return { state: 'MISMATCH', verified: false, checks: [{ name: 'status', ok: false, expected: 'cancelled', actual: row.status }], targetIds: ref(row), reason: 'postcondition-mismatch' }
}

export const cancelReminderAction: AgentActionDefinition = {
  type: 'cancel_reminder',
  argsSchema: cancelArgs as never,
  risk: 'LOW_RISK_WRITE',
  requiresApproval: true,
  execute: cancelExecute,
  verify: (action, _execution, ctx) => cancelReadBack(action, ctx),
  probe: cancelReadBack,
}

const rescheduleArgs = z.object({
  reminderId: z.number().int().positive(),
  version: z.number().int().positive(),
  remindAt: z.string().datetime(),
  /** Meta timestamp (ms) of the verified reschedule request: the horizon anchor. */
  requestAnchorMs: z.number().int().positive(),
})

async function rescheduleExecute(action: ActionProposal, ctx: ExecuteContext): Promise<ExecutionResult> {
  const p = rescheduleArgs.safeParse(action.args)
  if (!p.success) return { status: 'INVALID_ACTION', reason: 'invalid-args' }
  const r = await rescheduleOwnReminder({
    reminderId: p.data.reminderId,
    version: p.data.version,
    remindAtMs: Date.parse(p.data.remindAt),
    requestAnchorMs: p.data.requestAnchorMs,
    actionId: action.actionId,
    owner: { agencyId: ctx.actor.agencyId, userId: ctx.actor.userId },
    nowMs: ctx.nowMs,
  })
  if (r.kind === 'rescheduled' || r.kind === 'replayed') {
    return { status: 'SUCCESS', targetIds: [{ kind: 'reminder', id: String(r.reminderId) }], detail: { version: r.version, replayed: r.kind === 'replayed' } }
  }
  if (r.kind === 'not_found') return { status: 'NOT_AUTHORIZED', reason: 'reminder-not-owned' }
  const reason = 'reason' in r ? r.reason : 'unknown'
  if (r.kind === 'rejected') return { status: 'FAILED', reason: `rejected:${reason}` }
  return { status: 'INVALID_ACTION', reason }
}

async function rescheduleReadBack(action: ActionProposal, ctx: ExecuteContext): Promise<VerificationResult> {
  const p = rescheduleArgs.safeParse(action.args)
  if (!p.success) return unverifiable
  const row = await readOwnedReminder(db, p.data.reminderId, ctx.actor.agencyId)
  if (!row) return { state: 'NOT_FOUND', verified: false, checks: [], reason: 'reminder-not-found' }
  const target = Date.parse(p.data.remindAt)
  const ok = row.version > p.data.version && row.remindAt.getTime() === target
  if (ok) return { state: 'VERIFIED', verified: true, checks: [{ name: 'remindAt', ok: true, expected: p.data.remindAt, actual: row.remindAt.toISOString() }], targetIds: ref(row), reason: null }
  if (row.status === 'scheduled' && row.version === p.data.version) {
    return { state: 'NOT_FOUND', verified: false, checks: [{ name: 'version', ok: false, expected: p.data.version + 1, actual: row.version }], targetIds: ref(row), reason: 'not-rescheduled' }
  }
  return { state: 'MISMATCH', verified: false, checks: [{ name: 'remindAt', ok: false, expected: p.data.remindAt, actual: row.remindAt.toISOString() }], targetIds: ref(row), reason: 'postcondition-mismatch' }
}

export const rescheduleReminderAction: AgentActionDefinition = {
  type: 'reschedule_reminder',
  argsSchema: rescheduleArgs as never,
  risk: 'LOW_RISK_WRITE',
  requiresApproval: true,
  execute: rescheduleExecute,
  verify: (action, _execution, ctx) => rescheduleReadBack(action, ctx),
  probe: rescheduleReadBack,
}
