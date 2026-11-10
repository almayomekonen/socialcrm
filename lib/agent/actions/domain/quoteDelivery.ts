import 'server-only'
import { z } from 'zod'
import { db } from '@/config/db'
import { editQuoteSystem, type EditQuoteFailure } from '@/db/quotes/editQuote'
import { findQuoteDeliveryByAction } from '@/db/quotes/deliveries'
import { canDraftQuote, canSendQuote } from '@/lib/quotes/permissions'
import { sendQuoteToCustomer } from '@/lib/waAssistant/quotes/customerSend'
import { isAdmin, type Roles } from '@/types/roles'
import type { UserDb } from '@/db/auth'
import type { AgentActionDefinition, ExecuteContext } from '../registry'
import type { ActionProposal, ExecutionResult, VerificationResult } from '../types'

/**
 * `send_quote` and `edit_quote`: application-proposed only (SystemActionProposal).
 *
 * `send_quote` IS THE APPROVAL BINDING. Its arguments are the exact quote
 * version, PDF, customer number and business number on the owner's card; they
 * are inside the argsHash the card's token names, and `sendQuoteToCustomer`
 * compares every one with the current rows before it sends. No model output can
 * name this type. APPROVAL_REQUIRED for now: admins and managers only.
 *
 * THE CARD IS THE ONLY WAY IN. `decideOnAction` is also reachable from the web
 * approval action, which has no single-use token, no expiry and no supersede.
 * Both executors therefore require this action's token to have been consumed as
 * `approved`, so no other path can run them.
 */

const sendArgs = z.object({
  quoteId: z.number().int().positive(),
  version: z.number().int().positive(),
  documentId: z.number().int().positive(),
  contentHash: z.string().min(1),
  leadId: z.number().int().positive(),
  customerPhoneE164: z.string().min(1),
  businessPhoneNumberId: z.string().min(1),
})

/** The role alone is not enough: this user must be able to see this lead right now. */
async function leadVisible(ctx: ExecuteContext, leadId: number): Promise<boolean> {
  const q = db('clients').where({ id: leadId, agencyId: ctx.actor.agencyId })
  if (!isAdmin(ctx.actor.role as Roles)) q.whereIn('userId', ctx.actor.gotPermIds ?? [])
  return Boolean(await q.first('id'))
}

const cardApproved = async (ctx: ExecuteContext, actionId: string) => Boolean(await db('wa_assistant_approvals').where({ agencyId: ctx.actor.agencyId, userId: ctx.actor.userId, actionId, status: 'approved' }).first('id'))

async function executeSend(action: ActionProposal, ctx: ExecuteContext): Promise<ExecutionResult> {
  const parsed = sendArgs.safeParse(action.args)
  if (!parsed.success) return { status: 'INVALID_ACTION', reason: 'invalid-args' }
  if (!(await cardApproved(ctx, action.actionId))) return { status: 'NOT_AUTHORIZED', reason: 'no-approved-card' }
  if (!canSendQuote({ role: ctx.actor.role } as UserDb)) return { status: 'NOT_AUTHORIZED', reason: 'role-may-not-send-quotes' }
  if (!(await leadVisible(ctx, parsed.data.leadId))) return { status: 'NOT_AUTHORIZED', reason: 'lead-not-in-agency-or-not-permitted' }

  const r = await sendQuoteToCustomer({ agencyId: ctx.actor.agencyId, userId: ctx.actor.userId, actionId: action.actionId, args: parsed.data, nowMs: ctx.nowMs })
  switch (r.kind) {
    case 'accepted':
      return { status: 'SUCCESS', targetIds: [{ kind: 'quote_delivery', id: String(r.deliveryId) }] }
    case 'duplicate':
      if (r.delivery.actionId !== action.actionId) return { status: 'FAILED', reason: 'quote-send-already-sent' }
      if (r.delivery.state === 'unknown' || r.delivery.state === 'sending') return { status: 'UNKNOWN', reason: 'quote-send-unknown' }
      if (r.delivery.state === 'failed') return { status: 'FAILED', reason: 'quote-send-failed' }
      return { status: 'SUCCESS', targetIds: [{ kind: 'quote_delivery', id: String(r.delivery.id) }], detail: { repeated: true } }
    case 'unknown':
      return { status: 'UNKNOWN', reason: 'quote-send-unknown' }
    case 'stale':
      return { status: 'FAILED', reason: 'quote-send-stale' }
    case 'opted_out':
      return { status: 'FAILED', reason: 'quote-send-opted-out' }
    case 'failed':
      return { status: 'FAILED', reason: 'quote-send-failed', detail: { code: r.code } }
    case 'no_channel':
      return { status: 'FAILED', reason: 'quote-send-no-channel' }
    case 'no_target':
      return { status: 'FAILED', reason: 'quote-send-no-target' }
    case 'disabled':
      return { status: 'NOT_AUTHORIZED', reason: 'quote-send-disabled' }
  }
}

