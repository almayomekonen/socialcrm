import { NextRequest, NextResponse } from 'next/server'
import { findPublicQuoteDelivery, recordQuoteLinkOpened } from '@/db/quotes/deliveries'
import { isWaAssistantQuotesSendAgency } from '@/lib/flags/waAssistantFlags'
import { QUOTE_LINK_PAGE_COPY, hashQuoteLinkToken, QUOTE_LINK_TOKEN_RE } from '@/lib/quotes/deliveryLink'
import { quotePdfFilename } from '@/lib/quotes/pdf/format'
import { contentDisposition } from '@/lib/storage/disposition'
import { headObject, presignDownload } from '@/lib/storage/objects'

/**
 * The customer's link to their quote: `/api/q#<token>`.
 *
 * THE TOKEN NEVER REACHES A SERVER LOG. It is in the URL fragment, which a
 * browser does not send, so GET serves a static page and nothing more; that
 * page posts the token in a request BODY, which request logs do not record, and
 * navigates to the 60-second URL it gets back. No Referer carries it either.
 *
 * POST: no session, the token is the capability. The PDF comes only from the
 * delivery the token names. A malformed, unknown, expired or revoked token, one
 * for a quote no longer out with the customer, and any token at all while the
 * agency's send switch is off (the kill switch) are the same 404.
 */

const HEADERS = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' }
const gone = () => NextResponse.json({ ok: false }, { status: 404, headers: HEADERS })

const page = `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow">
<title>${QUOTE_LINK_PAGE_COPY.title}</title></head>
<body style="font-family:system-ui,sans-serif;margin:0;padding:48px 16px;text-align:center;color:#111">
<p id="status" data-failed="${QUOTE_LINK_PAGE_COPY.failed}">${QUOTE_LINK_PAGE_COPY.opening}</p>
<noscript>${QUOTE_LINK_PAGE_COPY.noScript}</noscript>
<script type="module" src="/quote-open.mjs"></script>
</body></html>`

export function GET() {
  return new NextResponse(page, { status: 200, headers: { ...HEADERS, 'Content-Type': 'text/html; charset=utf-8' } })
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null
  const token = typeof body?.token === 'string' ? body.token : ''
  if (!QUOTE_LINK_TOKEN_RE.test(token)) return gone()

  const delivery = await findPublicQuoteDelivery(hashQuoteLinkToken(token), new Date())
  if (!delivery || !isWaAssistantQuotesSendAgency(delivery.agencyId)) return gone()

  try {
    await headObject(delivery.path)
    const url = await presignDownload({ key: delivery.path, contentType: 'application/pdf', contentDisposition: contentDisposition(quotePdfFilename(delivery)) })
    await recordQuoteLinkOpened(delivery).catch((err) => console.error('[quotes.link] open.fail', (err as Error)?.name))
    return NextResponse.json({ ok: true, url }, { status: 200, headers: HEADERS })
  } catch {
    return gone()
  }
}
