import type { Knex } from 'knex'
import { db } from '@/config/db'
import { isAdmin } from '@/types/roles'
import { resolveConfiguredTaxRateForLine } from '@/db/billing/taxRates'
import { allocateNumberInTransaction } from '@/db/billing/numbering'
import { businessDateString } from '@/lib/today/time'
import { expiryDateFrom } from '@/lib/quotes/status'
import {
  priceOwnerQuote,
  validQuoteTitle,
  validValidityDays,
  type OwnerPricingFailure,
  type OwnerQuoteLineInput,
  type PriceBasis,
} from '@/lib/quotes/ownerPricing'
import type { QuoteTotals } from '@/lib/quotes/totals'
import { findQuoteByAutomationKeyQuery, type QuoteScope } from './quotes'
import { resolveQuoteRecipientSystem } from './recipient'
import { insertQuoteWithItems } from './insertQuote'

/**
 * Create a quote from OWNER-STATED lines — no template.
 *
 * System-level like every quote write: explicit `agencyId`, no session. The
 * caller resolves the agency and user from its own trusted context (the
 * WhatsApp assistant's verified recipient), never from the wire.
 *
 * Every price is one the owner stated; this function does not produce a number
 * that did not come from its input (care charter, Law 1). VAT comes from the
 * agency's CONFIGURED rate — no hardcoded fallback — and a missing rate refuses.
 *
 * PINNED TOTAL. When `expectedTotalAmount` is set, the write refuses with
 * `total_mismatch` unless the quote it builds totals exactly that. The approval
 * card shows a total; this is what guarantees the stored quote is that total and
 * not a re-computation under a since-changed VAT rate. `expectedRatePercent`
 * refuses the same way when the rate itself moved.
 *
 * FINALIZE. With `finalize: true` the new draft is numbered (`quote` sequence,
 * business year) and moved to `ready` in the same transaction. The number is
 * allocated only AFTER a successful insert, so a key conflict never burns one.
 *
 * IDEMPOTENT ON `automationKey` through the shared insert. A retry returns the
 * existing quote with `created: false` and changes nothing about it.
 */

export type CreateQuoteSystemInput = {
  agencyId: number
  leadId: number
  createdByUserId: number
  title: string
  lines: readonly OwnerQuoteLineInput[]
  priceBasis: PriceBasis | null
  validityDays?: number | null
  automationKey?: string | null
  expectedTotalAmount?: number | null
  expectedRatePercent?: number | null
  finalize?: boolean
  /** When set, the lead must be visible to this scope (admins see every lead). */
  visibility?: QuoteScope
  metadata?: Record<string, unknown>
  nowMs?: number
  /**
   * Join the caller's transaction (its own becomes a savepoint inside it), so
   * the quote commits or rolls back together with the caller's other writes:
   * `create_quote` creating a new customer's lead and its quote as one unit.
   * Absent: a transaction of its own, exactly as before.
   */
  executor?: Knex.Transaction
}

export type CreateQuoteSystemFailure =
  | 'invalid_input'
  | 'lead_not_found'
  | 'tax_rate_missing'
  | 'rate_changed'
  | 'total_mismatch'
  | 'conflict_unresolved'
  | OwnerPricingFailure

export type CreatedQuote = {
  quoteId: number
  created: boolean
  status: string
  quoteNumber: number | null
  quoteYear: number | null
  totalAmount: number
}

export type CreateQuoteSystemResult = ({ ok: true } & CreatedQuote) | { ok: false; reason: CreateQuoteSystemFailure }

const positiveInt = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0

async function readExisting(agencyId: number, automationKey: string, executor: Knex | Knex.Transaction): Promise<CreatedQuote | null> {
  const found = (await findQuoteByAutomationKeyQuery(agencyId, automationKey, executor)) as { id: number } | undefined
  if (!found) return null
  const row = await executor('sales_quotes')
    .where({ id: found.id, agencyId })
    .first('id', 'status', 'quoteNumber', 'quoteYear', 'totalAmount')
  if (!row) return null
  return {
    quoteId: Number(row.id),
    created: false,
    status: String(row.status),
    quoteNumber: row.quoteNumber == null ? null : Number(row.quoteNumber),
    quoteYear: row.quoteYear == null ? null : Number(row.quoteYear),
    totalAmount: Number(row.totalAmount),
  }
}

/** "May this scope see this lead" — the same rule `listQuotesForLeadQuery` applies. */
async function leadVisible(trx: Knex.Transaction, agencyId: number, leadId: number, scope: QuoteScope): Promise<boolean> {
  const q = trx('clients').where({ id: leadId, agencyId })
  if (!isAdmin(scope.user.role)) q.whereIn('userId', scope.gotPermIds)
  return Boolean(await q.first('id'))
}