async function readSend(action: ActionProposal, ctx: ExecuteContext): Promise<VerificationResult> {
  const parsed = sendArgs.safeParse(action.args)
  if (!parsed.success) return { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'invalid-args' }
  const row = await findQuoteDeliveryByAction(ctx.actor.agencyId, action.actionId)
  if (!row) return { state: 'NOT_FOUND', verified: false, checks: [], reason: 'delivery-not-found' }
  const checks = [
    { name: 'quote', ok: row.quoteId === parsed.data.quoteId, expected: parsed.data.quoteId, actual: row.quoteId },
    { name: 'version', ok: row.quoteVersion === parsed.data.version, expected: parsed.data.version, actual: row.quoteVersion },
    { name: 'document', ok: row.documentId === parsed.data.documentId, expected: parsed.data.documentId, actual: row.documentId },
    { name: 'accepted', ok: ['accepted', 'delivered', 'read'].includes(row.state), expected: 'accepted by WhatsApp', actual: row.state },
  ]
  const ok = checks.every((c) => c.ok)
  return { state: ok ? 'VERIFIED' : 'MISMATCH', verified: ok, checks, targetIds: [{ kind: 'quote_delivery', id: String(row.id) }], reason: ok ? null : 'postcondition-mismatch' }
}

export const sendQuoteAction: AgentActionDefinition = {
  type: 'send_quote',
  argsSchema: sendArgs as never,
  risk: 'APPROVAL_REQUIRED',
  requiresApproval: true,
  execute: executeSend,
  verify: (action, _execution, ctx) => readSend(action, ctx),
  probe: readSend,
}

const editArgs = z.object({
  quoteId: z.number().int().positive(),
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1),
  lines: z.array(z.object({ title: z.string().trim().min(1), description: z.string(), quantity: z.number().positive(), unitPrice: z.number().min(0), discount: z.number().min(0) })).min(1),
  validityDays: z.number().int().positive().nullable(),
  expectedTotalAmount: z.number().min(0),
  expectedRatePercent: z.number().min(0),
})

const EDIT_STALE: readonly EditQuoteFailure[] = ['not_editable', 'already_sent', 'version_conflict', 'tax_rate_missing', 'rate_changed', 'total_mismatch']

async function executeEdit(action: ActionProposal, ctx: ExecuteContext): Promise<ExecutionResult> {
  const parsed = editArgs.safeParse(action.args)
  if (!parsed.success) return { status: 'INVALID_ACTION', reason: 'invalid-args' }
  if (!(await cardApproved(ctx, action.actionId))) return { status: 'NOT_AUTHORIZED', reason: 'no-approved-card' }
  if (!canDraftQuote({ role: ctx.actor.role } as UserDb)) return { status: 'NOT_AUTHORIZED', reason: 'role-may-not-draft-quotes' }
  const r = await editQuoteSystem({
    ...parsed.data,
    validityDays: parsed.data.validityDays ?? null,
    agencyId: ctx.actor.agencyId,
    actionId: action.actionId,
    actorUserId: ctx.actor.userId,
    visibility: { user: { role: ctx.actor.role as Roles }, gotPermIds: ctx.actor.gotPermIds ?? [] },
    nowMs: ctx.nowMs,
  })
  if (r.ok === false) {
    const reason = (r as { reason: EditQuoteFailure }).reason
    if (reason === 'quote_not_found') return { status: 'NOT_AUTHORIZED', reason: 'quote-not-in-agency-or-not-permitted' }
    return EDIT_STALE.includes(reason) ? { status: 'FAILED', reason: `quote-edit-${reason}` } : { status: 'INVALID_ACTION', reason: `quote-edit-${reason}` }
  }
  return { status: 'SUCCESS', targetIds: [{ kind: 'quote', id: String(parsed.data.quoteId) }], detail: { version: r.version, applied: r.applied } }
}

async function readEdit(action: ActionProposal, ctx: ExecuteContext): Promise<VerificationResult> {
  const parsed = editArgs.safeParse(action.args)
  if (!parsed.success) return { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'invalid-args' }
  const row = (await db('sales_quotes').where({ id: parsed.data.quoteId, agencyId: ctx.actor.agencyId }).first('id', 'version', 'totalAmount', 'metadata')) as
    | { id: number; version: number; totalAmount: string; metadata: Record<string, unknown> | null }
    | undefined
  if (!row) return { state: 'NOT_FOUND', verified: false, checks: [], reason: 'quote-not-found' }
  const checks = [
    { name: 'edit', ok: row.metadata?.lastEditActionId === action.actionId, expected: 'this action', actual: row.metadata?.lastEditActionId === action.actionId ? 'same' : 'different' },
    { name: 'version', ok: Number(row.version) === parsed.data.expectedVersion + 1, expected: parsed.data.expectedVersion + 1, actual: Number(row.version) },
    { name: 'total', ok: Number(row.totalAmount) === parsed.data.expectedTotalAmount, expected: parsed.data.expectedTotalAmount, actual: Number(row.totalAmount) },
  ]
  const ok = checks.every((c) => c.ok)
  return { state: ok ? 'VERIFIED' : 'MISMATCH', verified: ok, checks, targetIds: [{ kind: 'quote', id: String(row.id) }], reason: ok ? null : 'postcondition-mismatch' }
}

export const editQuoteAction: AgentActionDefinition = {
  type: 'edit_quote',
  argsSchema: editArgs as never,
  risk: 'LOW_RISK_WRITE',
  requiresApproval: true,
  execute: executeEdit,
  verify: (action, _execution, ctx) => readEdit(action, ctx),
  probe: readEdit,
}
