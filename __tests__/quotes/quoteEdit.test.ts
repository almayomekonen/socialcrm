import { describe, expect, it } from 'vitest'
import { applyQuoteChanges, type QuoteLineChange, type StoredQuoteLine } from '@/lib/quotes/edit'
import { QUOTE_LINK_TOKEN_RE, QUOTE_LINK_TTL_MS, hashQuoteLinkToken, newQuoteLinkToken, quoteLinkExpiry } from '@/lib/quotes/deliveryLink'
import { maskedPhone, quoteCustomerMessage, quoteInboxSummary, quoteSendButtons, quoteSendCard } from '@/lib/waAssistant/quotes/deliveryCopy'

const kitchen: StoredQuoteLine = { title: 'שיפוץ מטבח', description: '', quantity: 1, unitPrice: 1000, discount: 0 }
const door: StoredQuoteLine = { title: 'התקנת דלת', description: '', quantity: 2, unitPrice: 300, discount: 0 }
const change = (over: Partial<QuoteLineChange>): QuoteLineChange => ({ op: 'update', match: null, lineNumber: null, title: null, quantity: null, unitAmount: null, discountAmount: null, discountPercent: null, ...over })
const exempt = { priceBasis: null, ratePercent: 0 } as const

describe('applying the owner’s change to stored lines', () => {
  it('one line needs no pointer', () => {
    expect(applyQuoteChanges([kitchen], [change({ unitAmount: 2000 })], exempt)).toEqual({ ok: true, lines: [{ ...kitchen, unitPrice: 2000 }] })
  })
  it('several lines need the owner to say which', () => {
    expect(applyQuoteChanges([kitchen, door], [change({ unitAmount: 2000 })], exempt)).toEqual({ ok: false, reason: 'line_ambiguous' })
  })
  it('finds a line by the owner’s words or number, and says so when it cannot', () => {
    const byWords = applyQuoteChanges([kitchen, door], [change({ match: 'דלת', unitAmount: 500 })], exempt)
    expect(byWords.ok && byWords.lines[1].unitPrice).toBe(500)
    const byNumber = applyQuoteChanges([kitchen, door], [change({ lineNumber: 1, quantity: 3 })], exempt)
    expect(byNumber.ok && byNumber.lines[0].quantity).toBe(3)
    expect(applyQuoteChanges([kitchen, door], [change({ match: 'חלון', unitAmount: 1 })], exempt)).toEqual({ ok: false, reason: 'line_not_found' })
    expect(applyQuoteChanges([kitchen, door], [change({ lineNumber: 9, unitAmount: 1 })], exempt)).toEqual({ ok: false, reason: 'line_not_found' })
  })
  it('adds and removes, but never leaves a quote with nothing', () => {
    const added = applyQuoteChanges([kitchen], [change({ op: 'add', title: 'התקנה', unitAmount: 500 })], exempt)
    expect(added.ok && added.lines.map((l) => l.title)).toEqual(['שיפוץ מטבח', 'התקנה'])
    expect(applyQuoteChanges([kitchen], [change({ op: 'add', title: 'התקנה' })], exempt)).toEqual({ ok: false, reason: 'price_missing' })
    const removed = applyQuoteChanges([kitchen, door], [change({ op: 'remove', lineNumber: 2 })], exempt)
    expect(removed.ok && removed.lines).toEqual([kitchen])
    expect(applyQuoteChanges([kitchen], [change({ op: 'remove' })], exempt)).toEqual({ ok: false, reason: 'no_lines_left' })
  })
  it('a price on a VAT-charging business needs its basis, and is stored before VAT', () => {
    const vat = { ratePercent: 18 }
    expect(applyQuoteChanges([kitchen], [change({ unitAmount: 2360 })], { ...vat, priceBasis: null })).toEqual({ ok: false, reason: 'vat_basis_required' })
    const incl = applyQuoteChanges([kitchen], [change({ unitAmount: 2360 })], { ...vat, priceBasis: 'incl_vat' })
    expect(incl.ok && incl.lines[0].unitPrice).toBe(2000)
    const excl = applyQuoteChanges([kitchen], [change({ unitAmount: 1180 })], { ...vat, priceBasis: 'excl_vat' })
    expect(excl.ok && excl.lines[0].unitPrice).toBe(1180)
  })
  it('an exempt business needs no basis', () => {
    expect(applyQuoteChanges([kitchen], [change({ unitAmount: 1180 })], exempt).ok).toBe(true)
  })
  it('a percent discount is computed here; a discount above the price is refused', () => {
    const pct = applyQuoteChanges([kitchen], [change({ discountPercent: 10 })], exempt)
    expect(pct.ok && pct.lines[0].discount).toBe(100)
    expect(applyQuoteChanges([kitchen], [change({ discountAmount: 2000 })], exempt)).toEqual({ ok: false, reason: 'discount_exceeds_price' })
  })
  it('a change that changes nothing is not an edit', () => {
    expect(applyQuoteChanges([kitchen], [change({ unitAmount: 1000 })], exempt)).toEqual({ ok: false, reason: 'nothing_changed' })
  })
  it('does not touch the stored lines it was given', () => {
    const original = { ...kitchen }
    applyQuoteChanges([kitchen], [change({ unitAmount: 2000 })], exempt)
    expect(kitchen).toEqual(original)
  })
})

