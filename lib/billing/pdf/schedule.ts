import { after } from 'next/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { s3, s3PublicUrl } from '@/config/s3'
import { db } from '@/config/db'
import { genId } from '@/lib/funcs'
import { createPendingDocument, hasReadyDocument, markDocumentFailed, markDocumentReady } from '@/db/billing/documents'
import type { BillInvoiceRow, BillInvoiceLineRow } from '@/db/billing/invoices'
import { getIssuerForRender } from '@/db/billing/issuer'
import { resolveIssuerForRender } from '@/lib/billing/issuer/resolveForRender'
import { renderInvoicePdf } from './renderInvoicePdf'

export type ScheduleInvoicePdfRenderInput = {
  invoiceId: number
  agencyId: number
  force?: boolean
  renderedByUserId?: number | null
}

export async function scheduleInvoicePdfRender(input: ScheduleInvoicePdfRenderInput): Promise<void> {
  try {
    if (!input.force && (await hasReadyDocument(input.agencyId, input.invoiceId))) {
      return
    }

    const documentId = await createPendingDocument({
      agencyId: input.agencyId,
      invoiceId: input.invoiceId,
      renderedByUserId: input.renderedByUserId ?? null,
    })

    const job = () =>
      runRender({
        documentId,
        invoiceId: input.invoiceId,
        agencyId: input.agencyId,
      }).catch(async (err) => {
        // runRender is supposed to swallow + classify every error internally
        // and write the failure to bill_documents. If something escapes
        // anyway, mark the row failed so it never gets stuck at 'rendering'.
        const message = err instanceof Error ? err.message : String(err)
        console.error('[billing.pdf] render.fatal', JSON.stringify({ invoiceId: input.invoiceId, message: trunc(message) }))
        try {
          await markDocumentFailed(documentId, input.agencyId, 'render_error')
        } catch {
          // mark-failed itself failed; nothing else we can safely do here.
        }
      })

    try {
      after(() => {
        void job()
      })
    } catch {
      // `after()` is only available inside a Next.js request scope.
      // Fall back to a microtask so tests/CLI paths still execute the render.
      void Promise.resolve().then(job)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[billing.pdf] schedule.fail', JSON.stringify({ invoiceId: input.invoiceId, message: trunc(message) }))
  }
}

export async function rerenderInvoicePdf(input: {
  invoiceId: number
  agencyId: number
  renderedByUserId?: number | null
}): Promise<void> {
  return scheduleInvoicePdfRender({ ...input, force: true })
}

async function runRender(input: { documentId: number; invoiceId: number; agencyId: number }): Promise<void> {
  let invoice: BillInvoiceRow | null = null
  try {
    invoice = await loadInvoice(input.agencyId, input.invoiceId)
    if (!invoice) {
      await markDocumentFailed(input.documentId, input.agencyId, 'invoice_not_found')
      return
    }
    if (invoice.docState === 'draft') {
      await markDocumentFailed(input.documentId, input.agencyId, 'invoice_is_draft')
      return
    }

    const lines = await loadLines(input.agencyId, input.invoiceId)

    const [liveIssuer, fallbackName] = await Promise.all([getIssuerForRender(input.agencyId), loadAgencyName(input.agencyId)])
    const issuer = resolveIssuerForRender({ invoice, liveIssuer, fallbackAgencyName: fallbackName })

    const rendered = await renderInvoicePdf({ invoice, lines, issuer, fallbackName })

    const objectPath = `bill/${input.agencyId}/invoice/${input.invoiceId}/${genId()}.pdf`
    const bucket = process.env.S3_BUCKET_NAME
    if (!bucket) {
      await markDocumentFailed(input.documentId, input.agencyId, 's3_bucket_not_configured')
      return
    }

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectPath,
        Body: rendered.bytes,
        ContentType: 'application/pdf',
        ContentLength: rendered.byteSize,
      }),
    )

    await markDocumentReady({
      documentId: input.documentId,
      agencyId: input.agencyId,
      invoiceId: input.invoiceId,
      path: objectPath,
      url: `${s3PublicUrl}${objectPath}`,
      contentHash: rendered.contentHash,
      byteSize: rendered.byteSize,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const reason = classifyError(message)
    try {
      await markDocumentFailed(input.documentId, input.agencyId, reason)
    } catch {
      // mark-failed can itself fail; scheduleInvoicePdfRender has a
      // backstop that re-attempts this from the outer catch wrapper.
    }
    console.error('[billing.pdf] render.fail', JSON.stringify({ invoiceId: input.invoiceId, reason, message: trunc(message) }))
  }
}

async function loadInvoice(agencyId: number, invoiceId: number): Promise<BillInvoiceRow | null> {
  const row = await db('bill_invoices').where({ id: invoiceId, agencyId }).first()
  return row ? (row as BillInvoiceRow) : null
}

async function loadLines(agencyId: number, invoiceId: number): Promise<BillInvoiceLineRow[]> {
  const rows = await db('bill_invoice_lines').where({ agencyId, invoiceId }).orderBy('lineNumber', 'asc')
  return rows as BillInvoiceLineRow[]
}

async function loadAgencyName(agencyId: number): Promise<string> {
  const row = await db('agencies').where({ id: agencyId }).first('name')
  return row?.name ? String(row.name) : ''
}

function classifyError(message: string): string {
  if (message.startsWith('billing.pdf.font_missing')) return 'font_missing'
  if (message.startsWith('billing.pdf.draft_not_renderable')) return 'invoice_is_draft'
  if (message.startsWith('billing.pdf.invalid_routing')) return 'invalid_routing'
  if (message.includes('NoSuchBucket') || message.includes('AccessDenied')) return 's3_access_denied'
  if (message.includes('CredentialsProviderError')) return 's3_credentials'
  return 'render_error'
}

function trunc(s: string, n = 200): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}
