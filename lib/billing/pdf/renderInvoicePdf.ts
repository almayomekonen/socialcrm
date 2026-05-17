import type { BillInvoiceRow, BillInvoiceLineRow } from '@/db/billing/invoices'
import type { IssuerData } from '@/lib/billing/issuer/fields'
import { renderInvoiceHtml } from './html/InvoiceTemplate'
import { htmlToPdfBytes } from './html/renderHtmlToPdf'

// Public renderer. Internals migrated from pdf-lib's character-reversal
// approach to HTML → headless Chromium → PDF — see lib/billing/pdf/html/*.
//
// Public signature is unchanged on purpose. Callers (scheduleInvoicePdfRender,
// rerenderInvoicePdf, tests) keep working without touching their code. The
// HTML pipeline produces a PDF with a real logical Hebrew text layer:
// search, copy/paste, and accessibility all work — none of which were
// possible with the previous reversed-glyph approach.

export type RenderInvoicePdfInput = {
  invoice: BillInvoiceRow
  lines: BillInvoiceLineRow[]
  issuer?: IssuerData | null
  /**
   * Legacy fallback for the legal name. Always pass `agencies.name` here
   * so older invoices (where `issuer.name` is null) still render a sender
   * identity in the header. Never null in practice.
   */
  fallbackName?: string
  agencyLogoPng?: Uint8Array
}

export type RenderInvoicePdfResult = {
  bytes: Uint8Array
  contentHash: string
  byteSize: number
}

export async function renderInvoicePdf(input: RenderInvoicePdfInput): Promise<RenderInvoicePdfResult> {
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

  return htmlToPdfBytes(html)
}
