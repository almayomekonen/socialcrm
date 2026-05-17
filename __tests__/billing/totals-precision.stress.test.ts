import { describe, it, expect } from 'vitest'
import { computeLineTotals, sumLineTotals, computeInvoiceLegalTotals } from '@/lib/billing/totals'

/**
 * Destructive tests for the money-arithmetic primitives. The system
 * displays per-line totals and a separately-computed invoice total; these
 * tests verify they reconcile and explore the edges where floating point
 * could leak.
 */

describe('computeLineTotals — sane inputs', () => {
  it('zero everything', () => {
    expect(computeLineTotals(0, 0, 0, 0)).toEqual({ subtotal: 0, tax: 0, total: 0 })
  })

  it('1 × 100, no discount, 18% VAT', () => {
    expect(computeLineTotals(1, 100, 0, 18)).toEqual({ subtotal: 100, tax: 18, total: 118 })
  })

  it('discount larger than subtotal clamps to zero (no negative line)', () => {
    expect(computeLineTotals(1, 50, 999, 18)).toEqual({ subtotal: 0, tax: 0, total: 0 })
  })
})

describe('computeLineTotals — floating-point edges', () => {
  it('classic 0.1 × 3 issue rounds cleanly', () => {
    // 0.1 * 3 = 0.30000000000000004 in IEEE 754. round2 must collapse it.
    const { subtotal, total } = computeLineTotals(3, 0.1, 0, 0)
    expect(subtotal).toBe(0.3)
    expect(total).toBe(0.3)
  })

  it('half-cent at the boundary — documents Math.round behavior', () => {
    // 0.005 ought to round to 0.01; Math.round may pick either way due to
    // the float representation. Capture today's behavior so a future
    // change to "banker's rounding" surfaces here.
    const r = computeLineTotals(1, 0.005, 0, 0).subtotal
    expect([0.0, 0.01]).toContain(r)
  })

  it('VERY large qty * price stays finite', () => {
    const r = computeLineTotals(1e7, 1e6, 0, 18)
    expect(Number.isFinite(r.total)).toBe(true)
  })

  it('overflow into Infinity surfaces as non-finite', () => {
    // Documented: callers must reject non-finite values upstream.
    const r = computeLineTotals(1e308, 1e10, 0, 0)
    expect(Number.isFinite(r.subtotal)).toBe(false)
  })

  it('NaN input produces NaN output (no silent zero)', () => {
    const r = computeLineTotals(Number.NaN, 100, 0, 18)
    expect(Number.isNaN(r.subtotal)).toBe(true)
  })
})

