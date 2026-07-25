import { NextRequest, NextResponse } from 'next/server'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { s3 } from '@/config/s3'
import { db } from '@/config/db'
import { requireProductAccess } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { isAdmin } from '@/types/roles'

// Short-lived: the presigned URL is only used during the 302 hop the
// browser performs in response to this route. Long expiries would
// only leak signed URLs into browser history for no benefit.
const PRESIGN_EXPIRES_S = 60

/**
 * Authenticated download URL for an invoice's current PDF. Looks up the
 * current ready bill_documents row, generates a presigned GET URL with
 * ResponseContentDisposition so S3 returns a meaningful filename
 * (Invoice-00042-David_Cohen.pdf) instead of the random storage key,
 * then 302s the browser to S3.
 *
 * The S3 storage key itself is unchanged - this only overrides how S3
 * presents the file to the client for this specific GET.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ invoiceId: string }> }) {
  const user = await requireProductAccess()
  const { invoiceId: rawInvoiceId } = await params
  const invoiceId = Number(rawInvoiceId)
  if (!Number.isFinite(invoiceId)) {
    return NextResponse.json({ ok: false, reason: 'invalid_invoice_id' }, { status: 400 })
  }

  const invoice = await db('bill_invoices')
    .where({ id: invoiceId, agencyId: user.agencyId })
    .first('id', 'leadId', 'kind', 'documentNumber', 'legalNameSnapshot')
  if (!invoice) {
    return NextResponse.json({ ok: false, reason: 'invoice_not_found' }, { status: 404 })
  }

  if (!isAdmin(user.role)) {
    const { gotPermIds } = await getPerms(user)
    const leadCheck = await db('clients')
      .where({ id: invoice.leadId, agencyId: user.agencyId })
      .whereIn('userId', gotPermIds)
      .first('id')
    if (!leadCheck) {
      return NextResponse.json({ ok: false, reason: 'no_access' }, { status: 403 })
    }
  }

  const doc = await db('bill_documents')
    .where({ agencyId: user.agencyId, invoiceId, isCurrent: true, status: 'ready' })
    .first('path')
  if (!doc?.path) {
    return NextResponse.json({ ok: false, reason: 'pdf_not_ready' }, { status: 404 })
  }

  const bucket = process.env.S3_BUCKET_NAME
  if (!bucket) {
    return NextResponse.json({ ok: false, reason: 's3_not_configured' }, { status: 500 })
  }

  const filename = buildFilename(invoice)
  const ascii = asciiFallback(filename)
  // RFC 5987 encoding: both filename= (ASCII fallback) and filename*= (UTF-8)
  // so Hebrew names render correctly in modern browsers, while older clients
  // still get a readable name.
  const disposition = `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`

  const presigned = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: doc.path,
      ResponseContentDisposition: disposition,
      ResponseContentType: 'application/pdf',
    }),
    { expiresIn: PRESIGN_EXPIRES_S },
  )

  return NextResponse.redirect(presigned, 302)
}

function buildFilename(invoice: { kind: string | null; documentNumber: number | null; legalNameSnapshot: string | null }): string {
  const prefix = invoice.kind === 'invoice_receipt' ? 'Receipt' : 'Invoice'
  const num = invoice.documentNumber != null ? String(invoice.documentNumber).padStart(5, '0') : 'pending'
  const name = sanitizeName(invoice.legalNameSnapshot ?? '')
  return `${prefix}-${num}-${name}.pdf`
}

function sanitizeName(s: string): string {
  return (
    s
      .trim()
      .replace(/\s+/g, '_')
      // Strip filesystem-hostile chars; keep Hebrew/Unicode letters.
      .replace(/[\\/:*?"<>|]/g, '')
      .slice(0, 80) || 'Customer'
  )
}

function asciiFallback(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, '_')
}
