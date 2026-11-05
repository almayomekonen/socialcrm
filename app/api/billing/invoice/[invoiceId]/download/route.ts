import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/config/db'
import { AuthError, ProductAccessError, requireProductAccess, type AuthenticatedAgencyUser } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { isAdmin } from '@/types/roles'
import { invoicePdfFilename } from '@/lib/billing/pdf/filename'
import { contentDisposition } from '@/lib/storage/disposition'
import { logStorageEvent } from '@/lib/storage/events'
import { headObject, presignDownload, StorageNotFoundError } from '@/lib/storage/objects'

/**
 * The authenticated way to download an invoice's current PDF: session, agency and
 * lead checks, then a 60-second redirect to R2 with a meaningful filename. Short,
 * because the URL is only used for the redirect hop and would otherwise linger in
 * browser history.
 */
const refused = (reason: string, status: number) =>
  NextResponse.json({ ok: false, reason }, { status, headers: { 'Cache-Control': 'private, no-store' } })

export async function GET(_req: NextRequest, { params }: { params: Promise<{ invoiceId: string }> }) {
  let user: AuthenticatedAgencyUser
  try {
    user = await requireProductAccess()
  } catch (err) {
    if (err instanceof AuthError) return refused('unauthorized', 401)
    if (err instanceof ProductAccessError) return refused(err.reason, 403)
    throw err
  }

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
      logStorageEvent('download.denied', { agencyId: user.agencyId, userId: user.id, invoiceId, reason: 'no_access' })
      return NextResponse.json({ ok: false, reason: 'no_access' }, { status: 403 })
    }
  }

  const doc = await db('bill_documents')
    .where({ agencyId: user.agencyId, invoiceId, isCurrent: true, status: 'ready' })
    .first('path')
  if (!doc?.path) {
    return NextResponse.json({ ok: false, reason: 'pdf_not_ready' }, { status: 404 })
  }

  try {
    await headObject(doc.path)
    const url = await presignDownload({
      key: doc.path,
      contentType: 'application/pdf',
      contentDisposition: contentDisposition(invoicePdfFilename(invoice)),
    })
    logStorageEvent('download.authorized', { agencyId: user.agencyId, userId: user.id, invoiceId, mime: 'application/pdf' })
    return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } })
  } catch (err) {
    if (err instanceof StorageNotFoundError) {
      logStorageEvent('download.missing_object', { agencyId: user.agencyId, invoiceId })
      return NextResponse.json({ ok: false, reason: 'pdf_not_ready' }, { status: 404 })
    }
    return NextResponse.json({ ok: false, reason: 'storage_unavailable' }, { status: 503 })
  }
}
