import { computeQuoteTotals, type QuoteTotals } from './totals'
import { round2 } from '@/lib/billing/totals'
import { MAX_ITEM_TITLE_LENGTH, MAX_ITEMS, MAX_TITLE_LENGTH, MAX_VALIDITY_DAYS, MIN_VALIDITY_DAYS } from './templateValidation'

/**
 * Owner-stated prices → the before-VAT figures a quote stores.
 *
 * A quote line stores `unitPrice` and `discount` BEFORE VAT, and the money
 * primitives (`computeLineTotals`, via `computeQuoteTotals`) round the line
 * subtotal to agorot before VAT is added. So "₪18,500 including VAT" has to be
 * solved backwards, and roughly one VAT-inclusive amount in seven has no
 * before-VAT price in whole agorot that lands on it exactly.
 *
 * THE RULE: solve, then RE-COMPUTE with the real primitives and report what the
 * quote WILL total. `exact` says whether that equals what the owner said. The
 * approval card shows the computed total, and that same total is what gets
 * stored — the caller pins it (`expectedTotalAmount`) so the write refuses if a
 * re-computation ever disagrees with what was approved.
 *
 * NO ARITHMETIC IS REIMPLEMENTED: totals come from `computeQuoteTotals`; this
 * file only chooses inputs for it.
 *
 * The VAT basis is never assumed. With a non-zero rate, `priceBasis` must be
 * stated or the result is `vat_basis_required`. With a 0% rate (an exempt
 * business) there is no VAT to include or exclude, so no basis is needed.
 *
 * Pure. No I/O.
 */

export type PriceBasis = 'incl_vat' | 'excl_vat'

export type OwnerQuoteLineInput = {
  title: string
  description?: string
  quantity: number
  /** Per-unit price, in the quote's `priceBasis`. */
  unitAmount: number
  /** Line discount, in the quote's `priceBasis`. */
  discountAmount?: number
}

export type OwnerPricingInput = {
  lines: readonly OwnerQuoteLineInput[]
  /** null when the owner did not say. Refused unless the rate is 0. */
  priceBasis: PriceBasis | null
  ratePercent: number
}

export type PricedOwnerLine = {
  title: string
  description: string
  quantity: number
  /** Before VAT, up to 4 decimals (the column's precision). */
  unitPrice: number
  /** Before VAT, agorot. */
  discount: number
}

export type OwnerPricingFailure =
  | 'no_lines'
  | 'too_many_lines'
  | 'invalid_line'
  | 'discount_exceeds_price'
  | 'vat_basis_required'
  | 'invalid_rate'

export type OwnerPricingResult =
  | {
      ok: true
      /** `no_vat` when the rate is 0 and no basis applies. */
      basis: PriceBasis | 'no_vat'
      ratePercent: number
      lines: PricedOwnerLine[]
      totals: QuoteTotals
      /** What the owner's figures add up to, in the stated basis's terms (incl. VAT for incl_vat). */
      requestedTotal: number
      /** Whether `totals.totalAmount` equals what the owner asked for. Always true for excl_vat / no_vat. */
      exact: boolean
    }
  | { ok: false; reason: OwnerPricingFailure }

// Column bounds: quantity numeric(10,4), unitPrice numeric(14,4), money numeric(14,2).
const MAX_QUANTITY = 999_999
const MAX_AMOUNT = 99_999_999

const round4 = (n: number) => Math.round(n * 10_000) / 10_000
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

function validLine(l: OwnerQuoteLineInput): boolean {
  const title = typeof l.title === 'string' ? l.title.trim() : ''
  if (!title || title.length > MAX_ITEM_TITLE_LENGTH) return false
  if (!finite(l.quantity) || l.quantity <= 0 || l.quantity > MAX_QUANTITY || round4(l.quantity) !== l.quantity) return false
  if (!finite(l.unitAmount) || l.unitAmount < 0 || l.unitAmount > MAX_AMOUNT) return false
  if (l.discountAmount != null && (!finite(l.discountAmount) || l.discountAmount < 0)) return false
  return true
}

/** The line total a subtotal produces at `rate`, exactly as `computeLineTotals` does it. */
const grossOf = (subtotal: number, rate: number) => round2(subtotal + round2((subtotal * rate) / 100))

