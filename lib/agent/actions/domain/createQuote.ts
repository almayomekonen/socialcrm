import 'server-only'
import { z } from 'zod'
import { db } from '@/config/db'
import { createQuoteSystem, type CreateQuoteSystemFailure } from '@/db/quotes/createQuote'
import { findQuoteByAutomationKeyQuery } from '@/db/quotes/quotes'
import { canDraftQuote } from '@/lib/quotes/permissions'
import type { UserDb } from '@/db/auth'
import type { Roles } from '@/types/roles'
import type { AgentActionDefinition, ExecuteContext } from '../registry'
import type { ActionProposal, ExecutionResult, VerificationResult } from '../types'

/**
 * `create_quote` — one quote for one lead, from the owner's own figures.
 *
 * WHATSAPP ONLY (actions/ai/askAgent.ts drops it on the web). The arguments are
 * the APPLICATION's, built by lib/waAssistant/quotes/propose.ts after it
 * grounded every number in the owner's words, and they include the card's
 * `expectedTotalAmount` and `expectedRatePercent`. Both are inside the argsHash
 * the card binds, so the owner approved "this total at this rate", and
 * `createQuoteSystem` refuses (`total_mismatch` / `rate_changed`) rather than
 * storing a different number.
 *
 * CREATION ONLY. The quote is numbered and moved to `ready`; nothing is sent to
 * the customer, by this action or anything it calls.
 *
 * DUPLICATES: the runtime's idempotency claim, the single-use card token, and
 * underneath both the quote's own `automationKey` (`wa_quote:<actionId>`, unique
 * per agency). A retried or crashed execution finds the same quote; the probe
 * reconciles from that key alone.
 *
 * ALWAYS A CARD (`requiresApproval`), whatever the phrasing.
 */

const lineArgs = z.object({
  title: z.string().trim().min(1),
  quantity: z.number().positive(),
  unitAmount: z.number().min(0),
  discountAmount: z.number().min(0).nullable(),
})

const createQuoteArgs = z.object({
  clientId: z.number().int().positive(),
  title: z.string().trim().min(1),
  lines: z.array(lineArgs).min(1),
  priceBasis: z.enum(['incl_vat', 'excl_vat']).nullable(),
  validityDays: z.number().int().positive().nullable(),
  expectedTotalAmount: z.number().min(0),
  expectedRatePercent: z.number().min(0),
})

export type CreateQuoteArgs = z.infer<typeof createQuoteArgs>

export const quoteAutomationKey = (actionId: string) => `wa_quote:${actionId}`

const mayDraft = (role: string) => canDraftQuote({ role } as UserDb)

/** Refusals that mean "the world is not what the owner approved": nothing was written. */
const STALE: readonly CreateQuoteSystemFailure[] = ['tax_rate_missing', 'rate_changed', 'total_mismatch']

async function execute(action: ActionProposal, ctx: ExecuteContext): Promise<ExecutionResult> {
  const parsed = createQuoteArgs.safeParse(action.args)
  if (!parsed.success) return { status: 'INVALID_ACTION', reason: 'invalid-args' }
  if (!mayDraft(ctx.actor.role)) return { status: 'NOT_AUTHORIZED', reason: 'role-may-not-draft-quotes' }
  const a = parsed.data

  const r = await createQuoteSystem({
    agencyId: ctx.actor.agencyId,
    leadId: a.clientId,
    createdByUserId: ctx.actor.userId,
    title: a.title,
    lines: a.lines.map((l) => ({ title: l.title, quantity: l.quantity, unitAmount: l.unitAmount, discountAmount: l.discountAmount ?? undefined })),
    priceBasis: a.priceBasis,
    validityDays: a.validityDays,
    automationKey: quoteAutomationKey(action.actionId),
    expectedTotalAmount: a.expectedTotalAmount,
    expectedRatePercent: a.expectedRatePercent,
    finalize: true,
    // The lead must still be visible to this user NOW, not only when the card was made.
    visibility: { user: { role: ctx.actor.role as Roles }, gotPermIds: ctx.actor.gotPermIds ?? [] },
    metadata: { source: 'wa_assistant', actionId: action.actionId },
    nowMs: ctx.nowMs,
  })
  if (r.ok === false) {
    const reason = (r as { reason: CreateQuoteSystemFailure }).reason
    if (reason === 'lead_not_found') return { status: 'NOT_AUTHORIZED', reason: 'lead-not-in-agency-or-not-permitted' }
    if (STALE.includes(reason)) return { status: 'FAILED', reason: `quote-${reason}` }
    if (reason === 'conflict_unresolved') return { status: 'UNKNOWN', reason: 'quote-conflict-unresolved' }
    return { status: 'INVALID_ACTION', reason: `quote-${reason}` }
  }
  return {
    status: 'SUCCESS',
    targetIds: [{ kind: 'quote', id: String(r.quoteId) }],
    detail: { created: r.created, quoteNumber: r.quoteNumber, quoteYear: r.quoteYear },
  }
}

