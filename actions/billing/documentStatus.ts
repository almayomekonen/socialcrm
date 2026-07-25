'use server'

import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { s3 } from '@/config/s3'
import { db } from '@/config/db'
import { requireProductAccess } from '@/lib/requireUser'
import { markDocumentReady, markDocumentFailed, appendDocumentDiagStep } from '@/db/billing/documents'

export type InvoicePdfStatusValue = 'rendering' | 'ready' | 'failed' | 'none'

export type InvoicePdfStatusSnapshot = {
  status: InvoicePdfStatusValue
  url: string | null
  errorReason: string | null
}

const HEAD_OBJECT_TIMEOUT_MS = 5 * 60 * 1000

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
 * Read-only probe used by the client poller while a fresh PDF is being
 * rendered.
 *
 * Returns the current row's view if the doc is already terminal
 * (ready/failed). Otherwise, since Gotenberg uploads the PDF directly
 * to S3 outside of Vercel's request path, we have no inline callback
 * to mark the doc ready. Instead we head_object the predicted S3 key:
 *   - if the object exists: flip the row to 'ready' here and return ready
 *   - if it doesn't and the row is older than HEAD_OBJECT_TIMEOUT_MS:
 *     flip the row to 'failed' (timeout)
 *   - otherwise: return 'rendering' and let the client poll again
 */
export async function getInvoicePdfStatusAction(invoiceId: number): Promise<InvoicePdfStatusSnapshot> {
  const user = await requireProductAccess()
  const doc = await loadLatestDoc(user.agencyId, invoiceId)
  if (!doc) return { status: 'none', url: null, errorReason: null }

  if (doc.status === 'ready' || doc.status === 'failed') {
    return shape(doc)
  }

  // status is 'rendering'. Check S3 for the predicted object.
  if (!doc.path) return shape(doc)

  const bucket = process.env.S3_BUCKET_NAME
  if (!bucket) return shape(doc)

  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: doc.path }))
    // Object landed - flip to ready idempotently. ETag is the MD5 of the
    // body for non-multipart PUTs - perfectly suitable as our contentHash.
    const etag = (head.ETag ?? '').replace(/^"|"$/g, '')
    const byteSize = Number(head.ContentLength ?? 0)
    try {
      await markDocumentReady({
        documentId: doc.id,
        agencyId: doc.agencyId,
        invoiceId: doc.invoiceId,
        path: doc.path,
        url: doc.url ?? '',
        contentHash: etag,
        byteSize,
      })
      void appendDocumentDiagStep(doc.id, doc.agencyId, 'polling.detected_ready', { byteSize, etag })
    } catch (err) {
      // Race: another poll may have already flipped the row. Treat as ready.
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('mark_ready_failed')) throw err
    }
    return { status: 'ready', url: doc.url, errorReason: null }
  } catch (err) {
    const name = (err as { name?: string })?.name
    if (name === 'NotFound' || name === 'NoSuchKey' || name === '404') {
      // Not landed yet. Check render timeout.
      const ageMs = Date.now() - new Date(doc.createdAt).getTime()
      if (ageMs > HEAD_OBJECT_TIMEOUT_MS) {
        try {
          await markDocumentFailed(doc.id, doc.agencyId, 'render_timeout')
          void appendDocumentDiagStep(doc.id, doc.agencyId, 'polling.timeout', { ageMs })
        } catch {}
        return { status: 'failed', url: null, errorReason: 'render_timeout' }
      }
      return shape(doc)
    }
    // Any other error (transient S3, network) - keep showing rendering;
    // next poll will retry. Don't swallow silently - log it.
    console.warn('[billing.pdf-status] head_object error', { invoiceId, name, message: (err as { message?: string })?.message })
    return shape(doc)
  }
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
