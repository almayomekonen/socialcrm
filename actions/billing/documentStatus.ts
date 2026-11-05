'use server'

import { db } from '@/config/db'
import { requireProductAccess } from '@/lib/requireUser'
import { markDocumentReady, markDocumentFailed, appendDocumentDiagStep } from '@/db/billing/documents'
import { isRenderStale } from '@/lib/billing/pdf/renderStatus'
import { StorageConfigError } from '@/lib/storage/config'
import { logStorageEvent } from '@/lib/storage/events'
import { headObject, StorageNotFoundError } from '@/lib/storage/objects'

export type InvoicePdfStatusValue = 'rendering' | 'ready' | 'failed' | 'none'

export type InvoicePdfStatusSnapshot = {
  status: InvoicePdfStatusValue
  url: string | null
  errorReason: string | null
}

type DocRow = {
  id: number
  invoiceId: number
  agencyId: number
  status: 'rendering' | 'ready' | 'failed'
  url: string | null
  path: string | null
  errorReason: string | null
  createdAt: string | Date
}

/**
 * What the client poller asks while a PDF is being produced.
 *
 * A terminal row answers as it is. A `rendering` row usually just means the render
 * is still running, and two things can close it here:
 *   - the object is already stored (the process died after uploading): mark it ready;
 *   - the row is stale, for ANY reason (a dead process, storage down, missing
 *     configuration): mark it failed. Only a row that can still finish stays
 *     `rendering`, so the UI always reaches its retry button.
 */
export async function getInvoicePdfStatusAction(invoiceId: number): Promise<InvoicePdfStatusSnapshot> {
  const user = await requireProductAccess()
  const doc = await loadLatestDoc(user.agencyId, invoiceId)
  if (!doc) return { status: 'none', url: null, errorReason: null }
  if (doc.status === 'ready' || doc.status === 'failed') return shape(doc)

  let closeReason = 'render_timeout'
  try {
    // A row with no path has no object to find, and goes straight to the staleness check.
    if (!doc.path) throw new StorageNotFoundError()
    const head = await headObject(doc.path)
    const contentHash = head.metadata.sha256 ?? head.etag ?? ''
    try {
      await markDocumentReady({
        documentId: doc.id,
        agencyId: doc.agencyId,
        invoiceId: doc.invoiceId,
        path: doc.path,
        url: doc.url ?? '',
        contentHash,
        byteSize: head.size,
      })
      void appendDocumentDiagStep(doc.id, doc.agencyId, 'polling.detected_ready', { byteSize: head.size })
    } catch (err) {
      // Another poll already flipped the row.
      if (!(err instanceof Error) || !err.message.includes('mark_ready_failed')) throw err
    }
    return { status: 'ready', url: doc.url, errorReason: null }
  } catch (err) {
    if (err instanceof StorageConfigError) closeReason = 'storage_config_missing'
    else if (!(err instanceof StorageNotFoundError)) closeReason = 'storage_unavailable'
  }

  if (!isRenderStale(doc.createdAt, Date.now())) return shape(doc)

  await markDocumentFailed(doc.id, doc.agencyId, closeReason)
  logStorageEvent('pdf.stale_render_closed', { agencyId: doc.agencyId, invoiceId, documentId: doc.id, reason: closeReason })
  return { status: 'failed', url: null, errorReason: closeReason }
}

async function loadLatestDoc(agencyId: number, invoiceId: number): Promise<DocRow | null> {
  const current = await db('bill_documents')
    .where({ agencyId, invoiceId, isCurrent: true })
    .first('id', 'invoiceId', 'agencyId', 'status', 'url', 'path', 'errorReason', 'createdAt')
  if (current) return current as DocRow

  const latest = await db('bill_documents')
    .where({ agencyId, invoiceId })
    .orderBy('createdAt', 'desc')
    .first('id', 'invoiceId', 'agencyId', 'status', 'url', 'path', 'errorReason', 'createdAt')
  return (latest as DocRow | undefined) ?? null
}

function shape(row: DocRow): InvoicePdfStatusSnapshot {
  return {
    status: row.status,
    url: row.url,
    errorReason: row.errorReason,
  }
}