export async function createQuoteSystem(input: CreateQuoteSystemInput): Promise<CreateQuoteSystemResult> {
  const { agencyId, leadId, createdByUserId } = input
  if (![agencyId, leadId, createdByUserId].every(positiveInt)) return { ok: false, reason: 'invalid_input' }
  if (!validQuoteTitle(input.title)) return { ok: false, reason: 'invalid_input' }
  if (input.validityDays != null && !validValidityDays(input.validityDays)) return { ok: false, reason: 'invalid_input' }

  const automationKey = input.automationKey?.trim() || null
  const nowMs = input.nowMs ?? Date.now()

  const base = input.executor ?? db
  // Fast path: a retry finds its quote without opening a transaction.
  if (automationKey) {
    const existing = await readExisting(agencyId, automationKey, base)
    if (existing) return { ok: true, ...existing }
  }

  return base.transaction(async (trx): Promise<CreateQuoteSystemResult> => {
    if (input.visibility && !(await leadVisible(trx, agencyId, leadId, input.visibility))) {
      return { ok: false, reason: 'lead_not_found' }
    }
    const recipient = await resolveQuoteRecipientSystem(agencyId, leadId, trx)
    if (!recipient) return { ok: false, reason: 'lead_not_found' }

    const tax = await resolveConfiguredTaxRateForLine(agencyId, trx as unknown as typeof db)
    if (!tax) return { ok: false, reason: 'tax_rate_missing' }
    if (input.expectedRatePercent != null && input.expectedRatePercent !== tax.ratePercent) {
      return { ok: false, reason: 'rate_changed' }
    }

    const priced = priceOwnerQuote({ lines: input.lines, priceBasis: input.priceBasis, ratePercent: tax.ratePercent })
    if ('reason' in priced) return { ok: false, reason: priced.reason }
    const totals: QuoteTotals = priced.totals
    if (input.expectedTotalAmount != null && input.expectedTotalAmount !== totals.totalAmount) {
      return { ok: false, reason: 'total_mismatch' }
    }

    const inserted = await insertQuoteWithItems(trx, {
      agencyId,
      leadId,
      createdByUserId,
      ownerUserId: recipient.ownerUserId,
      automationKey,
      header: {
        templateId: null,
        title: input.title.trim(),
        currency: 'ILS',
        locale: 'he',
        introText: '',
        termsText: '',
        expiresAt: input.validityDays != null ? expiryDateFrom(nowMs, input.validityDays) : null,
        recipientNameSnapshot: recipient.name,
        recipientEmailSnapshot: recipient.email,
        recipientPhoneSnapshot: recipient.phone,
        subtotalAmount: totals.subtotalAmount,
        taxAmount: totals.taxAmount,
        discountAmount: totals.discountAmount,
        totalAmount: totals.totalAmount,
        metadata: {
          ...(input.metadata ?? {}),
          pricing: { basis: priced.basis, ratePercent: priced.ratePercent, requestedTotal: priced.requestedTotal, exact: priced.exact },
        },
      },
      items: priced.lines.map((l, idx) => ({
        lineNumber: idx + 1,
        title: l.title,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discount,
        taxRateId: tax.id,
        taxRatePercentSnapshot: tax.ratePercent,
        lineSubtotal: totals.lines[idx].lineSubtotal,
        lineTaxAmount: totals.lines[idx].lineTaxAmount,
        lineTotal: totals.lines[idx].lineTotal,
        isOptional: false,
      })),
    })

    if ('conflict' in inserted) {
      const winner = automationKey ? await readExisting(agencyId, automationKey, trx) : null
      if (!winner) return { ok: false, reason: 'conflict_unresolved' }
      return { ok: true, ...winner }
    }

    if (!input.finalize) {
      return {
        ok: true,
        quoteId: inserted.quoteId,
        created: true,
        status: 'draft',
        quoteNumber: null,
        quoteYear: null,
        totalAmount: totals.totalAmount,
      }
    }

    const quoteYear = Number(businessDateString(nowMs).slice(0, 4))
    const quoteNumber = await allocateNumberInTransaction(trx, { agencyId, year: quoteYear, kind: 'quote' })
    await trx('sales_quotes')
      .where({ id: inserted.quoteId, agencyId, status: 'draft' })
      .update({ status: 'ready', quoteNumber, quoteYear, readyAt: trx.fn.now(), updatedAt: trx.fn.now() })

    return {
      ok: true,
      quoteId: inserted.quoteId,
      created: true,
      status: 'ready',
      quoteNumber,
      quoteYear,
      totalAmount: totals.totalAmount,
    }
  })
}
