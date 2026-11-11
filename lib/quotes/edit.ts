/**
 * The owner's change to a quote they are reviewing, applied to its stored lines.
 *
 * Stored prices are before VAT, so a price the owner states including VAT is
 * converted here and every other line keeps its stored value. Whatever comes out
 * is re-priced by `priceOwnerQuote` and shown on a card before anything changes.
 *
 * Pure. No I/O.
 */

export type StoredQuoteLine = { title: string; description: string; quantity: number; unitPrice: number; discount: number }

export type QuoteLineChange = {
  op: 'update' | 'add' | 'remove'
  /** The owner's words for which line, or null. */
  match: string | null
  lineNumber: number | null
  title: string | null
  quantity: number | null
  unitAmount: number | null
  discountAmount: number | null
  discountPercent: number | null
}

export type QuoteEditFailure = 'nothing_changed' | 'line_ambiguous' | 'line_not_found' | 'price_missing' | 'vat_basis_required' | 'discount_exceeds_price' | 'no_lines_left'
export type QuoteEditResult = { ok: true; lines: StoredQuoteLine[] } | { ok: false; reason: QuoteEditFailure }

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000

function findLine(lines: readonly StoredQuoteLine[], c: QuoteLineChange): number | QuoteEditFailure {
  if (c.lineNumber != null) return c.lineNumber >= 1 && c.lineNumber <= lines.length ? c.lineNumber - 1 : 'line_not_found'
  const words = c.match?.trim()
  if (words) {
    const hits = lines.flatMap((l, i) => (l.title.includes(words) ? [i] : []))
    if (hits.length === 1) return hits[0]
    return hits.length === 0 ? 'line_not_found' : 'line_ambiguous'
  }
  return lines.length === 1 ? 0 : 'line_ambiguous'
}

export function applyQuoteChanges(stored: readonly StoredQuoteLine[], changes: readonly QuoteLineChange[], opts: { priceBasis: 'incl_vat' | 'excl_vat' | null; ratePercent: number }): QuoteEditResult {
  const { priceBasis, ratePercent: rate } = opts
  const beforeVat = (amount: number) => (rate !== 0 && priceBasis === 'incl_vat' ? round4(amount / (1 + rate / 100)) : amount)
  const needsBasis = (c: QuoteLineChange) => rate !== 0 && !priceBasis && (c.unitAmount != null || c.discountAmount != null)

  const lines = stored.map((l) => ({ ...l }))
  const removed = new Set<StoredQuoteLine>()
  for (const c of changes) {
    if (needsBasis(c)) return { ok: false, reason: 'vat_basis_required' }
    if (c.op === 'add') {
      if (!c.title?.trim() || c.unitAmount == null) return { ok: false, reason: 'price_missing' }
      lines.push(withDiscount({ title: c.title.trim(), description: '', quantity: c.quantity ?? 1, unitPrice: beforeVat(c.unitAmount), discount: 0 }, c, beforeVat))
      continue
    }
    const live = lines.filter((l) => !removed.has(l))
    const index = findLine(live, c)
    if (typeof index !== 'number') return { ok: false, reason: index }
    const line = live[index]
    if (c.op === 'remove') {
      removed.add(line)
      continue
    }
    if (c.title?.trim()) line.title = c.title.trim()
    if (c.quantity != null) line.quantity = c.quantity
    if (c.unitAmount != null) line.unitPrice = beforeVat(c.unitAmount)
    Object.assign(line, withDiscount(line, c, beforeVat))
  }

  const next = lines.filter((l) => !removed.has(l))
  if (next.length === 0) return { ok: false, reason: 'no_lines_left' }
  if (next.some((l) => l.discount > round2(l.quantity * l.unitPrice))) return { ok: false, reason: 'discount_exceeds_price' }
  const same = next.length === stored.length && next.every((l, i) => (['title', 'description', 'quantity', 'unitPrice', 'discount'] as const).every((k) => l[k] === stored[i][k]))
  if (same) return { ok: false, reason: 'nothing_changed' }
  return { ok: true, lines: next }
}

function withDiscount(line: StoredQuoteLine, c: QuoteLineChange, beforeVat: (n: number) => number): StoredQuoteLine {
  if (c.discountPercent != null) return { ...line, discount: round2((line.quantity * line.unitPrice * c.discountPercent) / 100) }
  if (c.discountAmount != null) return { ...line, discount: round2(beforeVat(c.discountAmount)) }
  return line
}
