import { describe, it, expect } from 'vitest'
import { renderInvoiceHtml } from '@/lib/billing/pdf/html/InvoiceTemplate'
import type { BillInvoiceRow, BillInvoiceLineRow } from '@/db/billing/invoices'

/**
 * Destructive HTML-generation tests. The renderer feeds Puppeteer; whatever
 * we put in the HTML is what gets layered into the PDF text layer. So:
 *   - HTML escaping is critical — malicious strings in legal name / line
 *     title must not produce broken or injectable markup.
 *   - Hebrew text must survive in LOGICAL order (search/copy/accessibility).
 *   - Mixed bidi + numbers + emoji must not collapse the layout.
 *   - Long inputs must not blow past page width assumptions.
 *
 * These are pure tests — Chromium is gated separately.
 */

function makeInvoice(overrides: Partial<BillInvoiceRow> = {}): BillInvoiceRow {
  return {
    id: 1,
    agencyId: 1,
    leadId: 1,
    billingProfileId: 1,
    createdByUserId: 1,
    docState: 'issued',
    fulfillState: 'open',
    kind: 'invoice',
    documentNumber: 1,
    documentYear: 2026,
    issuedAt: '2026-05-18T10:00:00.000Z',
    issuedByUserId: 1,
    dueAt: null,
    createdAt: '2026-05-18T10:00:00.000Z',
    updatedAt: '2026-05-18T10:00:00.000Z',
    currency: 'ILS',
    locale: 'he',
    fxRate: 1,
    subtotalAmount: 100,
    taxAmount: 18,
    roundingAmount: 0,
    totalAmount: 118,
    legalNameSnapshot: 'לקוח לדוגמה',
    taxIdSnapshot: '123456789',
    addressSnapshot: '',
    citySnapshot: '',
    zipSnapshot: '',
    countrySnapshot: 'IL',
    emailSnapshot: '',
    phoneSnapshot: '',
    issuerNameSnapshot: 'העסק שלי',
    issuerBusinessTypeSnapshot: 'authorized',
    issuerTaxIdSnapshot: '987654321',
    issuerAddressSnapshot: '',
    issuerPhoneSnapshot: '',
    issuerEmailSnapshot: '',
    replacedByInvoiceId: null,
    paymentMethod: null,
    paymentAmount: null,
    paymentDate: null,
    paymentReceived: false,
    paymentMethodSnapshot: '',
    paymentAmountSnapshot: null,
    paymentDateSnapshot: null,
    internalNotes: '',
    customerFooter: '',
    outstandingAmount: 118,
    lastEventAt: '2026-05-18T10:00:00.000Z',
    lastProjectionAt: null,
    lastViewedAt: null,
    reminderCount: 0,
    lastReminderAt: null,
    templateVersionId: 1,
    metadata: {},
    ...overrides,
  }
}

const oneLine: BillInvoiceLineRow[] = [
  {
    id: 1,
    invoiceId: 1,
    agencyId: 1,
    lineNumber: 1,
    title: 'שירות',
    description: '',
    quantity: 1,
    unitPrice: 100,
    discount: 0,
    taxRateId: null,
    taxRatePercentSnapshot: 18,
    lineSubtotal: 100,
    lineTaxAmount: 18,
    lineTotal: 118,
    metadata: {},
    createdAt: '2026-05-18T10:00:00.000Z',
    updatedAt: '2026-05-18T10:00:00.000Z',
  },
]

async function html(overrides?: { invoice?: Partial<BillInvoiceRow>; lines?: BillInvoiceLineRow[] }) {
  return renderInvoiceHtml({
    invoice: makeInvoice(overrides?.invoice ?? {}),
    lines: overrides?.lines ?? oneLine,
    issuer: null,
    fallbackName: 'העסק שלי',
    agencyLogoPng: null,
  })
}

