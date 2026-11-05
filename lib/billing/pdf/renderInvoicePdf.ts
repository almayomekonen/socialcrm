import type { BillInvoiceRow, BillInvoiceLineRow } from '@/db/billing/invoices'
import type { IssuerData } from '@/lib/billing/issuer/fields'
import { renderInvoiceHtml } from './html/InvoiceTemplate'
import { renderPdfFromHtml } from '@/lib/pdf/renderer'

// Invoice row -> HTML -> PDF bytes. Which renderer produces the bytes is
// lib/pdf/renderer.ts's business; storing them is renderAndStore.ts's.

export type RenderInvoicePdfInput = {
  invoice: BillInvoiceRow
  lines: BillInvoiceLineRow[]
  issuer?: IssuerData | null
  /**
   * Legacy fallback for the legal name. Always pass `agencies.name` here
   * so older invoices (where `issuer.name` is null) still render a sender
   * identity in the header.
   */
  fallbackName?: string
  agencyLogoPng?: Uint8Array
}

export async function renderInvoicePdf(input: RenderInvoicePdfInput): Promise<Uint8Array> {
  if (input.invoice.docState === 'draft') {
    throw new Error('billing.pdf.draft_not_renderable')
  }

  const html = await renderInvoiceHtml({
    invoice: input.invoice,
    lines: input.lines,
    issuer: input.issuer ?? null,
    fallbackName: input.fallbackName ?? '',
    agencyLogoPng: input.agencyLogoPng ?? null,
  })

  return renderPdfFromHtml(html)
}