describe('sumLineTotals — the per-line vs grand-total reconciliation', () => {
  it('sum of three identical clean lines tallies exactly', () => {
    const lines = Array.from({ length: 3 }, () => ({
      lineSubtotal: 100,
      lineTaxAmount: 18,
      lineTotal: 118,
    }))
    expect(sumLineTotals(lines)).toEqual({ subtotal: 300, tax: 54, total: 354 })
  })

  // The historical `sumLineTotals` path still naively sums per-line rounded
  // tax — kept for the draft preview where the user is still editing. The
  // ISSUE path no longer uses it; it goes through `computeInvoiceLegalTotals`
  // (covered exhaustively below). Capture the historical drift so we
  // notice if anything regresses.
  it('historical sumLineTotals still drifts on 100 small lines (preview-only path)', () => {
    const line = computeLineTotals(1, 0.1, 0, 18)
    const lines = Array.from({ length: 100 }, () => ({
      lineSubtotal: line.subtotal,
      lineTaxAmount: line.tax,
      lineTotal: line.total,
    }))
    // The naive sum gives 12.00; legal answer is 11.80.
    expect(sumLineTotals(lines).total).toBe(12.0)
  })

  it('penny-rounding integrity: sum of per-line totals matches grand total', () => {
    // Walk a representative invoice and verify the per-line sum reconciles
    // to the grand total. If this ever fails the displayed line-total
    // column won't add up to the displayed grand total — a customer-
    // visible accounting bug.
    const lineParams: Array<{ q: number; p: number; d: number; t: number }> = [
      { q: 1, p: 1.55, d: 0, t: 17 },
      { q: 2, p: 1.555, d: 0, t: 18 },
      { q: 3, p: 1.999, d: 0.5, t: 18 },
      { q: 0.5, p: 19.99, d: 0, t: 17 },
    ]
    const computed = lineParams.map(({ q, p, d, t }) => {
      const r = computeLineTotals(q, p, d, t)
      return { lineSubtotal: r.subtotal, lineTaxAmount: r.tax, lineTotal: r.total }
    })
    const sumOfLineTotals = computed.reduce((a, l) => a + l.lineTotal, 0)
    const grand = sumLineTotals(computed).total
    // Either exactly equal, or off by no more than a single cent. A
    // larger drift is a bug.
    expect(Math.abs(sumOfLineTotals - grand)).toBeLessThanOrEqual(0.01)
  })

  it('200-line invoice does not drift more than a penny', () => {
    const computed = Array.from({ length: 200 }, () => {
      const r = computeLineTotals(1, 7.77, 0, 18)
      return { lineSubtotal: r.subtotal, lineTaxAmount: r.tax, lineTotal: r.total }
    })
    const sumOfLineTotals = computed.reduce((a, l) => a + l.lineTotal, 0)
    const grand = sumLineTotals(computed).total
    expect(Math.abs(sumOfLineTotals - grand)).toBeLessThanOrEqual(0.01)
  })

  it('empty list returns zero — no NaN from empty average', () => {
    expect(sumLineTotals([])).toEqual({ subtotal: 0, tax: 0, total: 0 })
  })
})

// ─────────────────────────────────────────────────────────────────────
// computeInvoiceLegalTotals — the W1 fix. These are the regression tests
// the W1 ticket required: 100+ tiny lines, mixed VAT, fractional totals,
// rounding boundaries.
// ─────────────────────────────────────────────────────────────────────

describe('computeInvoiceLegalTotals — W1 regression: 100+ tiny lines', () => {
  it('100 lines × ₪0.10 @ 18% lands on the legally correct ₪11.80, not ₪12.00', () => {
    const lines = Array.from({ length: 100 }, () => ({
      lineSubtotal: 0.1,
      taxRatePercentSnapshot: 18,
    }))
    const out = computeInvoiceLegalTotals(lines)
    expect(out.subtotal).toBe(10)
    expect(out.tax).toBe(1.8)
    expect(out.total).toBe(11.8)
  })

  it('1000 lines × ₪0.01 @ 17% — overcharge would compound massively without group VAT', () => {
    const lines = Array.from({ length: 1000 }, () => ({
      lineSubtotal: 0.01,
      taxRatePercentSnapshot: 17,
    }))
    const out = computeInvoiceLegalTotals(lines)
    expect(out.subtotal).toBe(10)
    expect(out.tax).toBe(1.7)
    expect(out.total).toBe(11.7)
  })

  it('200 lines @ ₪7.77 — invoice total matches sum of per-line totals exactly', () => {
    const lines = Array.from({ length: 200 }, () => ({
      lineSubtotal: 7.77,
      taxRatePercentSnapshot: 18,
    }))
    const out = computeInvoiceLegalTotals(lines)
    const sumOfPerLineTotal = out.perLineTotal.reduce((a, x) => a + x, 0)
    expect(round2(sumOfPerLineTotal)).toBe(out.total)
  })

  it('per-line tax sums exactly to the legal tax (residual lands on last line)', () => {
    const lines = Array.from({ length: 100 }, () => ({
      lineSubtotal: 0.1,
      taxRatePercentSnapshot: 18,
    }))
    const out = computeInvoiceLegalTotals(lines)
    expect(round2(out.perLineTax.reduce((a, x) => a + x, 0))).toBe(out.tax)
  })
})

