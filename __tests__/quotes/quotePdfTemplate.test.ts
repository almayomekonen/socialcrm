import { describe, expect, it } from 'vitest'
import { renderQuoteHtml, type QuotePdfQuote } from '@/lib/quotes/pdf/QuoteTemplate'
import { businessDate, quotePdfFilename, unitIls } from '@/lib/quotes/pdf/format'
import type { QuotePdfItem } from '@/lib/quotes/pdf/components/QuoteLinesTable'
import type { IssuerData } from '@/lib/billing/issuer/fields'

/** The quote document's HTML. Chromium draws the pages; what is pinned here is what makes them right. */

const quote: QuotePdfQuote = {
  quoteNumber: 12,
  readyAt: '2026-11-08T10:00:00Z',
  expiresAt: null,
  title: 'שיפוץ מטבח',
  subtotalAmount: '15677.97',
  discountAmount: '0.00',
  taxAmount: '2822.03',
  totalAmount: '18500.00',
  recipientNameSnapshot: 'דוד כהן',
  recipientPhoneSnapshot: '0501234567',
  recipientEmailSnapshot: '',
}
const item = (over: Partial<QuotePdfItem> = {}): QuotePdfItem => ({ id: 1, title: 'שיפוץ מטבח', description: '', quantity: '1.0000', unitPrice: '15677.9700', discount: '0.00', lineSubtotal: '15677.97', taxRatePercentSnapshot: '18.0000', ...over })
const issuer = (over: Partial<IssuerData> = {}) => ({ name: 'שיפוצי הצפון', businessType: 'authorized', taxId: '514123456', address: 'הרצל 12', phone: '04-8123456', email: 'a@b.co', img: null, country: 'IL', defaultCurrency: 'ILS', locale: 'he', docNumberFormat: '', bankDetails: {}, ...over }) as IssuerData
const render = (q: Partial<QuotePdfQuote> = {}, items = [item()], i: IssuerData | null = issuer(), fallbackName = '') => renderQuoteHtml({ quote: { ...quote, ...q }, items, issuer: i, fallbackName })

