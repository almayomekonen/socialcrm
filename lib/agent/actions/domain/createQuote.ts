import 'server-only'
import { z } from 'zod'
import { db } from '@/config/db'
import { createQuoteSystem, type CreateQuoteSystemFailure } from '@/db/quotes/createQuote'
import type { Knex } from 'knex'
import { afterFailedInsert, createLeadForOwnerIn, noteLeadCreated } from '@/lib/system/createLeadForOwner'
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
 * the customer, by this action or anything it calls (see ./quoteDelivery.ts).
 *
 * DUPLICATES: the runtime's idempotency claim, the single-use card token, and
 * underneath both the quote's own `automationKey` (`wa_quote:<actionId>`, unique
 * per agency). A retried or crashed execution finds the same quote; the probe
 * reconciles from that key alone.
 *
 * ALWAYS A CARD (`requiresApproval`), whatever the phrasing.
 *
 * A CUSTOMER WHO IS NOT A LEAD YET (`clientId` 0 + `newLead`, both set by the
 * application in lib/waAssistant/quotes/newCustomer.ts and bound by the card's
 * argsHash): the approved card creates the lead FIRST, through the existing
 * system lead path (lib/system/createLeadForOwner.ts: quota lock and limit,
 * duplicate refusal, the lead-created automation and notification), keyed by
 * this action (`leadSource` `wa_quote_lead:<actionId>`), then the quote for THAT
 * lead id, in ONE transaction: a refused quote (rates changed meanwhile) rolls
 * the lead back with it. A retry finds the same lead and the same quote.
 */

const lineArgs = z.object({
  title: z.string().trim().min(1),
  quantity: z.number().positive(),
  unitAmount: z.number().min(0),
  discountAmount: z.number().min(0).nullable(),
  /** The percent the owner stated, kept beside the amount computed from it so the approval binds both. */
  discountPercent: z.number().min(0).max(100).nullable().optional(),
})

const newLeadArgs = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100),
  phone: z.string().trim().max(40).nullable(),
  email: z.string().trim().max(254).nullable(),
})

const createQuoteArgs = z.object({
  /** The lead's id, or 0 with `newLead`. */
  clientId: z.number().int().min(0),
  newLead: newLeadArgs.nullable().optional(),
  title: z.string().trim().min(1),
  lines: z.array(lineArgs).min(1),
  priceBasis: z.enum(['incl_vat', 'excl_vat']).nullable(),
  validityDays: z.number().int().positive().nullable(),
  expectedTotalAmount: z.number().min(0),
  expectedRatePercent: z.number().min(0),
})
  // Exactly one: an existing lead, or the one this action creates.
  .refine((a) => (a.clientId > 0) !== !!a.newLead, { message: 'exactly one of clientId or newLead' })

export type CreateQuoteArgs = z.infer<typeof createQuoteArgs>

export const quoteAutomationKey = (actionId: string) => `wa_quote:${actionId}`
/** The `leadSource` of the lead an approved quote action created: unique, so a retry finds the same lead. */
export const quoteLeadSource = (actionId: string) => `wa_quote_lead:${actionId}`

/** The lead this action is about: the approved id, or the one it created (by its key, in the acting agency). */
async function leadOf(a: CreateQuoteArgs, action: ActionProposal, ctx: ExecuteContext): Promise<number | null> {
  if (a.clientId > 0) return a.clientId
  const row = (await db('clients').where({ agencyId: ctx.actor.agencyId, leadSource: quoteLeadSource(action.actionId) }).first('id')) as { id: number } | undefined
  return row ? Number(row.id) : null
}

const mayDraft = (role: string) => canDraftQuote({ role } as UserDb)

/** Refusals that mean "the world is not what the owner approved": nothing was written. */
const STALE: readonly CreateQuoteSystemFailure[] = ['tax_rate_missing', 'rate_changed', 'total_mismatch']

/** What `createQuoteSystem` refused, as the runtime reports it. Nothing was written. */
function quoteRefusal(reason: CreateQuoteSystemFailure): ExecutionResult {
  if (reason === 'lead_not_found') return { status: 'NOT_AUTHORIZED', reason: 'lead-not-in-agency-or-not-permitted' }
  if (STALE.includes(reason)) return { status: 'FAILED', reason: `quote-${reason}` }
  if (reason === 'conflict_unresolved') return { status: 'UNKNOWN', reason: 'quote-conflict-unresolved' }
  return { status: 'INVALID_ACTION', reason: `quote-${reason}` }
}

/** Thrown inside the new-customer transaction to roll back the lead with the refused quote. */
class Refused {
  constructor(readonly result: ExecutionResult) {}
}

