import { computeQuoteTotals } from './totals'
import { expiryDateFrom } from './status'

/**
 * Template → quote, as a PURE function.
 *
 * This is where the snapshot invariant lives, so it is where the snapshot
 * invariant is tested:
 *
 *   Template:  חבילת אתר  ₪4,900  ·  VAT 18%
 *        ↓ create
 *   Quote:     חבילת אתר  ₪4,900  ·  VAT 18%
 *
 *   Template later becomes ₪5,500 → the existing quote is STILL ₪4,900.
 *
 * The quote copies authoritative VALUES, never a reference. A customer was
 * quoted a price, and that price is now a fact about the conversation — a
 * template edit is a decision about future quotes and has no business
 * rewriting one already in someone's inbox.
 *
 * TAX IS NOT COPIED FROM THE TEMPLATE, because the template does not carry it.
 * VAT is agency policy: the caller resolves it once through
 * `resolveActiveTaxRateForLine`, which applies the live rate AND the
 * business-type rule (עוסק פטור collects 0%), and hands the result in here. A
 * rate stored on a template would go stale silently and produce illegal quotes.
 *
 * Pure and I/O-free by design: the DB layer does the reads, calls this, and
 * writes the result. That split is what makes the invariant above testable
 * without a database — which matters, because this repo's DB-backed test
 * harness cannot run (only `users` is knex-migrated).
 */

export type QuoteTemplateSnapshot = {
  id: number
  title: string
  introText: string
  termsText: string
  currency: string
  locale: string
  validityDays: number
}

export type QuoteTemplateItemSnapshot = {
  lineNumber: number
  title: string
  description: string
  quantity: number | string
  unitPrice: number | string
  discount: number | string
  isOptional: boolean
}

export type QuoteRecipientSnapshot = {
  name: string
  email: string
  phone: string
}

export type BuildQuoteFromTemplateInput = {
  template: QuoteTemplateSnapshot
  items: readonly QuoteTemplateItemSnapshot[]
  recipient: QuoteRecipientSnapshot
  /** Resolved ONCE by the caller from the agency's live tax policy. */
  tax: { taxRateId: number | null; ratePercent: number }
  /** Injected, never read from the clock here — a pure function stays pure. */
  nowMs: number
  /** Overrides the template's default validity window when set. */
  validityDaysOverride?: number | null
}

export type BuiltQuoteHeader = {
  templateId: number
  title: string
  currency: string
  locale: string
  introText: string
  termsText: string
  expiresAt: string
  recipientNameSnapshot: string
  recipientEmailSnapshot: string
  recipientPhoneSnapshot: string
  subtotalAmount: number
  taxAmount: number
  discountAmount: number
  totalAmount: number
}

export type BuiltQuoteItem = {
  lineNumber: number
  title: string
  description: string
  quantity: number
  unitPrice: number
  discount: number
  taxRateId: number | null
  taxRatePercentSnapshot: number
  lineSubtotal: number
  lineTaxAmount: number
  lineTotal: number
  isOptional: boolean
}

export type BuiltQuote = { quote: BuiltQuoteHeader; items: BuiltQuoteItem[] }

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

export function buildQuoteFromTemplate(input: BuildQuoteFromTemplateInput): BuiltQuote {
  // Line order is the template's, renumbered densely so a template with a gap
  // (an item deleted, leaving 1,2,4) still produces 1,2,3 on the quote.
  const ordered = [...input.items].sort((a, b) => a.lineNumber - b.lineNumber)

  const totals = computeQuoteTotals(
    ordered.map((i) => ({
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discount: i.discount,
      // One effective rate for every line — the agency's policy, not per-item data.
      taxRatePercentSnapshot: input.tax.ratePercent,
      isOptional: i.isOptional,
    })),
  )

  const items: BuiltQuoteItem[] = ordered.map((i, idx) => ({
    lineNumber: idx + 1,
    title: i.title,
    description: i.description,
    quantity: num(i.quantity),
    unitPrice: num(i.unitPrice),
    discount: num(i.discount),
    taxRateId: input.tax.taxRateId,
    taxRatePercentSnapshot: input.tax.ratePercent,
    lineSubtotal: totals.lines[idx].lineSubtotal,
    lineTaxAmount: totals.lines[idx].lineTaxAmount,
    lineTotal: totals.lines[idx].lineTotal,
    isOptional: i.isOptional,
  }))

  const validityDays =
    input.validityDaysOverride != null && input.validityDaysOverride > 0
      ? input.validityDaysOverride
      : input.template.validityDays

  return {
    quote: {
      templateId: input.template.id,
      title: input.template.title,
      currency: input.template.currency,
      locale: input.template.locale,
      introText: input.template.introText,
      termsText: input.template.termsText,
      expiresAt: expiryDateFrom(input.nowMs, validityDays),
      recipientNameSnapshot: input.recipient.name,
      recipientEmailSnapshot: input.recipient.email,
      recipientPhoneSnapshot: input.recipient.phone,
      subtotalAmount: totals.subtotalAmount,
      taxAmount: totals.taxAmount,
      discountAmount: totals.discountAmount,
      totalAmount: totals.totalAmount,
    },
    items,
  }
}