type QuoteRow = { id: number; agencyId: number; leadId: number; status: string; quoteNumber: number | null; totalAmount: string | number; automationKey: string | null }
const COLUMNS = ['id', 'agencyId', 'leadId', 'status', 'quoteNumber', 'totalAmount', 'automationKey'] as const

function result(row: QuoteRow | undefined, a: CreateQuoteArgs, action: ActionProposal, ctx: ExecuteContext): VerificationResult {
  if (!row) return { state: 'NOT_FOUND', verified: false, checks: [], reason: 'quote-not-found' }
  const total = Number(row.totalAmount)
  const checks = [
    { name: 'agency', ok: Number(row.agencyId) === ctx.actor.agencyId, expected: ctx.actor.agencyId, actual: Number(row.agencyId) },
    { name: 'lead', ok: Number(row.leadId) === a.clientId, expected: a.clientId, actual: Number(row.leadId) },
    { name: 'key', ok: row.automationKey === quoteAutomationKey(action.actionId), expected: 'this action', actual: row.automationKey === quoteAutomationKey(action.actionId) ? 'same' : 'different' },
    { name: 'status', ok: row.status === 'ready', expected: 'ready', actual: row.status },
    { name: 'numbered', ok: row.quoteNumber != null, expected: 'a quote number', actual: row.quoteNumber },
    { name: 'total', ok: total === a.expectedTotalAmount, expected: a.expectedTotalAmount, actual: total },
  ]
  const ok = checks.every((c) => c.ok)
  return {
    state: ok ? 'VERIFIED' : 'MISMATCH',
    verified: ok,
    checks,
    targetIds: [{ kind: 'quote', id: String(row.id) }],
    reason: ok ? null : 'postcondition-mismatch',
  }
}

/** Re-read the quote the executor reported, by id AND the authenticated agency. */
async function verify(action: ActionProposal, execution: ExecutionResult, ctx: ExecuteContext): Promise<VerificationResult> {
  const parsed = createQuoteArgs.safeParse(action.args)
  if (!parsed.success) return { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'invalid-args' }
  const quoteId = Number(execution.targetIds?.find((t) => t.kind === 'quote')?.id)
  if (!Number.isSafeInteger(quoteId)) return { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'no-quote-id' }
  const row = (await db('sales_quotes').where({ id: quoteId, agencyId: ctx.actor.agencyId }).first(...COLUMNS)) as QuoteRow | undefined
  return result(row, parsed.data, action, ctx)
}

/** From the arguments alone: does this action's quote (its automationKey) exist? */
async function probe(action: ActionProposal, ctx: ExecuteContext): Promise<VerificationResult> {
  const parsed = createQuoteArgs.safeParse(action.args)
  if (!parsed.success) return { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'invalid-args' }
  const found = (await findQuoteByAutomationKeyQuery(ctx.actor.agencyId, quoteAutomationKey(action.actionId), db)) as { id: number } | undefined
  if (!found) return { state: 'NOT_FOUND', verified: false, checks: [], reason: 'quote-not-found' }
  const row = (await db('sales_quotes').where({ id: found.id, agencyId: ctx.actor.agencyId }).first(...COLUMNS)) as QuoteRow | undefined
  return result(row, parsed.data, action, ctx)
}

/**
 * LOW_RISK_WRITE: one additive quote on one lead in the acting agency; it
 * reaches nobody. `requiresApproval` makes it a card even for an explicit
 * command, because the quote commits the business to a price.
 */
export const createQuoteAction: AgentActionDefinition = {
  type: 'create_quote',
  argsSchema: createQuoteArgs as never,
  risk: 'LOW_RISK_WRITE',
  requiresApproval: true,
  execute,
  verify,
  probe,
}
