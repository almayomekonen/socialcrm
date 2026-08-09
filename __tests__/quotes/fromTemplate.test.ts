import { describe, expect, it } from 'vitest'
import { buildQuoteFromTemplate, type BuildQuoteFromTemplateInput } from '@/lib/quotes/fromTemplate'

/**
 * The SNAPSHOT invariant, which is the whole reason this function is pure and
 * separate from the DB layer:
 *
 *   a template edit must never reach back into a quote already made.
 */

const NOW = Date.parse('2026-08-09T09:00:00Z')

const template = () => ({
  id: 5,
  title: 'הצעת מחיר — חבילת אתר',
  introText: 'שמחים להציע',
  termsText: 'תנאי תשלום: שוטף +30',
  currency: 'ILS',
  locale: 'he',
  validityDays: 14,
})

const items = () => [
  { lineNumber: 1, title: 'חבילת אתר', description: 'עיצוב ובנייה', quantity: 1, unitPrice: 4900, discount: 0, isOptional: false },
  { lineNumber: 2, title: 'תחזוקה חודשית', description: '', quantity: 12, unitPrice: 200, discount: 0, isOptional: true },
]

const input = (over: Partial<BuildQuoteFromTemplateInput> = {}): BuildQuoteFromTemplateInput => ({
  template: template(),
  items: items(),
  recipient: { name: 'דוד כהן', email: 'david@example.co.il', phone: '0501234567' },
  tax: { taxRateId: 11, ratePercent: 18 },
  nowMs: NOW,
  ...over,
})

describe('buildQuoteFromTemplate — the snapshot', () => {
  it('copies the template’s authoritative price onto the quote', () => {
    const built = buildQuoteFromTemplate(input())
    expect(built.items[0].unitPrice).toBe(4900)
    expect(built.quote.subtotalAmount).toBe(4900)
    expect(built.quote.taxAmount).toBe(882)
    expect(built.quote.totalAmount).toBe(5782)
  })

  it('a later template edit does NOT change a quote already built', () => {
    // ₪4,900 → ₪5,500, the exact scenario from the brief.
    const source = items()
    const before = buildQuoteFromTemplate(input({ items: source }))
    source[0].unitPrice = 5500
    const after = buildQuoteFromTemplate(input({ items: source }))

    expect(before.items[0].unitPrice).toBe(4900)
    expect(before.quote.totalAmount).toBe(5782)
    expect(after.items[0].unitPrice).toBe(5500)
    expect(after.quote.totalAmount).toBe(6490)
  })

  it('holds no reference back into the template’s item objects', () => {
    const source = items()
    const built = buildQuoteFromTemplate(input({ items: source }))
    source[0].title = 'שונה אחרי היצירה'
    source[0].unitPrice = 99
    expect(built.items[0].title).toBe('חבילת אתר')
    expect(built.items[0].unitPrice).toBe(4900)
  })

  it('copies the customer-facing text and the recipient', () => {
    const built = buildQuoteFromTemplate(input())
    expect(built.quote.title).toBe('הצעת מחיר — חבילת אתר')
    expect(built.quote.introText).toBe('שמחים להציע')
    expect(built.quote.termsText).toBe('תנאי תשלום: שוטף +30')
    expect(built.quote.recipientNameSnapshot).toBe('דוד כהן')
    expect(built.quote.recipientEmailSnapshot).toBe('david@example.co.il')
    expect(built.quote.recipientPhoneSnapshot).toBe('0501234567')
  })
})

describe('buildQuoteFromTemplate — tax comes from agency policy, not the template', () => {
  it('stamps the resolved rate and rate id onto every line', () => {
    const built = buildQuoteFromTemplate(input())
    expect(built.items.map((i) => i.taxRatePercentSnapshot)).toEqual([18, 18])
    expect(built.items.map((i) => i.taxRateId)).toEqual([11, 11])
  })

  it('an exempt business quotes 0% with a null rate id', () => {
    // What `resolveActiveTaxRateForLine` returns for עוסק פטור: no rate row is
    // being applied, so the id is null rather than a rate we are not using.
    const built = buildQuoteFromTemplate(input({ tax: { taxRateId: null, ratePercent: 0 } }))
    expect(built.quote.taxAmount).toBe(0)
    expect(built.quote.totalAmount).toBe(4900)
    expect(built.items[0].taxRateId).toBeNull()
    expect(built.items[0].taxRatePercentSnapshot).toBe(0)
  })
})

describe('buildQuoteFromTemplate — optional lines', () => {
  it('the optional line is carried but excluded from the total', () => {
    const built = buildQuoteFromTemplate(input())
    expect(built.items).toHaveLength(2)
    expect(built.items[1].isOptional).toBe(true)
    // 12 × 200 = 2,400 + VAT, present on the line, absent from the header.
    expect(built.items[1].lineTotal).toBe(2832)
    expect(built.quote.totalAmount).toBe(5782)
  })
})

describe('buildQuoteFromTemplate — ordering and validity', () => {
  it('renumbers densely, so a gap in the template does not reach the quote', () => {
    const built = buildQuoteFromTemplate(
      input({
        items: [
          { lineNumber: 4, title: 'ג', description: '', quantity: 1, unitPrice: 30, discount: 0, isOptional: false },
          { lineNumber: 1, title: 'א', description: '', quantity: 1, unitPrice: 10, discount: 0, isOptional: false },
          { lineNumber: 2, title: 'ב', description: '', quantity: 1, unitPrice: 20, discount: 0, isOptional: false },
        ],
      }),
    )
    expect(built.items.map((i) => i.lineNumber)).toEqual([1, 2, 3])
    expect(built.items.map((i) => i.title)).toEqual(['א', 'ב', 'ג'])
  })

  it('resolves the template’s validity window to a concrete date', () => {
    expect(buildQuoteFromTemplate(input()).quote.expiresAt).toBe('2026-08-23')
  })

  it('an explicit override wins over the template default', () => {
    expect(buildQuoteFromTemplate(input({ validityDaysOverride: 7 })).quote.expiresAt).toBe('2026-08-16')
  })

  it('a zero or negative override is ignored rather than producing a quote that is already expired', () => {
    expect(buildQuoteFromTemplate(input({ validityDaysOverride: 0 })).quote.expiresAt).toBe('2026-08-23')
    expect(buildQuoteFromTemplate(input({ validityDaysOverride: -3 })).quote.expiresAt).toBe('2026-08-23')
  })
})
