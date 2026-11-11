import type { Knex } from 'knex'
import { db } from '@/config/db'
import { isAdmin } from '@/types/roles'
import { resolveConfiguredTaxRateForLine } from '@/db/billing/taxRates'
import { priceOwnerQuote } from '@/lib/quotes/ownerPricing'
import { expiryDateFrom } from '@/lib/quotes/status'
import type { StoredQuoteLine } from '@/lib/quotes/edit'
import type { QuoteScope } from './quotes'
import { recordQuoteEvent } from './events'

/**
 * An owner-approved edit: one new version of a `ready` quote.
 *
 * ONE TRANSACTION, under the same row lock a customer send claims. In it the
 * items and totals are replaced, the version moves, every PDF of the old version
 * stops being current, a render still running for it is closed, and any open
 * card about this quote is superseded. So an approval given for
 * version N can never send version N+1, and the reverse.
 *
 * Refused once anything has gone out: a sent quote is what the customer has.
 * Idempotent on the action: a retry after a crash finds its own edit.
 */

export type EditQuoteInput = {
  agencyId: number
  quoteId: number
  expectedVersion: number
  title: string
  lines: readonly StoredQuoteLine[]
  validityDays: number | null
  expectedTotalAmount: number
  expectedRatePercent: number
  actionId: string
  actorUserId: number
  visibility: QuoteScope
  nowMs: number
}

export type EditQuoteFailure = 'quote_not_found' | 'not_editable' | 'already_sent' | 'version_conflict' | 'tax_rate_missing' | 'rate_changed' | 'total_mismatch' | 'invalid_lines'
export type EditQuoteResult = { ok: true; version: number; applied: boolean; totalAmount: number } | { ok: false; reason: EditQuoteFailure }

async function leadVisible(trx: Knex.Transaction, agencyId: number, leadId: number, scope: QuoteScope): Promise<boolean> {
  const q = trx('clients').where({ id: leadId, agencyId })
  if (!isAdmin(scope.user.role)) q.whereIn('userId', scope.gotPermIds)
  return Boolean(await q.first('id'))
}

