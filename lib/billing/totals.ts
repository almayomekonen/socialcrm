/**
 * Pure money arithmetic for invoice lines and totals.
 *
 * Lives in lib/billing/ (not db/billing/) so client components can import
 * it without dragging the data-access layer's runtime dependencies
 * (requireUser, knex, the 'use cache' chain through db/auth) into the
 * client bundle.
 *
 * Doctrine:
 *   - Pure functions. No I/O. No knex. No imports from db/.
 *   - Rounding to 2 decimals on every result to absorb sub-cent floating-
 *     point fuzz that numeric(14,2) round-trips can pick up through JS
 *     Number arithmetic.
 *   - Discount is a flat amount, not a percent. Percent display is a UI
 *     concern; the schema and these helpers store/return only the absolute
 *     discount value.
 *
 * VAT correctness:
 *   - Per-line tax must be the cents-rounded share of the GROUP legal tax,
 *     so that sum(lineTax) === legalTax exactly. Naive per-line rounding
 *     compounds upward and overcharges customers on small-line invoices
 *     (e.g. 100 × 0.10 @ 18% used to land on 12.00 instead of 11.80).
 *   - The legal tax for a rate group is computed once as
 *     round2(groupSubtotal × rate / 100). Per-line tax is rounded share
 *     with the residual distributed onto the last line of the group, the
 *     standard practice on Israeli/EU compliant ERPs.
 */

export type LineTotals = {
  subtotal: number
  tax: number
  total: number
}

export type LineSummary = {
  lineSubtotal: number
  lineTaxAmount: number
  lineTotal: number
}

/** Input to `computeInvoiceLegalTotals` — one line's already-rounded subtotal and its tax rate. */
export type LegalTotalsLine = {
  lineSubtotal: number
  taxRatePercentSnapshot: number
}

/**
 * Per-line totals derived from the group-VAT calculation. Sum of `perLineTax`
 * is exactly `tax`; sum of `perLineTotal` is exactly `total`.
 */
export type LegalTotals = {
  subtotal: number
  tax: number
  total: number
  perLineTax: number[]
  perLineTotal: number[]
}

export function computeLineTotals(
  quantity: number,
  unitPrice: number,
  discount: number,
  taxRatePercent: number,
): LineTotals {
  const subtotal = round2(quantity * unitPrice - discount)
  const safeSubtotal = subtotal < 0 ? 0 : subtotal
  const tax = round2((safeSubtotal * taxRatePercent) / 100)
  const total = round2(safeSubtotal + tax)
  return { subtotal: safeSubtotal, tax, total }
}

/**
 * Legal totals for an issuance: group by tax rate, compute group VAT once,
 * distribute the cents-rounded share across the group's lines with the
 * residual on the last line so sum-of-line-totals === invoice total.
 *
 * Use this at issue time and for live previews wherever the customer
 * sees the invoice total. Replaces naïve summing of pre-rounded per-line
 * tax values.
 */
export function computeInvoiceLegalTotals(lines: readonly LegalTotalsLine[]): LegalTotals {
  const n = lines.length
  const perLineTax = new Array<number>(n).fill(0)

  // Group line indices by their tax rate. `Number(...)` defends against
  // numeric strings round-tripping through pg.
  const byRate = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const rate = Number(lines[i].taxRatePercentSnapshot)
    const bucket = byRate.get(rate)
    if (bucket) bucket.push(i)
    else byRate.set(rate, [i])
  }

  let subtotalSum = 0
  let taxSum = 0

  for (const [rate, indices] of byRate) {
    let groupSubtotal = 0
    for (const i of indices) groupSubtotal += Number(lines[i].lineSubtotal)
    const groupSubtotalRounded = round2(groupSubtotal)
    const groupLegalTax = round2((groupSubtotalRounded * rate) / 100)

    // Round each line's share to cents; track allocated total. The last
    // line in the group absorbs the residual so sum is exact.
    let allocated = 0
    for (let k = 0; k < indices.length - 1; k++) {
      const i = indices[k]
      const share = round2((Number(lines[i].lineSubtotal) * rate) / 100)
      perLineTax[i] = share
      allocated = round2(allocated + share)
    }
    if (indices.length > 0) {
      const last = indices[indices.length - 1]
      perLineTax[last] = round2(groupLegalTax - allocated)
    }

    subtotalSum += groupSubtotalRounded
    taxSum += groupLegalTax
  }

  const subtotal = round2(subtotalSum)
  const tax = round2(taxSum)
  const total = round2(subtotal + tax)
  const perLineTotal = lines.map((line, i) => round2(Number(line.lineSubtotal) + perLineTax[i]))

  return { subtotal, tax, total, perLineTax, perLineTotal }
}

/**
 * Sums per-line stored totals into invoice totals. Backwards-compatible
 * for the draft preview path; for the LEGAL totals (at issuance, on the
 * customer-visible invoice) callers should use `computeInvoiceLegalTotals`
 * instead — see the file header for the VAT-correctness contract.
 */
export function sumLineTotals(lines: readonly LineSummary[]): { subtotal: number; tax: number; total: number } {
  let subtotal = 0
  let tax = 0
  for (const line of lines) {
    subtotal += Number(line.lineSubtotal)
    tax += Number(line.lineTaxAmount)
  }
  return { subtotal: round2(subtotal), tax: round2(tax), total: round2(subtotal + tax) }
}

/**
 * The domain's money rounding. Exported so callers outside this file round the
 * same way rather than growing a third copy — `lib/billing/payment/validation.ts`
 * already has one, and "do not duplicate money arithmetic" is the rule.
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}
