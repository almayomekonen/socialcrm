import { describe, expect, it } from 'vitest'
import { renderInvoiceHtml } from '@/lib/billing/pdf/html/InvoiceTemplate'
import type { BillInvoiceLineRow, BillInvoiceRow } from '@/db/billing/invoices'

/**
 * Page layout rules. Chromium decides the final pages, so what is pinned here is what
 * makes them right: margins on every page, and a footer that cannot end up alone.
 */
const invoice = { id: 1, agencyId: 1, leadId: 1, docState: 'issued', kind: 'invoice', documentNumber: 1, documentYear: 2026, issuedAt: '2026-11-05T10:00:00.000Z', currency: 'ILS', subtotalAmount: 100, taxAmount: 18, totalAmount: 118, issuerNameSnapshot: 'העסק', customerFooter: 'הערה' } as unknown as BillInvoiceRow
const lines = [{ id: 1, lineNumber: 1, title: 'שירות', description: '', quantity: 1, unitPrice: 100, discount: 0, taxRatePercentSnapshot: 18, lineSubtotal: 100, lineTaxAmount: 18, lineTotal: 118 }] as unknown as BillInvoiceLineRow[]
const render = () => renderInvoiceHtml({ invoice, lines, issuer: null, fallbackName: 'העסק', agencyLogoPng: null })

describe('invoice page layout', () => {
  it('sets top and bottom margins on @page, so continued pages get them too', async () => {
    const html = await render()
    expect(html).toContain('@page { size: 210mm 297mm; margin: 16mm 0; }')
    expect(html).toMatch(/<main[^>]*padding:0 16mm/)
  })

  it('keeps the totals and the footer in one unbreakable block', async () => {
    const html = await render()
    const block = html.indexOf('break-inside:avoid', html.indexOf('</table>'))
    expect(block).toBeGreaterThan(-1)
    expect(html.indexOf('<footer', block)).toBeGreaterThan(block)
  })

  it('does not split a table row across pages', async () => {
    expect(await render()).toMatch(/<tr style="break-inside:avoid/)
  })
})
