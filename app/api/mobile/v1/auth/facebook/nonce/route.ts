import { NextResponse } from 'next/server'
import { issueLoginNonce } from '@/db/mobileAuthNonces'
import { isFacebookUserAuthEnabled } from '@/lib/auth/facebookUserAuthFlags'
import { clientIp, fail, ok } from '@/lib/mobile/http'
import { isRateLimited, recordAttempts } from '@/lib/mobile/rateLimit'

/**
 * POST /api/mobile/v1/auth/facebook/nonce — mints a login nonce for iOS
 * Facebook Limited Login.
 *
 * ⚠️ WHY THIS ENDPOINT EXISTS. Meta serves Limited Login on iOS, which returns an
 * OIDC token instead of a Graph access token, and mints it with a 90-day
 * lifetime. The token carries a `nonce` claim echoing a value supplied at login.
 * Unless the SERVER chooses that value, it cannot bind the token to a request it
 * issued, and any captured token is replayable for three months. This endpoint is
 * the challenge half of that; `consumeLoginNonce` is the response half.
 *
 * ⚠️ TAKES NO INPUT AND RETURNS NO IDENTITY. There is no user yet — this runs
 * before the Facebook dialog opens. It therefore reveals nothing: an unauthorised
 * caller learns only that they can obtain a random string, which is worthless
 * without a Facebook token minted against it for OUR app id.
 *
 * ⚠️ FLAG-GATED like its sibling. An unflagged deployment answers 404 rather than
 * admitting the route exists, matching `/auth/facebook` exactly — otherwise this
 * endpoint would disclose that the Facebook rollout is coming.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!isFacebookUserAuthEnabled()) {
    return new NextResponse(null, { status: 404 })
  }

  /**
   * The request has no parameters. An absent or empty body is accepted because
   * clients differ on whether a bodyless POST sends `{}` or nothing at all, but
   * ANY key is rejected: a future reader must not be able to smuggle in a
   * caller-chosen nonce, which would hand the attacker the very value this
   * endpoint exists to control.
   */
  let parsed: unknown = null
  try {
    parsed = await req.json()
  } catch {
    parsed = null
  }
  if (parsed !== null && parsed !== undefined) {
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fail('invalid_request', 400)
    }
    if (Object.keys(parsed as Record<string, unknown>).length > 0) {
      return fail('invalid_request', 400)
    }
  }

  const ip = clientIp(req)

  try {
    /**
     * Keyed by IP alone — there is no subject before identity exists.
     *
     * Answers 429 `rate_limited`, unlike `/auth/facebook` which answers 401. The
     * sibling routes collapse throttling into their credential-failure status so
     * the status cannot be used as an account-existence oracle. Nothing is being
     * verified here and no subject is involved, so there is no oracle to protect
     * and the honest status is the correct one.
     */
    if (await isRateLimited('facebook_nonce', null, ip)) {
      return fail('rate_limited', 429)
    }
    await recordAttempts('facebook_nonce', null, ip)

    // Only the digest is persisted; the raw value exists solely in this response.
    const { nonce } = await issueLoginNonce(ip)

    return ok({ nonce })
  } catch (err) {
    console.error('[mobile/auth/facebook/nonce] failed', { reason: (err as Error)?.message })
    return fail('server_error', 500)
  }
}
