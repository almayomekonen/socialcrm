import { after } from 'next/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { s3, s3PublicUrl } from '@/config/s3'
import { db } from '@/config/db'
import { genId } from '@/lib/funcs'
import { createPendingDocument, hasReadyDocument, markDocumentFailed } from '@/db/billing/documents'
import type { BillInvoiceRow, BillInvoiceLineRow } from '@/db/billing/invoices'
import { getIssuerForRender } from '@/db/billing/issuer'
import { resolveIssuerForRender } from '@/lib/billing/issuer/resolveForRender'
import { renderInvoicePdf } from './renderInvoicePdf'
import { diagDb, type DiagCtx } from './diag'

const PRESIGN_EXPIRES_S = 5 * 60

export type ScheduleInvoicePdfRenderInput = {
  invoiceId: number
  agencyId: number
  force?: boolean
  renderedByUserId?: number | null
}

export async function scheduleInvoicePdfRender(input: ScheduleInvoicePdfRenderInput): Promise<void> {
  try {
    console.log('[billing.pdf] schedule.enter', JSON.stringify({ invoiceId: input.invoiceId, force: !!input.force }))

    if (!input.force && (await hasReadyDocument(input.agencyId, input.invoiceId))) {
      console.log('[billing.pdf] schedule.skip_already_ready', JSON.stringify({ invoiceId: input.invoiceId }))
      return
    }

    const bucket = process.env.S3_BUCKET_NAME
    if (!bucket) {
      console.error('[billing.pdf] schedule.no_s3_bucket')
      return
    }

    // Pre-compute the S3 key + URL where the rendered PDF will land.
    // Stored on the bill_documents row at creation so the polling action
    // can head_object the predicted key without waiting for any callback.
    const objectPath = `bill/${input.agencyId}/invoice/${input.invoiceId}/${genId()}.pdf`
    const objectUrl = `${s3PublicUrl}${objectPath}`

    const documentId = await createPendingDocument({
      agencyId: input.agencyId,
      invoiceId: input.invoiceId,
      renderedByUserId: input.renderedByUserId ?? null,
      path: objectPath,
      url: objectUrl,
    })
    const ctx: DiagCtx = { documentId, agencyId: input.agencyId }
    await diagDb(ctx, 'schedule.pending_doc_created', { documentId, key: objectPath })

    const job = () =>
      dispatchRender({
        documentId,
        invoiceId: input.invoiceId,
        agencyId: input.agencyId,
        bucket,
        objectPath,
      }).catch(async (err) => {
        const message = err instanceof Error ? err.message : String(err)
        await diagDb(ctx, 'schedule.job.outer_catch', { error: message.slice(0, 200) })
        console.error('[billing.pdf] dispatch.fatal', JSON.stringify({ invoiceId: input.invoiceId, message: trunc(message) }))
        try {
          await markDocumentFailed(documentId, input.agencyId, 'dispatch_error')
          await diagDb(ctx, 'schedule.job.mark_failed_ok')
        } catch (markErr) {
          await diagDb(ctx, 'schedule.job.mark_failed_error', { error: markErr instanceof Error ? markErr.message : String(markErr) })
        }
      })

    try {
      after(async () => {
        await diagDb(ctx, 'schedule.after.fire')
        void job()
      })
      await diagDb(ctx, 'schedule.after.registered')
    } catch {
      await diagDb(ctx, 'schedule.microtask_fallback')
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

async function dispatchRender(input: { documentId: number; invoiceId: number; agencyId: number; bucket: string; objectPath: string }): Promise<void> {
  const ctx: DiagCtx = { documentId: input.documentId, agencyId: input.agencyId }
  let invoice: BillInvoiceRow | null = null
  try {
    await diagDb(ctx, 'dispatch.enter', { invoiceId: input.invoiceId, documentId: input.documentId })
    invoice = await loadInvoice(input.agencyId, input.invoiceId)
    await diagDb(ctx, 'dispatch.invoice_loaded', { found: !!invoice, docState: invoice?.docState })
    if (!invoice) {
      await markDocumentFailed(input.documentId, input.agencyId, 'invoice_not_found')
      return
    }
    if (invoice.docState === 'draft') {
      await markDocumentFailed(input.documentId, input.agencyId, 'invoice_is_draft')
      return
    }

    const lines = await loadLines(input.agencyId, input.invoiceId)
    await diagDb(ctx, 'dispatch.lines_loaded', { count: lines.length })

    const [liveIssuer, fallbackName] = await Promise.all([getIssuerForRender(input.agencyId), loadAgencyName(input.agencyId)])
    const issuer = resolveIssuerForRender({ invoice, liveIssuer, fallbackAgencyName: fallbackName })
    await diagDb(ctx, 'dispatch.issuer_resolved', { hasIssuer: !!issuer, fallbackName })

    // Generate the presigned PUT URL Gotenberg will upload to. The
    // ContentType MUST match what Gotenberg sends in its webhook PUT
    // (application/pdf) or S3 will reject the signature.
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.objectPath,
        ContentType: 'application/pdf',
      }),
      { expiresIn: PRESIGN_EXPIRES_S },
    )
    await diagDb(ctx, 'dispatch.presigned_url_generated', { expiresIn: PRESIGN_EXPIRES_S })

    // Gotenberg v8 requires an error callback URL paired with the
    // success webhook. Auth via the same shared secret the diag readback
    // route uses.
    const appHost = process.env.APP_HOST?.trim() || 'getsocialcrm.com'
    const callbackToken = process.env.RENDER_DIAG_SECRET?.trim() || ''
    const errorUrl =
      `https://${appHost}/api/billing/render-error` +
      `?documentId=${input.documentId}` +
      `&agencyId=${input.agencyId}` +
      `&token=${encodeURIComponent(callbackToken)}`

    await diagDb(ctx, 'dispatch.gotenberg.before')
    await renderInvoicePdf({ invoice, lines, issuer, fallbackName, uploadUrl, errorUrl, diagCtx: ctx })
    await diagDb(ctx, 'dispatch.gotenberg.after')

    // Completion is now async: Gotenberg renders + uploads to S3 directly.
    // The polling action observes the upload via head_object and flips
    // the row to status='ready'. There is no synchronous markDocumentReady
    // here on purpose.
    await diagDb(ctx, 'dispatch.complete')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const reason = classifyError(message)
    await diagDb(ctx, 'dispatch.error', { reason, message: message.slice(0, 200) })
    try {
      await markDocumentFailed(input.documentId, input.agencyId, reason)
    } catch {}
    console.error('[billing.pdf] dispatch.fail', JSON.stringify({ invoiceId: input.invoiceId, reason, message: trunc(message) }))
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
  if (message.startsWith('billing.pdf.gotenberg_forbidden')) return 'gotenberg_forbidden'
  if (message.startsWith('billing.pdf.gotenberg_timeout')) return 'gotenberg_timeout'
  if (message.startsWith('billing.pdf.gotenberg_')) return 'gotenberg_error'
  return 'dispatch_error'
}

function trunc(s: string, n = 200): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}
