import { NextRequest, NextResponse } from 'next/server'
import { markDocumentFailed, appendDocumentDiagStep } from '@/db/billing/documents'

/**
 * Gotenberg posts here when an async render fails. The Gotenberg webhook
 * contract requires Error-Url alongside Webhook-Url; without this route,
 * Gotenberg refuses to accept the dispatch and returns 400.
 *
 * Auth: shared token (RENDER_DIAG_SECRET) embedded in the URL query
 * string. We don't trust the body - the only state change is marking
 * the document failed, and the documentId / agencyId in the query must
 * match an existing rendering row.
 *
 * Gotenberg sends a JSON body like:
 *   { "message": "...", "status": 500 }
 * We capture it into the diag trail for observability.
 */
export async function POST(request: NextRequest) {
  const expected = process.env.RENDER_DIAG_SECRET?.trim()
  const provided = request.nextUrl.searchParams.get('token')
  if (!expected || !provided || provided !== expected) {
    return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 401 })
  }

  const documentId = Number(request.nextUrl.searchParams.get('documentId'))
  const agencyId = Number(request.nextUrl.searchParams.get('agencyId'))
  if (!Number.isFinite(documentId) || !Number.isFinite(agencyId)) {
    return NextResponse.json({ ok: false, reason: 'bad_params' }, { status: 400 })
  }

  let body: string
  try {
    body = await request.text()
  } catch {
    body = ''
  }

  console.error('[billing.pdf] gotenberg.error_callback', JSON.stringify({ documentId, agencyId, bodyExcerpt: body.slice(0, 400) }))

  try {
    await appendDocumentDiagStep(documentId, agencyId, 'gotenberg.error_callback', { bodyExcerpt: body.slice(0, 400) })
  } catch {}

  try {
    await markDocumentFailed(documentId, agencyId, 'gotenberg_render_failed')
  } catch (err) {
    console.error('[billing.pdf] gotenberg.error_callback.mark_failed_error', JSON.stringify({ documentId, error: err instanceof Error ? err.message : String(err) }))
    return NextResponse.json({ ok: false, reason: 'mark_failed_error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