describe('HTML escaping — injection defense', () => {
  it('escapes <script> in legal name (recipient block)', async () => {
    const out = await html({ invoice: { legalNameSnapshot: '<script>alert(1)</script>' } })
    expect(out).not.toContain('<script>alert(1)</script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('escapes ampersand in legal name', async () => {
    const out = await html({ invoice: { legalNameSnapshot: 'Smith & Sons' } })
    expect(out).toContain('Smith &amp; Sons')
    expect(out).not.toContain('Smith & Sons<') // crude check: raw & followed by tag
  })

  it('escapes quotes in customer footer', async () => {
    const out = await html({ invoice: { customerFooter: 'note "with quotes"' } })
    expect(out).toContain('note &quot;with quotes&quot;')
  })

  it('escapes line title HTML', async () => {
    const evilLines: BillInvoiceLineRow[] = [
      { ...oneLine[0], title: '<img src=x onerror=alert(1)>' },
    ]
    const out = await html({ lines: evilLines })
    expect(out).not.toContain('<img src=x')
    expect(out).toContain('&lt;img')
  })

  it('escapes line description', async () => {
    const lines: BillInvoiceLineRow[] = [
      { ...oneLine[0], description: '</style><svg onload=...>' },
    ]
    const out = await html({ lines })
    expect(out).not.toContain('</style><svg')
  })

  it('escapes recipient email (when rendered)', async () => {
    const out = await html({ invoice: { emailSnapshot: 'a"<b>@c.com' } })
    expect(out).not.toContain('<b>@')
  })
})

describe('Hebrew text — logical order preservation', () => {
  it('title in logical order, not reversed', async () => {
    const out = await html({ invoice: { kind: 'invoice_receipt' } })
    expect(out).toContain('חשבונית מס/קבלה')
    expect(out).not.toContain('הלבק/סמ תינובשח')
  })

  it('mixed Hebrew + Latin renders both legibly', async () => {
    const out = await html({ invoice: { legalNameSnapshot: 'John Levi / יוחנן לוי' } })
    // Both scripts present, in the order we provided.
    expect(out).toContain('John Levi / יוחנן לוי')
  })

  it('numbers embedded in Hebrew survive as their numeric digits', async () => {
    const out = await html({ invoice: { legalNameSnapshot: 'לקוח 123 מספר 456' } })
    expect(out).toContain('לקוח 123 מספר 456')
  })

  it('emoji passes through (rendering verified manually with Chromium)', async () => {
    // The HTML emits raw codepoints; whether the embedded NotoSansHebrew
    // font has emoji glyphs is a render-time concern (it doesn't — Chromium
    // falls back to system emoji). Test that the codepoints survive the
    // render-to-string step at minimum.
    const out = await html({ invoice: { customerFooter: 'תודה! 🙏 שלום ✓' } })
    expect(out).toContain('🙏')
    expect(out).toContain('✓')
  })

  it('Hebrew with newlines preserves whitespace via pre-line', async () => {
    const out = await html({ invoice: { customerFooter: 'שורה ראשונה\nשורה שנייה' } })
    // pre-line in the footer styling; the newline survives in the HTML.
    expect(out).toContain('שורה ראשונה\nשורה שנייה')
  })
})

describe('Edge / abuse inputs', () => {
  it('handles a very long legal name without crashing', async () => {
    const longName = 'א'.repeat(500)
    const out = await html({ invoice: { legalNameSnapshot: longName } })
    expect(out).toContain(longName)
  })

  it('handles a very long line title', async () => {
    const longTitle = 'ב'.repeat(1000)
    const lines: BillInvoiceLineRow[] = [{ ...oneLine[0], title: longTitle }]
    const out = await html({ lines })
    expect(out).toContain(longTitle)
  })

  it('handles 200 line items', async () => {
    const lines = Array.from({ length: 200 }, (_, i) => ({
      ...oneLine[0],
      id: i + 1,
      lineNumber: i + 1,
      title: `פריט ${i + 1}`,
    }))
    const out = await html({ lines })
    // Last line is present — proves the loop completed.
    expect(out).toContain('פריט 200')
  })

  it('handles zero lines (degenerate but should not throw)', async () => {
    const out = await html({ lines: [] })
    // No <tr> per line, but the table headers should still render.
    expect(out).toContain('תיאור')
    expect(out).toContain('סה')
  })

  it('handles whitespace-only fields without rendering bogus rows', async () => {
    const out = await html({
      invoice: {
        legalNameSnapshot: '   ',
        addressSnapshot: '',
        emailSnapshot: '',
        phoneSnapshot: '',
        taxIdSnapshot: '   ',
      },
    })
    // Recipient label still rendered ("לכבוד") but no empty metadata
    // pollution.
    expect(out).toContain('לכבוד')
    // No "ע.מ / ח.פ" label since taxId is whitespace-only.
    expect(out).not.toContain('ע.מ / ח.פ')
  })

  it('WEAKNESS: renderInvoiceHtml is permissive about drafts — no leaked number, but renders legal title', async () => {
    // The structural gate against rendering drafts lives one layer up in
    // renderInvoicePdf.ts (it throws billing.pdf.draft_not_renderable).
    // renderInvoiceHtml itself doesn't check docState — if a caller
    // bypassed the gate, we'd produce an invoice-shaped HTML page with
    // no document number. Documented as a defense-in-depth gap:
    // renderInvoiceHtml could also assert docState === 'issued' to make
    // misuse impossible. For now, verify the worst case (leaked number)
    // is at least avoided.
    const out = await html({ invoice: { docState: 'draft', documentNumber: null } })
    expect(out).not.toContain('#000')
    // The legal title is kind-based, not state-based — still renders.
    expect(out).toContain('חשבונית מס')
  })
})

describe('Receipt-block gating regression', () => {
  it('does NOT render receipt block when kind = invoice', async () => {
    const out = await html({
      invoice: {
        kind: 'invoice',
        paymentReceived: true,
        paymentMethodSnapshot: 'cash',
        paymentAmountSnapshot: 118,
        paymentDateSnapshot: '2026-05-18',
      },
    })
    expect(out).not.toContain('קבלה — תשלום שהתקבל')
  })

  it('does NOT render receipt block when paymentReceived is false (edge: missing snapshot)', async () => {
    const out = await html({
      invoice: {
        kind: 'invoice_receipt',
        paymentReceived: false,
        paymentMethodSnapshot: '',
      },
    })
    expect(out).not.toContain('קבלה — תשלום שהתקבל')
  })

  it('renders when fully snapshotted', async () => {
    const out = await html({
      invoice: {
        kind: 'invoice_receipt',
        paymentReceived: true,
        paymentMethodSnapshot: 'bank_transfer',
        paymentAmountSnapshot: 118,
        paymentDateSnapshot: '2026-05-18',
      },
    })
    expect(out).toContain('קבלה — תשלום שהתקבל')
  })
})