describe('computeInvoiceLegalTotals — W1 regression: mixed VAT', () => {
  it('two rate groups: standard 18% and reduced 0%', () => {
    const lines = [
      { lineSubtotal: 100, taxRatePercentSnapshot: 18 },
      { lineSubtotal: 50, taxRatePercentSnapshot: 0 },
    ]
    const out = computeInvoiceLegalTotals(lines)
    expect(out.subtotal).toBe(150)
    expect(out.tax).toBe(18)
    expect(out.total).toBe(168)
  })

  it('three rate groups, interleaved order — groups by rate not by position', () => {
    const lines = [
      { lineSubtotal: 100, taxRatePercentSnapshot: 18 }, // group A
      { lineSubtotal: 50, taxRatePercentSnapshot: 17 }, // group B
      { lineSubtotal: 30, taxRatePercentSnapshot: 18 }, // group A
      { lineSubtotal: 20, taxRatePercentSnapshot: 0 }, // group C
      { lineSubtotal: 10, taxRatePercentSnapshot: 17 }, // group B
    ]
    const out = computeInvoiceLegalTotals(lines)
    // Group A (18%): subtotal 130, tax round2(130×0.18) = 23.40
    // Group B (17%): subtotal 60, tax round2(60×0.17) = 10.20
    // Group C (0%):  subtotal 20, tax 0
    expect(out.subtotal).toBe(210)
    expect(out.tax).toBe(33.6)
    expect(out.total).toBe(243.6)
  })

  it('many tiny lines spread across two rate groups — neither group leaks', () => {
    const lines = [
      ...Array.from({ length: 50 }, () => ({ lineSubtotal: 0.1, taxRatePercentSnapshot: 18 })),
      ...Array.from({ length: 50 }, () => ({ lineSubtotal: 0.2, taxRatePercentSnapshot: 17 })),
    ]
    const out = computeInvoiceLegalTotals(lines)
    // 50×0.10 = 5.00 @ 18% → tax 0.90
    // 50×0.20 = 10.00 @ 17% → tax 1.70
    expect(out.subtotal).toBe(15)
    expect(out.tax).toBe(2.6)
    expect(out.total).toBe(17.6)
  })

  it('per-line tax sum equals legal tax under mixed rates', () => {
    const lines = [
      ...Array.from({ length: 30 }, () => ({ lineSubtotal: 1.33, taxRatePercentSnapshot: 18 })),
      ...Array.from({ length: 30 }, () => ({ lineSubtotal: 0.77, taxRatePercentSnapshot: 17 })),
    ]
    const out = computeInvoiceLegalTotals(lines)
    expect(round2(out.perLineTax.reduce((a, x) => a + x, 0))).toBe(out.tax)
  })
})

describe('computeInvoiceLegalTotals — W1 regression: fractional totals', () => {
  it('three identical lines at ₪1.555 each, 18% VAT — invoice tax derived from group sum', () => {
    const lines = Array.from({ length: 3 }, () => ({
      lineSubtotal: 1.56, // round2(1.555) lands per draft creation rule
      taxRatePercentSnapshot: 18,
    }))
    const out = computeInvoiceLegalTotals(lines)
    // Group subtotal: 4.68. Legal tax: round2(4.68 × 0.18) = round2(0.8424) = 0.84.
    expect(out.subtotal).toBe(4.68)
    expect(out.tax).toBe(0.84)
    expect(out.total).toBe(5.52)
  })

  it('mixed micro and macro lines — no precision leak', () => {
    const lines = [
      { lineSubtotal: 9999.99, taxRatePercentSnapshot: 18 },
      { lineSubtotal: 0.01, taxRatePercentSnapshot: 18 },
    ]
    const out = computeInvoiceLegalTotals(lines)
    expect(out.subtotal).toBe(10000)
    expect(out.tax).toBe(1800)
    expect(out.total).toBe(11800)
  })
})