/**
 * The before-VAT subtotal whose VAT-inclusive total is `gross`, or the nearest
 * one when none is exact. Tries the rounded quotient and one agora either side,
 * which covers every subtotal that can map to `gross` (VAT moves a one-agora
 * step in the subtotal by at most a few agorot at any real rate).
 */
export function subtotalForGross(gross: number, rate: number): { subtotal: number; exact: boolean } {
  const base = round2(gross / (1 + rate / 100))
  for (const candidate of [base, round2(base - 0.01), round2(base + 0.01)]) {
    if (candidate >= 0 && grossOf(candidate, rate) === gross) return { subtotal: candidate, exact: true }
  }
  return { subtotal: Math.max(base, 0), exact: false }
}

function priceInclusiveLine(l: OwnerQuoteLineInput, rate: number): PricedOwnerLine | null {
  const discountGross = round2(l.discountAmount ?? 0)
  const lineGross = round2(l.quantity * l.unitAmount - discountGross)
  if (lineGross < 0) return null
  const { subtotal } = subtotalForGross(lineGross, rate)
  const base = { title: l.title.trim(), description: (l.description ?? '').trim(), quantity: l.quantity }

  if (discountGross === 0) {
    // One price per unit that lands on the subtotal. Exactness is judged on the
    // whole quote afterwards, so a miss here is reported, never hidden.
    return { ...base, unitPrice: round4(subtotal / l.quantity), discount: 0 }
  }
  // With a discount: the undiscounted unit price before VAT, and the discount
  // that brings the line to the solved subtotal.
  const unitPrice = round4(l.unitAmount / (1 + rate / 100))
  const discount = round2(round2(l.quantity * unitPrice) - subtotal)
  return { ...base, unitPrice, discount: Math.max(discount, 0) }
}

export function priceOwnerQuote(input: OwnerPricingInput): OwnerPricingResult {
  const rate = input.ratePercent
  if (!finite(rate) || rate < 0 || rate > 100) return { ok: false, reason: 'invalid_rate' }
  if (input.lines.length === 0) return { ok: false, reason: 'no_lines' }
  if (input.lines.length > MAX_ITEMS) return { ok: false, reason: 'too_many_lines' }
  if (!input.lines.every(validLine)) return { ok: false, reason: 'invalid_line' }
  if (input.lines.some((l) => round2(l.discountAmount ?? 0) > round2(l.quantity * l.unitAmount))) {
    return { ok: false, reason: 'discount_exceeds_price' }
  }

  if (rate !== 0 && input.priceBasis !== 'incl_vat' && input.priceBasis !== 'excl_vat') {
    return { ok: false, reason: 'vat_basis_required' }
  }
  const basis: PriceBasis | 'no_vat' = rate === 0 ? 'no_vat' : (input.priceBasis as PriceBasis)

  const priced: PricedOwnerLine[] = []
  for (const l of input.lines) {
    if (basis === 'incl_vat') {
      const line = priceInclusiveLine(l, rate)
      if (!line) return { ok: false, reason: 'discount_exceeds_price' }
      priced.push(line)
    } else {
      priced.push({
        title: l.title.trim(),
        description: (l.description ?? '').trim(),
        quantity: l.quantity,
        unitPrice: round4(l.unitAmount),
        discount: round2(l.discountAmount ?? 0),
      })
    }
  }

  const totals = computeQuoteTotals(
    priced.map((p) => ({ quantity: p.quantity, unitPrice: p.unitPrice, discount: p.discount, taxRatePercentSnapshot: rate })),
  )

  if (basis !== 'incl_vat') {
    return { ok: true, basis, ratePercent: rate, lines: priced, totals, requestedTotal: totals.totalAmount, exact: true }
  }

  let requested = 0
  for (const l of input.lines) requested = round2(requested + round2(l.quantity * l.unitAmount - round2(l.discountAmount ?? 0)))
  return {
    ok: true,
    basis,
    ratePercent: rate,
    lines: priced,
    totals,
    requestedTotal: requested,
    exact: totals.totalAmount === requested,
  }
}

/** Header-level validation shared by the WhatsApp proposal and the write. */
export function validQuoteTitle(title: unknown): title is string {
  return typeof title === 'string' && title.trim().length > 0 && title.trim().length <= MAX_TITLE_LENGTH
}

export function validValidityDays(days: unknown): days is number {
  return typeof days === 'number' && Number.isInteger(days) && days >= MIN_VALIDITY_DAYS && days <= MAX_VALIDITY_DAYS
}
