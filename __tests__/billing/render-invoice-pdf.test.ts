import { describe, it, expect } from 'vitest'
import { renderInvoicePdf } from '@/lib/billing/pdf/renderInvoicePdf'
import { renderInvoiceHtml } from '@/lib/billing/pdf/html/InvoiceTemplate'
import { shouldDrawReceiptBlock } from '@/lib/billing/pdf/drawReceiptBlock'
import type { BillInvoiceRow, BillInvoiceLineRow } from '@/db/billing/invoices'

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
    issuedAt: '2026-05-14T10:00:00.000Z',
    issuedByUserId: 1,
    dueAt: null,
    createdAt: '2026-05-14T10:00:00.000Z',
    updatedAt: '2026-05-14T10:00:00.000Z',
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
    lastEventAt: '2026-05-14T10:00:00.000Z',
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
    title: 'שירות ייעוץ',
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
    createdAt: '2026-05-14T10:00:00.000Z',
    updatedAt: '2026-05-14T10:00:00.000Z',
  },
]

describe('shouldDrawReceiptBlock', () => {
  it('skips plain invoices', () => {
    expect(shouldDrawReceiptBlock(makeInvoice({ kind: 'invoice' }))).toBe(false)
  })

  it('skips combined docs that have no payment recorded', () => {
    expect(
      shouldDrawReceiptBlock(makeInvoice({ kind: 'invoice_receipt', paymentReceived: false, paymentMethodSnapshot: '' })),
    ).toBe(false)
  })

  it('skips combined docs missing the method snapshot', () => {
    expect(
      shouldDrawReceiptBlock(makeInvoice({ kind: 'invoice_receipt', paymentReceived: true, paymentMethodSnapshot: '' })),
    ).toBe(false)
  })

  it('draws when combined doc has a complete payment snapshot', () => {
    expect(
      shouldDrawReceiptBlock(
        makeInvoice({
          kind: 'invoice_receipt',
          paymentReceived: true,
          paymentMethodSnapshot: 'cash',
          paymentAmountSnapshot: 118,
          paymentDateSnapshot: '2026-05-14',
        }),
      ),
    ).toBe(true)
  })
})

describe('renderInvoiceHtml (pure)', () => {
  it('emits a complete HTML document with RTL direction', async () => {
    const html = await renderInvoiceHtml({
      invoice: makeInvoice(),
      lines: oneLine,
      issuer: null,
      fallbackName: 'העסק שלי',
      agencyLogoPng: null,
    })
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('dir="rtl"')
    expect(html).toContain('lang="he"')
  })

  it('stores Hebrew text in LOGICAL order (the migration goal)', async () => {
    const html = await renderInvoiceHtml({
      invoice: makeInvoice({ kind: 'invoice_receipt' }),
      lines: oneLine,
      issuer: null,
      fallbackName: 'העסק שלי',
      agencyLogoPng: null,
    })
    // Title: real "חשבונית מס/קבלה", not the legacy reversed-glyph form.
    expect(html).toContain('חשבונית מס/קבלה')
    expect(html).not.toContain('הלבק/סמ תינובשח')
    expect(html).toContain('לכבוד')
    expect(html).toContain('שירות ייעוץ')
    expect(html).toContain('לקוח לדוגמה')
  })

  it('renders the customer-facing footer when invoice.customerFooter is set', async () => {
    const html = await renderInvoiceHtml({
      invoice: makeInvoice({ customerFooter: 'תודה על השירות!' }),
      lines: oneLine,
      issuer: null,
      fallbackName: 'העסק שלי',
      agencyLogoPng: null,
    })
    expect(html).toContain('הערה ללקוח')
    expect(html).toContain('תודה על השירות!')
  })

  it('plain invoice uses the plain legal title', async () => {
    const html = await renderInvoiceHtml({
      invoice: makeInvoice({ kind: 'invoice' }),
      lines: oneLine,
      issuer: null,
      fallbackName: 'העסק שלי',
      agencyLogoPng: null,
    })
    expect(html).toContain('חשבונית מס')
    expect(html).not.toContain('חשבונית מס/קבלה')
  })

  it('includes the receipt block only for paid combined documents', async () => {
    const withoutReceipt = await renderInvoiceHtml({
      invoice: makeInvoice({ kind: 'invoice' }),
      lines: oneLine,
      issuer: null,
      fallbackName: 'העסק שלי',
      agencyLogoPng: null,
    })
    const withReceipt = await renderInvoiceHtml({
      invoice: makeInvoice({
        kind: 'invoice_receipt',
        paymentReceived: true,
        paymentMethodSnapshot: 'cash',
        paymentAmountSnapshot: 118,
        paymentDateSnapshot: '2026-05-14',
      }),
      lines: oneLine,
      issuer: null,
      fallbackName: 'העסק שלי',
      agencyLogoPng: null,
    })
    expect(withoutReceipt).not.toContain('קבלה — תשלום שהתקבל')
    expect(withReceipt).toContain('קבלה — תשלום שהתקבל')
  })

  it('renders the short document number ("#NNNNN"), not the legacy long form', async () => {
    const html = await renderInvoiceHtml({
      invoice: makeInvoice({ documentNumber: 42 }),
      lines: oneLine,
      issuer: null,
      fallbackName: 'העסק שלי',
      agencyLogoPng: null,
    })
    expect(html).toContain('#00042')
    expect(html).not.toContain('INV-2026-00042')
  })
})

describe('renderInvoicePdf', () => {
  it('rejects drafts without contacting a renderer', async () => {
    await expect(
      renderInvoicePdf({
        invoice: makeInvoice({ docState: 'draft', fulfillState: null }),
        lines: oneLine,
      }),
    ).rejects.toThrow('billing.pdf.draft_not_renderable')
  })
})