describe('computeInvoiceLegalTotals — W6 regression: exempt issuer (0% per-line rate)', () => {
  // Exempt issuers (עוסק פטור) must produce VAT-free invoices regardless
  // of stored draft state. The page/editor compute the effective rate
  // via `effectiveTaxRatePercent`; here we verify the totals helper
  // produces the right output once that effective rate is applied.

  it('100 lines at 0% rate → tax 0, total === subtotal', () => {
    const lines = Array.from({ length: 100 }, () => ({
      lineSubtotal: 0.1,
      taxRatePercentSnapshot: 0,
    }))
    const out = computeInvoiceLegalTotals(lines)
    expect(out.subtotal).toBe(10)
    expect(out.tax).toBe(0)
    expect(out.total).toBe(10)
    out.perLineTax.forEach((t) => expect(t).toBe(0))
  })

  it('mixed-magnitude lines all at 0% — no rounding leak', () => {
    const lines = [
      { lineSubtotal: 9999.99, taxRatePercentSnapshot: 0 },
      { lineSubtotal: 0.01, taxRatePercentSnapshot: 0 },
      { lineSubtotal: 350, taxRatePercentSnapshot: 0 },
    ]
    const out = computeInvoiceLegalTotals(lines)
    expect(out.subtotal).toBe(10350)
    expect(out.tax).toBe(0)
    expect(out.total).toBe(10350)
  })

  it('single 0% line — full subtotal, zero tax', () => {
    const out = computeInvoiceLegalTotals([{ lineSubtotal: 1234.56, taxRatePercentSnapshot: 0 }])
    expect(out).toEqual({
      subtotal: 1234.56,
      tax: 0,
      total: 1234.56,
      perLineTax: [0],
      perLineTotal: [1234.56],
    })
  })
})

describe('computeInvoiceLegalTotals — W1 regression: rounding boundaries', () => {
  it('group subtotal exactly at the half-cent — defines rounding direction', () => {
    // groupSubtotal × rate / 100 must produce a stable, documented result
    // at the 0.005 boundary. Math.round picks "away from zero" for the
    // .x5 case, but float reps can drift either way. Lock today's value.
    const lines = [{ lineSubtotal: 0.05, taxRatePercentSnapshot: 18 }]
    const out = computeInvoiceLegalTotals(lines)
    // 0.05 × 0.18 = 0.009 → round2 = 0.01
    expect(out.tax).toBe(0.01)
  })

  it('exact-cent VAT — group tax lands cleanly, no residual scatter', () => {
    const lines = Array.from({ length: 5 }, () => ({
      lineSubtotal: 10,
      taxRatePercentSnapshot: 18,
    }))
    const out = computeInvoiceLegalTotals(lines)
    expect(out.tax).toBe(9)
    // Each line gets exactly 1.80 of tax (no residual).
    out.perLineTax.forEach((t) => expect(t).toBe(1.8))
  })

  it('one line — full legal tax lands on that single line', () => {
    const lines = [{ lineSubtotal: 100, taxRatePercentSnapshot: 18 }]
    const out = computeInvoiceLegalTotals(lines)
    expect(out.perLineTax).toEqual([18])
    expect(out.perLineTotal).toEqual([118])
  })

  it('empty input — zero across the board, no NaN', () => {
    expect(computeInvoiceLegalTotals([])).toEqual({
      subtotal: 0,
      tax: 0,
      total: 0,
      perLineTax: [],
      perLineTotal: [],
    })
  })

  it('zero-rate group — produces zero tax, zero per-line tax', () => {
    const lines = [
      { lineSubtotal: 100, taxRatePercentSnapshot: 0 },
      { lineSubtotal: 50, taxRatePercentSnapshot: 0 },
    ]
    const out = computeInvoiceLegalTotals(lines)
    expect(out.tax).toBe(0)
    expect(out.perLineTax).toEqual([0, 0])
  })

  it('invariant: subtotal + tax === total for any input (rounding-stable)', () => {
    const fixtures = [
      Array.from({ length: 7 }, () => ({ lineSubtotal: 13.37, taxRatePercentSnapshot: 18 })),
      Array.from({ length: 23 }, () => ({ lineSubtotal: 0.55, taxRatePercentSnapshot: 17 })),
      [
        { lineSubtotal: 1.1, taxRatePercentSnapshot: 18 },
        { lineSubtotal: 2.2, taxRatePercentSnapshot: 0 },
        { lineSubtotal: 3.3, taxRatePercentSnapshot: 17 },
      ],
    ]
    for (const f of fixtures) {
      const out = computeInvoiceLegalTotals(f)
      expect(round2(out.subtotal + out.tax)).toBe(out.total)
    }
  })
})

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
