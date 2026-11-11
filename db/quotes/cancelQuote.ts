import { db } from '@/config/db'
import { isAdmin } from '@/types/roles'
import type { QuoteScope } from './quotes'
import { recordQuoteEvent } from './events'
import { supersedeOpenCards } from './editQuote'

/**
 * The owner's "לבטל הצעה" on a quote's preview: the quote is withdrawn before it
 * was ever sent (`cancelled`, terminal; migration 20261111120000).
 *
 * Under the same row lock an edit and a customer send take, so a cancel and a
 * send can never both happen. Refused once anything went out to the customer
 * (a live delivery, or a status past `ready`), and when the version the owner
 * saw is no longer the current one. Every open card about the quote is retired.
 * Idempotent: cancelling a cancelled quote reports it, changes nothing.
 */

export type CancelQuoteResult = { ok: true; already: boolean } | { ok: false; reason: 'quote_not_found' | 'already_sent' | 'not_cancellable' | 'version_conflict' }

export async function cancelQuoteSystem(input: { agencyId: number; quoteId: number; expectedVersion: number; actorUserId: number; actionId: string | null; visibility: QuoteScope }): Promise<CancelQuoteResult> {
  const { agencyId, quoteId } = input
  return db.transaction(async (trx): Promise<CancelQuoteResult> => {
    const quote = (await trx('sales_quotes').where({ id: quoteId, agencyId }).forUpdate().first('leadId', 'status', 'version')) as { leadId: number; status: string; version: number } | undefined
    if (!quote) return { ok: false, reason: 'quote_not_found' }
    const lead = trx('clients').where({ id: quote.leadId, agencyId })
    if (!isAdmin(input.visibility.user.role)) lead.whereIn('userId', input.visibility.gotPermIds)
    if (!(await lead.first('id'))) return { ok: false, reason: 'quote_not_found' }

    if (quote.status === 'cancelled') return { ok: true, already: true }
    if (await trx('sales_quote_deliveries').where({ agencyId, quoteId }).whereNot({ state: 'failed' }).first('id')) return { ok: false, reason: 'already_sent' }
    if (quote.status !== 'ready') return { ok: false, reason: quote.status === 'sent' ? 'already_sent' : 'not_cancellable' }
    if (Number(quote.version) !== input.expectedVersion) return { ok: false, reason: 'version_conflict' }

    await trx('sales_quotes').where({ id: quoteId, agencyId, status: 'ready' }).update({ status: 'cancelled', cancelledAt: trx.fn.now(), updatedAt: trx.fn.now() })
    await supersedeOpenCards(trx, agencyId, quoteId)
    await recordQuoteEvent({ agencyId, quoteId, quoteVersion: Number(quote.version), type: 'cancelled', actorUserId: input.actorUserId, actionId: input.actionId }, trx)
    return { ok: true, already: false }
  })
}
