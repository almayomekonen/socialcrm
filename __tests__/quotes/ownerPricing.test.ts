import { describe, expect, it } from 'vitest'
import { priceOwnerQuote, subtotalForGross } from '@/lib/quotes/ownerPricing'
import { computeQuoteTotals } from '@/lib/quotes/totals'
import { computeLineTotals } from '@/lib/billing/totals'

/**
 * Owner-stated prices → stored before-VAT figures.
 *
 * The invariant every case checks: the totals the function reports are exactly
 * what `computeQuoteTotals` produces for the lines it returns — so what the
 * approval card shows is what the quote stores.
 */

const line = (unitAmount: number, over: Partial<{ quantity: number; discountAmount: number; title: string }> = {}) => ({
  title: over.title ?? 'שיפוץ מטבח',
  quantity: over.quantity ?? 1,
  unitAmount,
  discountAmount: over.discountAmount,
})

function recomputed(result: Extract<ReturnType<typeof priceOwnerQuote>, { ok: true }>) {
  return computeQuoteTotals(
    result.lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, taxRatePercentSnapshot: result.ratePercent })),
  )
}

describe('VAT basis is never assumed', () => {
  it('refuses when the rate is non-zero and the basis is unstated', () => {
    expect(priceOwnerQuote({ lines: [line(1000)], priceBasis: null, ratePercent: 18 })).toEqual({ ok: false, reason: 'vat_basis_required' })
  })

  it('needs no basis for an exempt business (0%), and incl/excl are the same number', () => {
    const none = priceOwnerQuote({ lines: [line(18500)], priceBasis: null, ratePercent: 0 })
    const incl = priceOwnerQuote({ lines: [line(18500)], priceBasis: 'incl_vat', ratePercent: 0 })
    expect(none.ok && none.basis).toBe('no_vat')
    expect(none.ok && none.totals).toEqual(incl.ok && incl.totals)
    expect(none.ok && none.totals.totalAmount).toBe(18500)
    expect(none.ok && none.totals.taxAmount).toBe(0)
  })
})

describe('excluding VAT', () => {
  it('stores the stated price and adds the agency rate', () => {
    const r = priceOwnerQuote({ lines: [line(10000, { quantity: 2 })], priceBasis: 'excl_vat', ratePercent: 18 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.lines[0].unitPrice).toBe(10000)
    expect(r.totals).toEqual({ subtotalAmount: 20000, taxAmount: 3600, discountAmount: 0, totalAmount: 23600, lines: expect.any(Array) })
    expect(r.exact).toBe(true)
    expect(r.totals).toEqual(recomputed(r))
  })

  it('applies a before-VAT discount', () => {
    const r = priceOwnerQuote({ lines: [line(1000, { discountAmount: 100 })], priceBasis: 'excl_vat', ratePercent: 18 })
    expect(r.ok && r.totals).toMatchObject({ subtotalAmount: 900, discountAmount: 100, taxAmount: 162, totalAmount: 1062 })
  })
})

describe('including VAT', () => {
  it('₪18,500 including 18% VAT totals exactly ₪18,500.00', () => {
    const r = priceOwnerQuote({ lines: [line(18500)], priceBasis: 'incl_vat', ratePercent: 18 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.lines[0].unitPrice).toBe(15677.97)
    expect(r.totals.subtotalAmount).toBe(15677.97)
    expect(r.totals.taxAmount).toBe(2822.03)
    expect(r.totals.totalAmount).toBe(18500)
    expect(r.exact).toBe(true)
    expect(r.totals).toEqual(recomputed(r))
  })

  it('reports — never hides — an amount no before-VAT price can reach', () => {
    // ₪1.21 incl. 18%: subtotal 1.02 → 1.20, 1.03 → 1.22. Nothing gives 1.21.
    const r = priceOwnerQuote({ lines: [line(1.21)], priceBasis: 'incl_vat', ratePercent: 18 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.exact).toBe(false)
    expect(r.requestedTotal).toBe(1.21)
    expect(Math.round(Math.abs(r.totals.totalAmount - 1.21) * 100)).toBeLessThanOrEqual(1)
    expect(r.totals).toEqual(recomputed(r))
  })

  it('handles quantity: 3 × ₪1,000 including VAT', () => {
    const r = priceOwnerQuote({ lines: [line(1000, { quantity: 3 })], priceBasis: 'incl_vat', ratePercent: 18 })
    expect(r.ok && r.totals.totalAmount).toBe(3000)
    expect(r.ok && r.exact).toBe(true)
  })

  it('handles a VAT-inclusive discount', () => {
    const r = priceOwnerQuote({ lines: [line(18500, { discountAmount: 500 })], priceBasis: 'incl_vat', ratePercent: 18 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.totals.totalAmount).toBe(18000)
    expect(r.totals.discountAmount).toBeGreaterThan(0)
    expect(r.totals).toEqual(recomputed(r))
  })

  it('multi-line: the reported total is the one the quote stores', () => {
    const r = priceOwnerQuote({ lines: [line(18500), line(2350, { title: 'ארונות' }), line(99.99, { title: 'ידיות' })], priceBasis: 'incl_vat', ratePercent: 18 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.requestedTotal).toBe(20949.99)
    expect(r.totals).toEqual(recomputed(r))
    expect(r.exact).toBe(r.totals.totalAmount === 20949.99)
  })

  it('exhaustive sweep: exact whenever a before-VAT subtotal exists, and never misreports', () => {
    for (const rate of [17, 18]) {
      // Every agora up to ₪300, then every 997 agorot up to ₪500,000.
      for (let agorot = 1; agorot <= 50_000_000; agorot += agorot < 30_000 ? 1 : 997) {
        const gross = agorot / 100
        // Brute force a WIDER window than the solver searches, so this proves
        // ±1 agora is enough rather than restating the solver.
        const reachable = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].some((d) => {
          const s = Math.round(gross / (1 + rate / 100) * 100) / 100 + d / 100
          return s >= 0 && computeLineTotals(1, Math.round(s * 100) / 100, 0, rate).total === gross
        })
        const solved = subtotalForGross(gross, rate)
        expect(solved.exact).toBe(reachable)
        if (solved.exact) expect(computeLineTotals(1, solved.subtotal, 0, rate).total).toBe(gross)
      }
    }
  })
})

describe('input validation', () => {
  it.each([
    [{ lines: [], priceBasis: 'excl_vat' as const, ratePercent: 18 }, 'no_lines'],
    [{ lines: [line(-1)], priceBasis: 'excl_vat' as const, ratePercent: 18 }, 'invalid_line'],
    [{ lines: [line(100, { quantity: 0 })], priceBasis: 'excl_vat' as const, ratePercent: 18 }, 'invalid_line'],
    [{ lines: [line(100, { title: '  ' })], priceBasis: 'excl_vat' as const, ratePercent: 18 }, 'invalid_line'],
    [{ lines: [line(Number.NaN)], priceBasis: 'excl_vat' as const, ratePercent: 18 }, 'invalid_line'],
    [{ lines: [line(100, { discountAmount: 101 })], priceBasis: 'excl_vat' as const, ratePercent: 18 }, 'discount_exceeds_price'],
    [{ lines: Array.from({ length: 51 }, () => line(1)), priceBasis: 'excl_vat' as const, ratePercent: 18 }, 'too_many_lines'],
    [{ lines: [line(1)], priceBasis: 'excl_vat' as const, ratePercent: -1 }, 'invalid_rate'],
  ])('refuses %#', (input, reason) => {
    expect(priceOwnerQuote(input)).toEqual({ ok: false, reason })
  })
})
