import { after } from 'next/server'
import { closeStaleRenders, createPendingDocument, getPendingDocumentForInvoice, hasReadyDocument, markDocumentFailed } from '@/db/billing/documents'
import { invoicePdfKey } from '@/lib/storage/keys'
import { renderAndStoreInvoicePdf } from './renderAndStore'
import { isRenderStale, RENDER_STALE_MS } from './renderStatus'

export type ScheduleInvoicePdfRenderInput = {
  invoiceId: number
  agencyId: number
  force?: boolean
  renderedByUserId?: number | null
}

/**
 * Starts a render without making the caller wait, and never throws into the action
 * that issued the invoice.
 *
 * IDEMPOTENT: a render already in flight is left alone, even by `force`, so a double
 * click cannot start a second one. A ready document is left alone unless `force`, the
 * explicit "render again". Retrying after a failure is always safe: it appends a new row
 * under a new key, and the failed row stays as history.
 *
 * `bill_documents.url` holds the authenticated download route, never a storage URL.
 */
export async function scheduleInvoicePdfRender(input: ScheduleInvoicePdfRenderInput): Promise<void> {
  const { invoiceId, agencyId } = input
  try {
    if (!input.force && (await hasReadyDocument(agencyId, invoiceId))) return
    const pending = await getPendingDocumentForInvoice(agencyId, invoiceId)
    if (pending && !isRenderStale(pending.createdAt, Date.now())) return
    await closeStaleRenders(agencyId, invoiceId, new Date(Date.now() - RENDER_STALE_MS))

    const objectPath = invoicePdfKey(agencyId, invoiceId)
    const url = invoiceDownloadPath(invoiceId)
    const documentId = await createPendingDocument({
      agencyId,
      invoiceId,
      renderedByUserId: input.renderedByUserId ?? null,
      path: objectPath,
      url,
    })

    const job = () =>
      renderAndStoreInvoicePdf({ documentId, invoiceId, agencyId, objectPath, url }).catch(async (err) => {
        console.error('[billing.pdf] job.fatal', JSON.stringify({ invoiceId, name: (err as Error)?.name ?? null }))
        await markDocumentFailed(documentId, agencyId, 'render_error').catch(() => undefined)
      })

    try {
      after(job)
    } catch {
      // Outside a request scope (a script or a test).
      void Promise.resolve().then(job)
    }
  } catch (err) {
    console.error('[billing.pdf] schedule.fail', JSON.stringify({ invoiceId, name: (err as Error)?.name ?? null }))
  }
}

export function invoiceDownloadPath(invoiceId: number): string {
  return `/api/billing/invoice/${invoiceId}/download`
}

export async function rerenderInvoicePdf(input: {
  invoiceId: number
  agencyId: number
  renderedByUserId?: number | null
}): Promise<void> {
  return scheduleInvoicePdfRender({ ...input, force: true })
}
