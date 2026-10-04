import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/db/auth'
import { isMcpEnabled } from '@/lib/flags/mcpFlags'
import { publicOrigin } from '@/lib/oauth/server/config'
import { PENDING_COOKIE, clearedPendingCookieOptions } from '@/lib/oauth/server/pendingRequest'
import { decideConsent } from '@/lib/oauth/server/consentDecision'
import { oauthErrorPage } from '@/lib/oauth/server/errorPage'
import { errorClass } from '@/lib/oauth/server/logSafe'

/**
 * The consent form's POST target.
 *
 * CSRF defence in depth: (1) the Origin header must be exactly our public
 * origin; (2) the submitted csrf value must equal the one inside the signed,
 * httpOnly pending cookie (unreadable cross-site); (3) both the session and
 * pending cookies are SameSite=Lax, so a cross-site POST carries neither.
 */
export async function POST(req: NextRequest): Promise<Response> {
  if (!isMcpEnabled()) return new NextResponse(null, { status: 404, headers: { 'cache-control': 'no-store' } })

  try {
    if (req.headers.get('origin') !== publicOrigin()) return oauthErrorPage(403)

    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return oauthErrorPage(400)
    }

    const user = await getUser()
    const outcome = await decideConsent({
      sessionUserId: user ? Number(user.id) : null,
      pendingRaw: req.cookies.get(PENDING_COOKIE)?.value,
      csrf: form.get('csrf'),
      decision: form.get('decision'),
    })

    const res =
      outcome.kind === 'redirect'
        ? new NextResponse(null, { status: 303, headers: { location: outcome.location, 'cache-control': 'no-store' } })
        : new NextResponse(oauthErrorPage(outcome.status, outcome.message).body, {
            status: outcome.status,
            headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
          })
    if (outcome.clearPending) res.cookies.set(PENDING_COOKIE, '', clearedPendingCookieOptions())
    return res
  } catch (e) {
    console.error('[oauth/consent] failed', errorClass(e))
    return oauthErrorPage(500)
  }
}
