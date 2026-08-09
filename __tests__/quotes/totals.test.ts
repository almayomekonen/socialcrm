import { describe, expect, it } from 'vitest'
import { computeQuoteTotals } from '@/lib/quotes/totals'

/**
 * Quote money arithmetic. The primitives themselves are covered by
 * __tests__/billing/totals-precision.stress.test.ts; what is tested HERE is the
 * one thing quotes add — optional lines — and the reconciliation guarantee that
 * makes a quote's header trustworthy.
 */

const line = (over: Partial<Parameters<typeof computeQuoteTotals>[0][number]> = {}) => ({
  quantity: 1,
  unitPrice: 100,
  discount: 0,
  taxRatePercentSnapshot: 18,
  ...over,
})

describe('computeQuoteTotals — the ordinary case', () => {
  it('one line at 18% VAT', () => {
    const t = computeQuoteTotals([line()])
    expect(t.subtotalAmount).toBe(100)
    expect(t.taxAmount).toBe(18)
    expect(t.totalAmount).toBe(118)
    expect(t.lines).toEqual([{ lineSubtotal: 100, lineTaxAmount: 18, lineTotal: 118 }])
  })

  it('an exempt business (0%) quotes no tax at all', () => {
    const t = computeQuoteTotals([line({ taxRatePercentSnapshot: 0 }), line({ unitPrice: 250, taxRatePercentSnapshot: 0 })])
    expect(t.taxAmount).toBe(0)
    expect(t.subtotalAmount).toBe(350)
    expect(t.totalAmount).toBe(350)
  })

  it('no lines is zero, not NaN', () => {
    expect(computeQuoteTotals([])).toEqual({
      subtotalAmount: 0,
      taxAmount: 0,
      discountAmount: 0,
      totalAmount: 0,
      lines: [],
    })
  })

  it('numeric strings from pg are coerced, not concatenated', () => {
    const t = computeQuoteTotals([{ quantity: '2', unitPrice: '50.5', discount: '0', taxRatePercentSnapshot: '18' }])
    expect(t.subtotalAmount).toBe(101)
    expect(t.totalAmount).toBe(119.18)
  })
})

describe('computeQuoteTotals — optional lines', () => {
  it('an optional line is excluded from every header figure', () => {
    const t = computeQuoteTotals([line(), line({ unitPrice: 900, isOptional: true })])
    expect(t.subtotalAmount).toBe(100)
    expect(t.taxAmount).toBe(18)
    expect(t.totalAmount).toBe(118)
  })

  it('but still carries its own price, so the customer can see what they are declining', () => {
    const t = computeQuoteTotals([line(), line({ unitPrice: 900, isOptional: true })])
    expect(t.lines[1]).toEqual({ lineSubtotal: 900, lineTaxAmount: 162, lineTotal: 1062 })
  })

  it('an all-optional quote totals zero — nothing has been committed to', () => {
    const t = computeQuoteTotals([line({ isOptional: true }), line({ unitPrice: 500, isOptional: true })])
    expect(t.totalAmount).toBe(0)
    expect(t.lines).toHaveLength(2)
    expect(t.lines[1].lineTotal).toBe(590)
  })

  it('per-line figures stay aligned to INPUT order when optionals are interleaved', () => {
    // The regression this guards: header figures are computed over a FILTERED
    // array, so writing its per-line results back by position would shift every
    // line after the first optional one.
    const t = computeQuoteTotals([
      line({ unitPrice: 100, isOptional: true }),
      line({ unitPrice: 200 }),
      line({ unitPrice: 300, isOptional: true }),
      line({ unitPrice: 400 }),
    ])
    expect(t.lines.map((l) => l.lineSubtotal)).toEqual([100, 200, 300, 400])
    expect(t.subtotalAmount).toBe(600)
    expect(t.totalAmount).toBe(708)
  })
})

describe('computeQuoteTotals — reconciliation', () => {
  it('binding line totals sum EXACTLY to the header total', () => {
    // The small-line case the billing doctrine exists for: naive per-line
    // rounding compounds upward and overcharges.
    const lines = Array.from({ length: 100 }, () => line({ unitPrice: 0.1 }))
    const t = computeQuoteTotals(lines)
    const summed = t.lines.reduce((acc, l) => Math.round((acc + l.lineTotal) * 100) / 100, 0)
    expect(t.subtotalAmount).toBe(10)
    expect(t.taxAmount).toBe(1.8)
    expect(t.totalAmount).toBe(11.8)
    expect(summed).toBe(t.totalAmount)
  })

  it('reconciles across mixed rates too', () => {
    const t = computeQuoteTotals([
      line({ unitPrice: 33.33, taxRatePercentSnapshot: 18 }),
      line({ unitPrice: 33.33, taxRatePercentSnapshot: 18 }),
      line({ unitPrice: 50, taxRatePercentSnapshot: 0 }),
    ])
    const summed = t.lines.reduce((acc, l) => Math.round((acc + l.lineTotal) * 100) / 100, 0)
    expect(summed).toBe(t.totalAmount)
    expect(Math.round((t.subtotalAmount + t.taxAmount) * 100) / 100).toBe(t.totalAmount)
  })
})

describe('computeQuoteTotals — discounts', () => {
  it('reports the discount actually applied', () => {
    const t = computeQuoteTotals([line({ unitPrice: 100, discount: 25 })])
    expect(t.subtotalAmount).toBe(75)
    expect(t.discountAmount).toBe(25)
    expect(t.totalAmount).toBe(88.5)
  })

  it('a discount larger than the line is clamped — and REPORTED clamped', () => {
    // Reporting the requested ₪999 would tell the customer they saved money the
    // quote never gave them.
    const t = computeQuoteTotals([line({ unitPrice: 50, discount: 999 })])
    expect(t.subtotalAmount).toBe(0)
    expect(t.discountAmount).toBe(50)
    expect(t.totalAmount).toBe(0)
  })

  it('an optional line’s discount is not counted in the header', () => {
    const t = computeQuoteTotals([line({ discount: 10 }), line({ discount: 40, isOptional: true })])
    expect(t.discountAmount).toBe(10)
  })
})