async function execute(action: ActionProposal, ctx: ExecuteContext): Promise<ExecutionResult> {
  const parsed = createQuoteArgs.safeParse(action.args)
  if (!parsed.success) return { status: 'INVALID_ACTION', reason: 'invalid-args' }
  if (!mayDraft(ctx.actor.role)) return { status: 'NOT_AUTHORIZED', reason: 'role-may-not-draft-quotes' }
  const a = parsed.data
  const quoteInput = (leadId: number, trx?: Knex.Transaction) => ({
    agencyId: ctx.actor.agencyId,
    leadId,
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
    executor: trx,
  })
  const success = (r: { quoteId: number; created: boolean; quoteNumber: number | null; quoteYear: number | null }, lead?: { leadId: number; created: boolean }): ExecutionResult => ({
    status: 'SUCCESS',
    targetIds: [{ kind: 'quote', id: String(r.quoteId) }, ...(lead ? [{ kind: 'lead', id: String(lead.leadId) }] : [])],
    detail: { created: r.created, quoteNumber: r.quoteNumber, quoteYear: r.quoteYear, ...(lead ? { leadId: lead.leadId, leadCreated: lead.created } : {}) },
  })

  if (!a.newLead) {
    const r = await createQuoteSystem(quoteInput(a.clientId))
    return r.ok === false ? quoteRefusal((r as { reason: CreateQuoteSystemFailure }).reason) : success(r)
  }

  // A new customer: the lead and its quote are ONE transaction. Whatever refuses
  // (the quota, a phone taken meanwhile, a VAT rate changed since the card) rolls
  // back both, its automation and notification included, so no lead is left
  // without the quote it was made for. A retry finds both, or starts clean.
  const leadInput = {
    agencyId: ctx.actor.agencyId,
    userId: ctx.actor.userId,
    firstName: a.newLead.firstName,
    lastName: a.newLead.lastName,
    phone: a.newLead.phone,
    email: a.newLead.email,
    leadSource: quoteLeadSource(action.actionId),
  }
  try {
    const done = await db.transaction(async (trx) => {
      const made = await createLeadForOwnerIn(trx, leadInput)
      if (made.ok === false) throw new Refused({ status: 'FAILED', reason: `lead-${made.reason.replace('_', '-')}` })
      const r = await createQuoteSystem(quoteInput(made.leadId, trx))
      if (r.ok === false) throw new Refused(quoteRefusal((r as { reason: CreateQuoteSystemFailure }).reason))
      return { made, r }
    })
    if (done.made.created) await noteLeadCreated(ctx.actor.agencyId)
    return success(done.r, done.made)
  } catch (err) {
    if (!(err instanceof Refused)) throw err
    if (err.result.reason !== 'lead-insert-failed') return err.result
    // The insert lost a race. A concurrent run of this same action committed both: the probe reconciles it.
    const why = await afterFailedInsert(leadInput)
    if (why === 'own') return { status: 'UNKNOWN', reason: 'lead-created-concurrently' }
    return why === 'contact_taken' ? { status: 'FAILED', reason: 'lead-contact-taken' } : err.result
  }
}

type QuoteRow = { id: number; agencyId: number; leadId: number; status: string; quoteNumber: number | null; totalAmount: string | number; automationKey: string | null }
const COLUMNS = ['id', 'agencyId', 'leadId', 'status', 'quoteNumber', 'totalAmount', 'automationKey'] as const

function result(row: QuoteRow | undefined, a: CreateQuoteArgs, action: ActionProposal, ctx: ExecuteContext, leadId: number | null): VerificationResult {
  if (!row) return { state: 'NOT_FOUND', verified: false, checks: [], reason: 'quote-not-found' }
  const total = Number(row.totalAmount)
  const checks = [
    { name: 'agency', ok: Number(row.agencyId) === ctx.actor.agencyId, expected: ctx.actor.agencyId, actual: Number(row.agencyId) },
    { name: 'lead', ok: leadId != null && Number(row.leadId) === leadId, expected: leadId, actual: Number(row.leadId) },
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
    targetIds: [{ kind: 'quote', id: String(row.id) }, ...(a.newLead && leadId != null ? [{ kind: 'lead', id: String(leadId) }] : [])],
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
  return result(row, parsed.data, action, ctx, await leadOf(parsed.data, action, ctx))
}

/** From the arguments alone: does this action's quote (its automationKey) exist? */
async function probe(action: ActionProposal, ctx: ExecuteContext): Promise<VerificationResult> {
  const parsed = createQuoteArgs.safeParse(action.args)
  if (!parsed.success) return { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'invalid-args' }
  const found = (await findQuoteByAutomationKeyQuery(ctx.actor.agencyId, quoteAutomationKey(action.actionId), db)) as { id: number } | undefined
  if (!found) return { state: 'NOT_FOUND', verified: false, checks: [], reason: 'quote-not-found' }
  const row = (await db('sales_quotes').where({ id: found.id, agencyId: ctx.actor.agencyId }).first(...COLUMNS)) as QuoteRow | undefined
  return result(row, parsed.data, action, ctx, await leadOf(parsed.data, action, ctx))
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
