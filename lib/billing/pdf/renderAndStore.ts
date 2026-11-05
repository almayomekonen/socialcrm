import 'server-only'
import { createHash } from 'node:crypto'
import { db } from '@/config/db'
import { markDocumentFailed, markDocumentReady } from '@/db/billing/documents'
import type { BillInvoiceLineRow, BillInvoiceRow } from '@/db/billing/invoices'
import { getIssuerForRender } from '@/db/billing/issuer'
import { resolveIssuerForRender } from '@/lib/billing/issuer/resolveForRender'
import { PdfRenderError } from '@/lib/pdf/renderer'
import { StorageConfigError } from '@/lib/storage/config'
import { logStorageEvent } from '@/lib/storage/events'
import { putObject, StorageUnavailableError } from '@/lib/storage/objects'
import { diagDb, type DiagCtx } from './diag'
import { renderInvoicePdf } from './renderInvoicePdf'

/**
 * One document, from pending to terminal: load → render → upload → mark ready.
 *
 * EVERY exit is terminal. Anything that goes wrong marks the row `failed` with a
 * named reason, which is what the UI's retry button reads. If the process itself
 * dies here, the status poller closes the row (documentStatus.ts).
 *
 * `contentHash` is the SHA-256 of the bytes this process rendered and uploaded,
 * which is what the bill_documents schema says the column holds.
 */

export type RenderAndStoreInput = {
  documentId: number
  invoiceId: number
  agencyId: number
  objectPath: string
  url: string
}

export function failureReason(err: unknown): string {
  if (err instanceof PdfRenderError) return `pdf_${err.failure}`
  if (err instanceof StorageConfigError) return 'storage_config_missing'
  if (err instanceof StorageUnavailableError) return 'storage_unavailable'
  const message = err instanceof Error ? err.message : ''
  if (message.startsWith('billing.pdf.font_missing')) return 'font_missing'
  if (message.startsWith('billing.pdf.draft_not_renderable')) return 'invoice_is_draft'
  return 'render_error'
}

export async function renderAndStoreInvoicePdf(input: RenderAndStoreInput): Promise<void> {
  const { documentId, invoiceId, agencyId } = input
  const ctx: DiagCtx = { documentId, agencyId }
  try {
    const invoice = (await db('bill_invoices').where({ id: invoiceId, agencyId }).first()) as BillInvoiceRow | undefined
    if (!invoice) return await markDocumentFailed(documentId, agencyId, 'invoice_not_found')
    if (invoice.docState === 'draft') return await markDocumentFailed(documentId, agencyId, 'invoice_is_draft')

    const lines = (await db('bill_invoice_lines').where({ agencyId, invoiceId }).orderBy('lineNumber', 'asc')) as BillInvoiceLineRow[]
    const [liveIssuer, agency] = await Promise.all([getIssuerForRender(agencyId), db('agencies').where({ id: agencyId }).first('name')])
    const fallbackName = agency?.name ? String(agency.name) : ''
    const issuer = resolveIssuerForRender({ invoice, liveIssuer, fallbackAgencyName: fallbackName })

    const bytes = await renderInvoicePdf({ invoice, lines, issuer, fallbackName })
    await diagDb(ctx, 'render.done', { byteSize: bytes.byteLength })

    const contentHash = createHash('sha256').update(bytes).digest('hex')
    const startedAt = Date.now()
    try {
      await putObject({ key: input.objectPath, body: bytes, contentType: 'application/pdf', metadata: { sha256: contentHash } })
    } catch (err) {
      logStorageEvent('pdf.upload.failed', { agencyId, invoiceId, documentId, code: (err as Error).name })
      throw err
    }
    logStorageEvent('pdf.upload.completed', { agencyId, invoiceId, documentId, size: bytes.byteLength, latencyMs: Date.now() - startedAt })

    await markDocumentReady({ documentId, agencyId, invoiceId, path: input.objectPath, url: input.url, contentHash, byteSize: bytes.byteLength })
    await diagDb(ctx, 'ready')
  } catch (err) {
    const reason = failureReason(err)
    await diagDb(ctx, 'failed', { reason })
    await markDocumentFailed(documentId, agencyId, reason)
  }
}
