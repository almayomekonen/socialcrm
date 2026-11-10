import { NextRequest, NextResponse } from 'next/server'
import { findPublicQuoteDelivery, recordQuoteLinkOpened } from '@/db/quotes/deliveries'
import { hashQuoteLinkToken, QUOTE_LINK_TOKEN_RE } from '@/lib/quotes/deliveryLink'
import { quotePdfFilename } from '@/lib/quotes/pdf/format'
import { contentDisposition } from '@/lib/storage/disposition'
import { headObject, presignDownload } from '@/lib/storage/objects'

/**
 * The customer's link to their quote: no session, the token is the capability.
 *
 * The PDF comes only from the delivery the token names, never from anything in
 * the request. A malformed, unknown, expired or revoked token, and one for a
 * quote no longer out with the customer, are the same 404, so the route cannot
 * be used to learn what exists. Valid → a 60-second redirect to the private bucket.
 */

const HEADERS = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' }
const gone = () => NextResponse.json({ ok: false }, { status: 404, headers: HEADERS })

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!QUOTE_LINK_TOKEN_RE.test(token)) return gone()

  const delivery = await findPublicQuoteDelivery(hashQuoteLinkToken(token), new Date())
  if (!delivery) return gone()

  try {
    await headObject(delivery.path)
    const url = await presignDownload({ key: delivery.path, contentType: 'application/pdf', contentDisposition: contentDisposition(quotePdfFilename(delivery)) })
    if (req.method === 'GET') await recordQuoteLinkOpened(delivery).catch((err) => console.error('[quotes.link] open.fail', (err as Error)?.name))
    return NextResponse.redirect(url, { status: 302, headers: HEADERS })
  } catch {
    return gone()
  }
}
