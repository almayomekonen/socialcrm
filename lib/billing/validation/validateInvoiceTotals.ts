/**
 * Pure validation for the totals recomputed at issuance. Throws on the
 * first violation with a namespaced error reason.
 *
 * Reasons:
 *   - billing.validate.invalid_subtotal   subtotal is NaN/Infinity or negative
 *   - billing.validate.invalid_tax        tax is NaN/Infinity or negative
 *   - billing.validate.invalid_total      total is NaN/Infinity or negative
 *   - billing.validate.zero_total         total <= 0 (empty/no-op invoice)
 */

export type InvoiceTotals = {
  subtotal: number
  tax: number
  rounding: number
  total: number
}

export function validateInvoiceTotals(totals: InvoiceTotals): void {
  if (!Number.isFinite(totals.subtotal) || totals.subtotal < 0) {
    throw new Error('billing.validate.invalid_subtotal')
  }
  if (!Number.isFinite(totals.tax) || totals.tax < 0) {
    throw new Error('billing.validate.invalid_tax')
  }
  if (!Number.isFinite(totals.total) || totals.total < 0) {
    throw new Error('billing.validate.invalid_total')
  }
  if (totals.total <= 0) {
    throw new Error('billing.validate.zero_total')
  }
}
