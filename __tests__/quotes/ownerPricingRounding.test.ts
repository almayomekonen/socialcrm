import { describe, expect, it } from 'vitest'
import { priceOwnerQuote } from '@/lib/quotes/ownerPricing'

/**
 * CHARACTERIZATION of how identical lines total today. Pins current behaviour
 * (no pricing change was made), so that any later fix shows up here as a
 * deliberate, reviewed difference.
 *
 * The oracle is whole agorot in integer arithmetic (every value stays far below
 * 2^53), written independently of the code under test:
 * round half up, net rounded per line, then VAT once on the whole document.
 */

const roundDiv = (n: number, d: number) => Math.floor((n * 2 + d) / (d * 2))
/** VAT at 18% on an integer agorot amount. */
const vat18 = (net: number) => roundDiv(net * 18, 100)
const shekels = (a: number) => a / 100

/** The before-VAT line amount, in agorot, whose VAT-inclusive total is `gross`. */
function netForGross(gross: number): number {
  const base = roundDiv(gross * 100, 118)
  for (const c of [base, base - 1, base + 1]) if (c + vat18(c) === gross) return c
  return base
}

const NS = [1, 2, 12, 50] as const
const lines = (n: number, unitAmount = 18500) => Array.from({ length: n }, (_, i) => ({ title: `פריט ${i + 1}`, quantity: 1, unitAmount }))
const price = (n: number, priceBasis: 'incl_vat' | 'excl_vat' | null, ratePercent: number) => {
  const r = priceOwnerQuote({ lines: lines(n), priceBasis, ratePercent })
  if ('reason' in r) throw new Error(r.reason)
  return r
}

describe('VAT-registered, prices INCLUDING VAT (18%)', () => {
  it.each([
    [1, 15677.97, 2822.03, 18500, 0],
    [2, 31355.94, 5644.07, 37000.01, 0.01],
    [12, 188135.64, 33864.42, 222000.06, 0.06],
    [50, 783898.5, 141101.73, 925000.23, 0.23],
  ])('%i identical lines', (n, subtotal, tax, total, drift) => {
    const r = price(n, 'incl_vat', 18)
    expect(r.totals).toMatchObject({ subtotalAmount: subtotal, taxAmount: tax, totalAmount: total })
    expect(r.requestedTotal).toBe(18500 * n)
    expect(Math.round((r.totals.totalAmount - r.requestedTotal) * 100) / 100).toBe(drift)
    expect(r.exact).toBe(drift === 0)
    // Every item keeps one and the same price: nothing is balanced onto a line's price.
    expect(new Set(r.lines.map((l) => l.unitPrice))).toEqual(new Set([15677.97]))
  })

  it.each(NS)('%i lines agree with the independent integer calculation', (n) => {
    const net = netForGross(1_850_000) * n
    const r = price(n, 'incl_vat', 18)
    expect(r.totals.subtotalAmount).toBe(shekels(net))
    expect(r.totals.taxAmount).toBe(shekels(vat18(net)))
    expect(r.totals.totalAmount).toBe(shekels(net + vat18(net)))
  })

  it('the source: each line is exact alone; the excess comes from rounding each line up before VAT', () => {
    const one = price(1, 'incl_vat', 18)
    expect(one.exact).toBe(true) // 15,677.97 + 2,822.03 = 18,500.00
    const twelve = price(12, 'incl_vat', 18)
    const trueNet = shekels(roundDiv(22_200_000 * 100, 118))
    expect(trueNet).toBe(188135.59)
    expect(Math.round((twelve.totals.subtotalAmount - trueNet) * 100)).toBe(5) // 5 agorot of net
    expect(Math.round((twelve.totals.taxAmount - shekels(vat18(18_813_559))) * 100)).toBe(1) // 1 agora of VAT on them
  })

  it('the VAT residual already sits on the last line, as invoices do', () => {
    const t = price(12, 'incl_vat', 18).totals
    expect(t.lines.slice(0, 11).every((l) => l.lineTaxAmount === 2822.03)).toBe(true)
    expect(t.lines[11].lineTaxAmount).toBe(2822.09)
    expect(Math.round(t.lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100).toBe(t.totalAmount)
  })

  it('one line with quantity 12 lands exactly', () => {
    const r = priceOwnerQuote({ lines: [{ title: 'פריט', quantity: 12, unitAmount: 18500 }], priceBasis: 'incl_vat', ratePercent: 18 })
    if ('reason' in r) throw new Error(r.reason)
    expect(r.totals).toMatchObject({ subtotalAmount: 188135.59, taxAmount: 33864.41, totalAmount: 222000 })
    expect(r.exact).toBe(true)
  })
})

describe('VAT-registered, prices EXCLUDING VAT (18%): no drift, the stated price is the stored one', () => {
  it.each(NS)('%i identical lines', (n) => {
    const r = price(n, 'excl_vat', 18)
    const net = 1_850_000 * n
    expect(r.totals).toMatchObject({ subtotalAmount: shekels(net), taxAmount: shekels(vat18(net)), totalAmount: shekels(net + vat18(net)) })
    expect(new Set(r.lines.map((l) => l.unitPrice))).toEqual(new Set([18500]))
    expect(r.exact).toBe(true)
  })
})

describe('exempt business (0%): the stated total, whatever the basis', () => {
  it.each(NS.flatMap((n) => [[n, 'incl_vat'], [n, 'excl_vat'], [n, null]] as const))('%i lines, basis %s', (n, basis) => {
    const r = price(n, basis, 0)
    expect(r.totals).toMatchObject({ subtotalAmount: 18500 * n, taxAmount: 0, totalAmount: 18500 * n })
    expect(r.basis).toBe('no_vat')
    expect(r.exact).toBe(true)
  })
})