export async function editQuoteSystem(input: EditQuoteInput): Promise<EditQuoteResult> {
  const { agencyId, quoteId } = input
  return db.transaction(async (trx): Promise<EditQuoteResult> => {
    const quote = (await trx('sales_quotes').where({ id: quoteId, agencyId }).forUpdate().first('id', 'leadId', 'status', 'version', 'totalAmount', 'metadata')) as
      | { id: number; leadId: number; status: string; version: number; totalAmount: string; metadata: Record<string, unknown> | null }
      | undefined
    if (!quote || !(await leadVisible(trx, agencyId, Number(quote.leadId), input.visibility))) return { ok: false, reason: 'quote_not_found' }
    if (quote.metadata?.lastEditActionId === input.actionId) return { ok: true, version: Number(quote.version), applied: false, totalAmount: Number(quote.totalAmount) }

    if (await trx('sales_quote_deliveries').where({ agencyId, quoteId }).whereNot({ state: 'failed' }).first('id')) return { ok: false, reason: 'already_sent' }
    if (quote.status !== 'ready') return { ok: false, reason: 'not_editable' }
    if (Number(quote.version) !== input.expectedVersion) return { ok: false, reason: 'version_conflict' }

    const tax = await resolveConfiguredTaxRateForLine(agencyId, trx as unknown as typeof db)
    if (!tax) return { ok: false, reason: 'tax_rate_missing' }
    if (tax.ratePercent !== input.expectedRatePercent) return { ok: false, reason: 'rate_changed' }

    const priced = priceOwnerQuote({
      lines: input.lines.map((l) => ({ title: l.title, description: l.description, quantity: l.quantity, unitAmount: l.unitPrice, discountAmount: l.discount })),
      priceBasis: 'excl_vat',
      ratePercent: tax.ratePercent,
    })
    if ('reason' in priced) return { ok: false, reason: 'invalid_lines' }
    const { totals } = priced
    if (totals.totalAmount !== input.expectedTotalAmount) return { ok: false, reason: 'total_mismatch' }

    await trx('sales_quote_items').where({ agencyId, quoteId }).del()
    await trx('sales_quote_items').insert(
      priced.lines.map((l, i) => ({
        quoteId,
        agencyId,
        lineNumber: i + 1,
        title: l.title,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discount,
        taxRateId: tax.id,
        taxRatePercentSnapshot: tax.ratePercent,
        lineSubtotal: totals.lines[i].lineSubtotal,
        lineTaxAmount: totals.lines[i].lineTaxAmount,
        lineTotal: totals.lines[i].lineTotal,
        isOptional: false,
      })),
    )

    const version = Number(quote.version) + 1
    const { pdfNotice: _sentForOldVersion, ...metadata } = quote.metadata ?? {}
    await trx('sales_quotes')
      .where({ id: quoteId, agencyId })
      .update({
        version,
        title: input.title,
        subtotalAmount: totals.subtotalAmount,
        taxAmount: totals.taxAmount,
        discountAmount: totals.discountAmount,
        totalAmount: totals.totalAmount,
        ...(input.validityDays != null ? { expiresAt: expiryDateFrom(input.nowMs, input.validityDays) } : {}),
        metadata: JSON.stringify({ ...metadata, lastEditActionId: input.actionId, pricing: { basis: priced.basis, ratePercent: priced.ratePercent, requestedTotal: priced.requestedTotal, exact: priced.exact } }),
        updatedAt: trx.fn.now(),
      })

    await trx('sales_quote_documents').where({ agencyId, quoteId, isCurrent: true }).update({ isCurrent: false, updatedAt: trx.fn.now() })
    await trx('sales_quote_documents').where({ agencyId, quoteId, status: 'rendering' }).update({ status: 'failed', failureReason: 'superseded_version', updatedAt: trx.fn.now() })
    await supersedeOpenCards(trx, agencyId, quoteId)
    await recordQuoteEvent({ agencyId, quoteId, quoteVersion: version, type: 'edited', actorUserId: input.actorUserId, actionId: input.actionId, detail: { fromTotal: Number(quote.totalAmount), toTotal: totals.totalAmount } }, trx)
    return { ok: true, version, applied: true, totalAmount: totals.totalAmount }
  })
}

/** Every open card about this quote (send or edit) names a version that no longer exists. */
export async function supersedeOpenCards(trx: Knex.Transaction, agencyId: number, quoteId: number): Promise<void> {
  await trx('wa_assistant_approvals')
    .where({ agencyId, status: 'pending' })
    .whereIn('actionId', trx('agent_actions').where({ agencyId }).whereIn('actionType', ['send_quote', 'edit_quote']).whereRaw(`(args->>'quoteId')::bigint = ?`, [quoteId]).select('actionId'))
    .update({ status: 'superseded', updatedAt: trx.fn.now() })
}

/**
 * The quote this owner is reviewing: the one on their open send card, otherwise
 * their most recently touched WhatsApp quote that is still `ready`. A delivery
 * whose outcome is unknown stays `ready`, so the owner can be told about it.
 */
export async function findQuoteUnderReview(input: { agencyId: number; userId: number; recipientId: number; now: Date }): Promise<number | null> {
  const { agencyId, userId, recipientId, now } = input
  const card = (await db('wa_assistant_approvals as a')
    .join('agent_actions as x', function () {
      this.on('x.actionId', '=', 'a.actionId').andOn('x.agencyId', '=', 'a.agencyId')
    })
    .where({ 'a.agencyId': agencyId, 'a.recipientId': recipientId, 'a.status': 'pending', 'x.actionType': 'send_quote', 'x.userId': userId })
    .where('a.expiresAt', '>', now)
    .orderBy('a.id', 'desc')
    .first(db.raw(`(x.args->>'quoteId')::bigint as "quoteId"`))) as { quoteId: string | number } | undefined
  if (card) return Number(card.quoteId)

  const latest = (await db('sales_quotes as q')
    .where({ 'q.agencyId': agencyId, 'q.createdByUserId': userId, 'q.status': 'ready' })
    .whereRaw(`q.metadata->>'source' = 'wa_assistant'`)
    .orderBy('q.updatedAt', 'desc')
    .first('q.id')) as { id: string | number } | undefined
  return latest ? Number(latest.id) : null
}
