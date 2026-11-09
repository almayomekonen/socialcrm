import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/config/db'
import { AuthError, ProductAccessError, requireProductAccess, type AuthenticatedAgencyUser } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { isAdmin } from '@/types/roles'
import { findCurrentQuoteDocumentByHandle } from '@/db/quotes/documents'
import { quotePdfFilename } from '@/lib/quotes/pdf/format'
import { contentDisposition } from '@/lib/storage/disposition'
import { logStorageEvent } from '@/lib/storage/events'
import { headObject, presignDownload, StorageNotFoundError } from '@/lib/storage/objects'

/**
 * The owner's way to download a quote's current PDF: session, agency and lead
 * checks, then a 60-second redirect to the private R2 bucket. Same rules as the
 * invoice download route.
 *
 * The `[quoteId]` segment carries an opaque HANDLE (the PDF's SHA-256), not the
 * numeric id, so a link in a WhatsApp chat exposes no CRM identifier. It is not
 * a capability: without a session and access to the lead it opens nothing.
 *
 * A signed-out owner tapping the WhatsApp link is sent to the login page rather
 * than a JSON error. Login has no return path (auth is out of scope here), so
 * the WhatsApp message tells them to tap the link again afterwards.
 *
 * Another agency's handle, an unknown handle and a malformed one are the same
 * 404, so the route cannot be used to learn what exists.
 */

const HANDLE = /^[0-9a-f]{64}$/
const NO_STORE = { 'Cache-Control': 'private, no-store' }
const refused = (reason: string, status: number) => NextResponse.json({ ok: false, reason }, { status, headers: NO_STORE })

export async function GET(req: NextRequest, { params }: { params: Promise<{ quoteId: string }> }) {
  let user: AuthenticatedAgencyUser
  try {
    user = await requireProductAccess()
  } catch (err) {
    if (err instanceof AuthError) return err.reason === 'no_session' ? NextResponse.redirect(new URL('/auth', req.url), { status: 302, headers: NO_STORE }) : refused('unauthorized', 401)
    if (err instanceof ProductAccessError) return refused(err.reason, 403)
    throw err
  }

  const { quoteId: handle } = await params
  if (!HANDLE.test(handle)) return refused('not_found', 404)
  const doc = await findCurrentQuoteDocumentByHandle(user.agencyId, handle)
  if (!doc) return refused('not_found', 404)

  const quote = (await db('sales_quotes').where({ id: doc.quoteId, agencyId: user.agencyId }).first('leadId', 'quoteNumber', 'recipientNameSnapshot')) as
    | { leadId: number; quoteNumber: number | string | null; recipientNameSnapshot: string | null }
    | undefined
  if (!quote) return refused('not_found', 404)

  if (!isAdmin(user.role)) {
    const { gotPermIds } = await getPerms(user)
    const visible = await db('clients').where({ id: quote.leadId, agencyId: user.agencyId }).whereIn('userId', gotPermIds).first('id')
    if (!visible) {
      logStorageEvent('download.denied', { agencyId: user.agencyId, userId: user.id, reason: 'no_access' })
      return refused('not_found', 404)
    }
  }

  try {
    await headObject(doc.path)
    const url = await presignDownload({ key: doc.path, contentType: 'application/pdf', contentDisposition: contentDisposition(quotePdfFilename(quote)) })
    logStorageEvent('download.authorized', { agencyId: user.agencyId, userId: user.id, mime: 'application/pdf' })
    return NextResponse.redirect(url, { status: 302, headers: { ...NO_STORE, 'Referrer-Policy': 'no-referrer' } })
  } catch (err) {
    if (err instanceof StorageNotFoundError) {
      logStorageEvent('download.missing_object', { agencyId: user.agencyId })
      return refused('not_found', 404)
    }
    return refused('storage_unavailable', 503)
  }
}
