import { NextResponse, connection } from 'next/server'
import { isMcpEnabled } from '@/lib/flags/mcpFlags'
import { validateAuthorizeRequest } from '@/lib/oauth/server/authorizeRequest'
import { buildAuthorizationRedirect } from '@/lib/oauth/server/authorizeResponse'
import { signPendingRequest, PENDING_COOKIE, pendingCookieOptions } from '@/lib/oauth/server/pendingRequest'
import { OAUTH_CONSENT_PATH } from '@/lib/oauth/server/postLoginDestination'
import { oauthErrorPage } from '@/lib/oauth/server/errorPage'

const NO_STORE = { 'cache-control': 'no-store' }

/**
 * OAuth 2.1 authorization endpoint.
 *
 * MCP off → 404 and nothing else. Errors found before client_id and
 * redirect_uri are validated are rendered locally — never redirected. A valid
 * request becomes the signed pending cookie and a redirect to the FIXED
 * internal consent path; the consent step trusts only that cookie.
 */
export async function GET(req: Request): Promise<Response> {
  // Request-time only: under cacheComponents a handler that exits before reading
  // the request could be prerendered at build and freeze the MCP kill switch.
  await connection()
  if (!isMcpEnabled()) return new NextResponse(null, { status: 404, headers: NO_STORE })

  try {
    const v = await validateAuthorizeRequest(new URL(req.url).searchParams)
    if (v.kind === 'local_error') return oauthErrorPage(400)
    if (v.kind === 'redirect_error') {
      const location = buildAuthorizationRedirect(v.redirectUri, {
        error: v.error,
        error_description: v.description,
        state: v.state,
      })
      return new NextResponse(null, { status: 302, headers: { location, ...NO_STORE } })
    }

    const { token } = await signPendingRequest(v.request)
    const res = new NextResponse(null, { status: 302, headers: { location: OAUTH_CONSENT_PATH, ...NO_STORE } })
    res.cookies.set(PENDING_COOKIE, token, pendingCookieOptions())
    return res
  } catch (e) {
    console.error('[oauth/authorize] failed', { reason: (e as Error)?.message })
    return oauthErrorPage(500)
  }
}