describe('Hebrew, right to left, and on the page', () => {
  it('is an RTL Hebrew document with the embedded font', async () => {
    const html = await render()
    expect(html).toContain('<html lang="he" dir="rtl">')
    expect(html).toContain('@font-face')
    expect(html).toContain('data:font/ttf;base64,')
    expect(html).toContain('Noto Sans Hebrew')
    expect(html).toContain('הצעת מחיר')
  })
  it('sets page margins on every page and keeps rows and the totals whole', async () => {
    const html = await render()
    expect(html).toContain('@page { size: 210mm 297mm; margin: 16mm 0;')
    expect(html).toMatch(/<tr style="break-inside:avoid/)
    const block = html.indexOf('<tbody style="break-inside:avoid')
    expect(block).toBeGreaterThan(-1)
    expect(html.indexOf('סה&quot;כ לתשלום', block)).toBeGreaterThan(block)
    expect(html.indexOf('<footer', block)).toBeGreaterThan(block)
    expect(html.indexOf('</tbody>', block)).toBeGreaterThan(html.indexOf('<footer', block))
  })
  it('the closing rows stay with the totals; earlier rows may break away', async () => {
    const lines = Array.from({ length: 5 }, (_, i) => item({ id: i + 1, title: `שורה-${i + 1}` }))
    const html = await render({}, lines)
    const closing = html.indexOf('<tbody style="break-inside:avoid')
    expect(html.indexOf('שורה-3')).toBeLessThan(closing)
    for (const n of [4, 5]) expect(html.indexOf(`שורה-${n}`)).toBeGreaterThan(closing)
  })
  it('names every page after the first, with digits only in the CSS', async () => {
    const html = await render({ quoteNumber: '12"}</style><script>alert(1)</script>' })
    expect(html).toContain('@top-right { content: "הצעת מחיר מספר 121"')
    expect(html).toContain('@page :first { @top-right { content: none; } }')
    expect(html).not.toContain('content: "הצעת מחיר מספר 12"}')
    expect(html.slice(0, html.indexOf('</style>'))).not.toContain('<script>')
  })
  it('the numeric headers carry the same gap as their values', async () => {
    const html = await render()
    expect((html.match(/<th style="padding:0 16px 8px 0/g) ?? []).length).toBe(3)
  })
  it('never calls itself an invoice', async () => {
    const html = await render()
    expect(html).not.toContain('חשבונית')
    expect(html).not.toContain('קבלה')
  })
})

describe('content and totals are the stored values', () => {
  it('number, customer, line, subtotal, VAT and exact total', async () => {
    const html = await render()
    for (const s of ['12', 'דוד כהן', '0501234567', 'שיפוץ מטבח', '₪15,677.97', 'מע&quot;מ (18%)', '₪2,822.03', '₪18,500.00']) expect(html).toContain(s)
  })
  it('keeps the unit price precision so the line adds up', async () => {
    const html = await render({}, [item({ quantity: 3, unitPrice: '847.4576', lineSubtotal: '2542.37' })])
    expect(html).toContain('₪847.4576')
    expect(html).toContain('₪2,542.37')
  })
  it('a discount adds its column and says the subtotal is after it', async () => {
    const html = await render({ discountAmount: '500.00', subtotalAmount: '15000.00' }, [item({ discount: '500.00', lineSubtotal: '15000.00' })])
    expect(html).toContain('>הנחה<')
    expect(html).toContain('>הנחות<')
    expect(html).toContain('₪500.00')
    expect(html).toContain('אחרי הנחות')
  })
  it('no discount: no discount column, row or wording', async () => {
    const html = await render()
    expect(html).not.toContain('הנחה')
    expect(html).not.toContain('הנחות')
  })
  describe('an exempt business', () => {
    const exemptLine = item({ taxRatePercentSnapshot: '0.0000', unitPrice: 18500, lineSubtotal: 18500 })
    const exemptQuote = { taxAmount: '0.00', subtotalAmount: '18500.00', totalAmount: '18500.00' }
    it('says it is exempt and states no VAT anywhere', async () => {
      const html = await render(exemptQuote, [exemptLine], issuer({ businessType: 'exempt', taxId: '034567891' }))
      expect(html).toContain('עוסק פטור מס׳')
      expect(html).toContain('034567891')
      expect(html).not.toContain('ע.מ / ח.פ')
      expect(html).not.toContain('מע&quot;מ')
      expect(html).toContain('סה&quot;כ לתשלום')
      expect(html).toContain('₪18,500.00')
    })
    it('still says it is exempt with no registration number', async () => {
      const html = await render(exemptQuote, [exemptLine], issuer({ businessType: 'exempt', taxId: null }))
      expect(html).toContain('עוסק פטור')
      expect(html).not.toContain('מס׳')
    })
    it('keeps the discount, with no before-VAT wording', async () => {
      const html = await render({ ...exemptQuote, discountAmount: '500.00', subtotalAmount: '18000.00', totalAmount: '18000.00' }, [item({ taxRatePercentSnapshot: '0.0000', discount: '500.00', lineSubtotal: 18000 })], issuer({ businessType: 'exempt' }))
      expect(html).toContain('>הנחות<')
      expect(html).toContain('₪500.00')
      expect(html).not.toContain('מע&quot;מ')
    })
    it('a quote stored with VAT keeps showing that VAT', async () => {
      const html = await render({}, [item()], issuer({ businessType: 'exempt' }))
      expect(html).toContain('מע&quot;מ (18%)')
      expect(html).toContain('₪2,822.03')
    })
  })
  it('a business that charges VAT keeps every VAT label', async () => {
    const html = await render()
    for (const s of ['סכום לפני מע&quot;מ', 'סה&quot;כ לפני מע&quot;מ', 'מע&quot;מ (18%)', 'ע.מ / ח.פ']) expect(html).toContain(s)
    expect(html).not.toContain('עוסק פטור')
  })
  it('lines on different rates: the row does not claim one rate', async () => {
    const html = await render({}, [item(), item({ id: 2, taxRatePercentSnapshot: '0.0000' })])
    expect(html).not.toMatch(/מע&quot;מ \(\d+%\)/)
  })
})

describe('dates', () => {
  it('no expiration date unless one was stated', async () => {
    expect(await render()).not.toContain('בתוקף עד')
  })
  it('shows the stated expiration date', async () => {
    const html = await render({ expiresAt: '2026-12-08' })
    expect(html).toContain('בתוקף עד')
    expect(html).toContain('08/12/2026')
  })
  it('the issue date is the BUSINESS day, not the server timezone', () => {
    expect(businessDate('2026-11-08T22:30:00Z')).toBe('09/11/2026')
    expect(businessDate('2026-07-01T20:59:00Z')).toBe('01/07/2026')
    expect(businessDate('2026-07-01T21:00:00Z')).toBe('02/07/2026')
  })
})

describe('business details: only what exists', () => {
  it('shows what the agency has', async () => {
    const html = await render()
    for (const s of ['שיפוצי הצפון', '514123456', 'הרצל 12', '04-8123456', 'a@b.co']) expect(html).toContain(s)
  })
  it('invents nothing when it is missing', async () => {
    const html = await render({}, [item()], issuer({ taxId: null, address: null, phone: null, email: null }))
    expect(html).not.toContain('ע.מ / ח.פ')
    expect(html).toContain('שיפוצי הצפון')
  })
  it('falls back to the agency name, and with neither shows no issuer', async () => {
    expect(await render({}, [item()], null, 'הסוכנות')).toContain('הסוכנות')
    expect(await render({}, [item()], null, '')).not.toContain('<footer')
  })
  it('customer contact is optional', async () => {
    expect(await render({ recipientPhoneSnapshot: '', recipientEmailSnapshot: '' })).not.toContain(' · ')
  })
})

it('customer text is escaped, never markup', async () => {
  const html = await render({ title: '<script>alert(1)</script>', recipientNameSnapshot: '<img src=x onerror=y>' }, [item({ title: '</table><h1>x</h1>' })])
  expect(html).not.toContain('<script>alert')
  expect(html).not.toContain('<img src=x')
  expect(html).not.toContain('</table><h1>')
})

describe('formatters', () => {
  it('unit price precision', () => {
    expect(unitIls(1000)).toBe('₪1,000.00')
    expect(unitIls('847.4576')).toBe('₪847.4576')
  })
  it('the filename carries no path characters', () => {
    expect(quotePdfFilename({ quoteNumber: 12, recipientNameSnapshot: 'דוד/כהן: "א"' })).toBe('Quote-00012-דודכהן_א.pdf')
    expect(quotePdfFilename({ quoteNumber: null, recipientNameSnapshot: '' })).toBe('Quote-pending-Customer.pdf')
  })
})