describe('the customer link token', () => {
  it('is 256 random bits in a fixed, URL-safe shape', () => {
    const a = newQuoteLinkToken()
    expect(a).toMatch(QUOTE_LINK_TOKEN_RE)
    expect(newQuoteLinkToken()).not.toBe(a)
  })
  it('is stored only as a hash', () => {
    const t = newQuoteLinkToken()
    expect(hashQuoteLinkToken(t)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashQuoteLinkToken(t)).not.toContain(t)
  })
  it('lives through the quote’s validity date, capped, and 30 days without one', () => {
    const now = Date.UTC(2026, 10, 10)
    expect(quoteLinkExpiry(null, now).getTime()).toBe(now + QUOTE_LINK_TTL_MS)
    expect(quoteLinkExpiry('2026-11-20', now).toISOString()).toBe('2026-11-21T00:00:00.000Z')
    expect(quoteLinkExpiry('2030-01-01', now).getTime()).toBe(now + 180 * 86_400_000)
  })
  it('refuses anything that is not that shape', () => {
    for (const bad of ['', 'abc', '../../etc/passwd', `${'a'.repeat(43)}/`, 'a'.repeat(44)]) expect(bad).not.toMatch(QUOTE_LINK_TOKEN_RE)
  })
})

describe('what people read', () => {
  it('the owner sees only the last four digits, and that nothing goes out before approval', () => {
    const card = quoteSendCard({ lead: 'דוד כהן', quoteNumber: 12, version: 2, totalAmount: 18500, recipient: 'דוד כהן', phoneE164: '+972501234567', ttlHours: 2 })
    expect(card).toContain(maskedPhone('+972501234567'))
    expect(card).toContain('מספר שמסתיים ב-4567')
    expect(card).not.toContain('50123')
    expect(card).toContain('(גרסה 2)')
    expect(card).toContain('שום דבר לא יישלח ללקוח לפני שתאשרו')
  })
  it('three buttons within Meta’s limits, bound to one token', () => {
    const b = quoteSendButtons('a'.repeat(32))
    expect(b.map((x) => x.id.split(':')[1])).toEqual(['approve', 'edit', 'reject'])
    for (const x of b) expect(x.title.length).toBeLessThanOrEqual(20)
  })
  it('the customer gets the link and no amounts; the Inbox never keeps the link', () => {
    const m = quoteCustomerMessage({ name: 'דוד', quoteNumber: 12, business: 'שיפוצי הצפון', link: 'https://x/api/q/TOKEN' })
    expect(m).toContain('https://x/api/q/TOKEN')
    expect(m).not.toContain('₪')
    expect(quoteInboxSummary(12)).toBe('[הצעת מחיר מספר 12 נשלחה בוואטסאפ]')
  })
})
