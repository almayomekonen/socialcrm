import { computeInvoiceLegalTotals, computeLineTotals, round2 } from '@/lib/billing/totals'

/**
 * Quote money arithmetic — a thin, honest wrapper over the billing primitives.
 *
 * NO ARITHMETIC IS REIMPLEMENTED HERE. Per-line figures come from
 * `computeLineTotals` and the header figures from `computeInvoiceLegalTotals`,
 * which computes group VAT once per rate and distributes the cents-rounded
 * share with the residual on the last line of the group — the property that
 * makes `sum(lineTotal) === totalAmount` exactly. Re-deriving any of that would
 * be a second source of truth for money, which is the one thing this domain
 * must not grow.
 *
 * What IS this file's own business is the single structural difference between
 * a quote and an invoice: OPTIONAL LINES.
 *
 * An optional line is an upsell the customer may decline. It shows its own
 * price so they can see what they are declining, and it is excluded from every
 * header figure so the total is what they owe if they accept the quote as
 * offered. Including it would misstate the offer; hiding its per-line total
 * would make it unquotable.
 *
 * Pure. No I/O, no knex — importable from a Client Component for live preview,
 * exactly as `lib/billing/totals.ts` is.
 */

export type QuoteTotalsLine = {
  quantity: number | string
  unitPrice: number | string
  discount: number | string
  taxRatePercentSnapshot: number | string
  /** Excluded from the header figures. Defaults to binding. */
  isOptional?: boolean
}

export type QuoteLineTotals = {
  lineSubtotal: number
  lineTaxAmount: number
  lineTotal: number
}

export type QuoteTotals = {
  subtotalAmount: number
  taxAmount: number
  /** How much the binding lines' discounts actually took off. */
  discountAmount: number
  totalAmount: number
  /** Per-line figures for EVERY line, optional ones included, in input order. */
  lines: QuoteLineTotals[]
}

/** pg returns `numeric` as a string; coerce defensively at the boundary. */
const num = (v: number | string | null | undefined): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

export function computeQuoteTotals(lines: readonly QuoteTotalsLine[]): QuoteTotals {
  // Every line gets its own figures, so an optional line can show a price.
  const perLine = lines.map((l) =>
    computeLineTotals(num(l.quantity), num(l.unitPrice), num(l.discount), num(l.taxRatePercentSnapshot)),
  )

  const bindingIdx: number[] = []
  lines.forEach((l, i) => {
    if (!l.isOptional) bindingIdx.push(i)
  })

  // Header figures over the BINDING lines only.
  const legal = computeInvoiceLegalTotals(
    bindingIdx.map((i) => ({
      lineSubtotal: perLine[i].subtotal,
      taxRatePercentSnapshot: num(lines[i].taxRatePercentSnapshot),
    })),
  )

  // Binding lines take the group-VAT shares so the persisted per-line values
  // reconcile with the header exactly; optional lines keep their standalone
  // figures, which is what they are for.
  const out: QuoteLineTotals[] = perLine.map((p) => ({
    lineSubtotal: p.subtotal,
    lineTaxAmount: p.tax,
    lineTotal: p.total,
  }))
  bindingIdx.forEach((lineIdx, k) => {
    out[lineIdx] = {
      lineSubtotal: perLine[lineIdx].subtotal,
      lineTaxAmount: legal.perLineTax[k],
      lineTotal: legal.perLineTotal[k],
    }
  })

  /**
   * The discount actually APPLIED, not the discount asked for.
   * `computeLineTotals` clamps a line at zero, so a ₪999 discount on a ₪50 line
   * takes off ₪50. Reporting the requested figure would tell the customer they
   * saved money the quote never gave them.
   */
  let discountAmount = 0
  for (const i of bindingIdx) {
    const gross = round2(num(lines[i].quantity) * num(lines[i].unitPrice))
    discountAmount = round2(discountAmount + Math.min(round2(num(lines[i].discount)), gross))
  }

  return {
    subtotalAmount: legal.subtotal,
    taxAmount: legal.tax,
    discountAmount,
    totalAmount: legal.total,
    lines: out,
  }
}
