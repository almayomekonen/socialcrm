import { describe, expect, it } from 'vitest'
import { priceOwnerQuote, type OwnerQuoteLineInput } from '@/lib/quotes/ownerPricing'
import { quoteCard } from '@/lib/waAssistant/quotes/copy'
import { MAX_BUTTON_BODY_CHARS } from '@/lib/whatsapp/platform/sendText'

/**
 * How many items fit a WhatsApp approval card (H16). Measured with the real card
 * and the real pricing, because the limit is Meta's 1,024 characters and not an
 * item count: it moves with how long the item names and amounts are.
 */

const lengthOf = (lines: OwnerQuoteLineInput[], validityDays: number | null, percent: number | null) => {
  const p = priceOwnerQuote({ lines, priceBasis: 'incl_vat', ratePercent: 18 })
  if ('reason' in p) throw new Error(p.reason)
  return quoteCard({ lead: 'דוד כהן', title: 'שיפוץ מטבח', lines: p.lines, discountPercents: lines.map(() => percent), totals: p.totals, basis: p.basis, ratePercent: p.ratePercent, requestedTotal: p.requestedTotal, exact: p.exact, validityDays }).length
}

function maxItems(title: string, unitAmount: number, opts: { validityDays?: number; percent?: number } = {}) {
  const line = (): OwnerQuoteLineInput => ({ title, quantity: 1, unitAmount, discountAmount: opts.percent ? (unitAmount * opts.percent) / 100 : undefined })
  let n = 0
  while (n < 50 && lengthOf(Array.from({ length: n + 1 }, line), opts.validityDays ?? null, opts.percent ?? null) <= MAX_BUTTON_BODY_CHARS) n++
  return n
}

const SHORT = 'חלון'
const MEDIUM = 'התקנת ארון מטבח עליון'
const LONG = 'פירוק והתקנה של ארונות מטבח כולל הובלה ופינוי פסולת'

describe('the actual card limit', () => {
  it.each([
    ['short names, small prices', SHORT, 100, {}, 23],
    ['short names, 5-digit prices', SHORT, 18500, {}, 18],
    ['medium names, 5-digit prices', MEDIUM, 18500, {}, 12],
    ['long names, 5-digit prices', LONG, 18500, {}, 8],
    ['medium names with a validity', MEDIUM, 18500, { validityDays: 30 }, 12],
    ['medium names with a percent discount on every line', MEDIUM, 18500, { percent: 10 }, 8],
  ])('%s', (_label, title, unitAmount, opts, expected) => {
    expect(maxItems(title as string, unitAmount as number, opts as object)).toBe(expected)
  })
})

describe('whole-quote VAT rounding on VAT-inclusive prices', () => {
  // VAT is computed once on the whole quote, so each line's rounding adds up: 12 × 15,677.97 × 18% = 33,864.42.
  it('12 equal lines at ₪18,500 store ₪222,000.06, and the result says it is not exact', () => {
    const p = priceOwnerQuote({ lines: Array.from({ length: 12 }, () => ({ title: MEDIUM, quantity: 1, unitAmount: 18500 })), priceBasis: 'incl_vat', ratePercent: 18 })
    if ('reason' in p) throw new Error(p.reason)
    expect(p.requestedTotal).toBe(222000)
    expect(p.totals.totalAmount).toBe(222000.06)
    expect(p.exact).toBe(false)
  })
})
