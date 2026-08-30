import { NextResponse } from 'next/server'
import { db } from '@/config/db'
import { getUserByEmail, getUserByFacebookSub, revokeUserSessions } from '@/db/auth'
import { normalizeEmail } from '@/lib/normalizeEmail'
import { verifyFacebookAccessToken } from '@/lib/auth/verifyFacebookAccessToken'
import { verifyFacebookLimitedLoginToken } from '@/lib/auth/verifyFacebookLimitedLogin'
import { resolveFacebookLogin } from '@/lib/auth/resolveFacebookLogin'
import { canUseFacebookUserAuth, isFacebookUserAuthEnabled } from '@/lib/auth/facebookUserAuthFlags'
import {
  issueRefreshToken,
  revokeAllRefreshTokens,
  signMobileAccessToken,
} from '@/lib/mobile/tokens'
import { clientIp, fail, ok } from '@/lib/mobile/http'
import { isRateLimited, recordAttempts } from '@/lib/mobile/rateLimit'

/**
 * POST /api/mobile/v1/auth/facebook — the production mobile Facebook sign-in.
 *
 * ⚠️ REUSES THE WEB'S VERIFICATION WHOLESALE. `verifyFacebookAccessToken` calls
 * Graph `debug_token` (asserting `is_valid`, `app_id === AUTH_FACEBOOK_APP_ID`,
 * `type === 'USER'`) then `/me`. It takes a string and touches no cookies, so it
 * is safe here verbatim. `resolveFacebookLogin` is likewise pure. Re-implementing
 * either would let mobile and web drift on WHO a Facebook identity maps to —
 * the subtlest and most dangerous kind of auth bug.
 *
 * ⚠️ THE `app_id` CHECK IS WHY THERE IS ONE META APP. A token minted for any
 * other app fails verification, so the mobile SDK must use the same
 * `AUTH_FACEBOOK_APP_ID` the web login uses.
 *
 * ⚠️ NEVER REGISTERS. `resolveFacebookLogin` can answer `register`; on web that
 * routes to a prefilled signup form. Here it is a plain 401: creating a tenant as
 * a side effect of a sign-in attempt is exactly the "half-provisioned tenant"
 * failure the registration route exists to prevent.
 *
 * ⚠️ FLAG-GATED, like the web. The rollout flag and per-agency allowlist decide
 * availability; an unflagged deployment returns 404 rather than admitting the
 * route exists.
 */
type FacebookCredential =
  | { kind: 'classic'; accessToken: string }
  | { kind: 'limited'; authenticationToken: string }

const LIMITED_KEYS = ['authenticationToken', 'nonce'] as const

/**
 * Parses EXACTLY ONE credential shape, or nothing.
 *
 * ⚠️ MIXED SHAPES ARE REJECTED OUTRIGHT rather than resolved by precedence. If a
 * body carrying both a classic and a Limited Login credential were accepted by
 * preferring one, an attacker could pair a valid token of the preferred type with
 * a junk value of the other and learn which branch ran from the timing or the
 * error. More importantly, "which credential did we actually verify?" would stop
 * being answerable from the request alone.
 *
 * ⚠️ THE `nonce` FIELD IS VALIDATED BUT NOT TRUSTED. Verification binds to the
 * `nonce` claim INSIDE the signed OIDC token — `verifyFacebookLimitedLoginToken`
 * reads it from the verified payload and consumes it there. A body-supplied nonce
 * could be anything, so it is required for shape correctness and never used to
 * decide anything. Passing it here could only ever widen what is accepted, which
 * is why it stops at this function.
 */
function parseCredential(body: Record<string, unknown>): FacebookCredential | null {
  const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0
  const keys = Object.keys(body)

  const looksClassic = Object.hasOwn(body, 'accessToken')
  const looksLimited = LIMITED_KEYS.some((k) => Object.hasOwn(body, k))

  if (looksClassic && looksLimited) return null

  if (looksClassic) {
    // Exactly one key: no extras, no smuggling.
    if (keys.length !== 1) return null
    return isNonEmptyString(body.accessToken)
      ? { kind: 'classic', accessToken: body.accessToken }
      : null
  }

  if (looksLimited) {
    // BOTH fields, and nothing else. A partial Limited Login shape is a bug in
    // the client, not a request to fall back to something more permissive.
    if (keys.length !== LIMITED_KEYS.length) return null
    if (!LIMITED_KEYS.every((k) => Object.hasOwn(body, k))) return null
    if (!isNonEmptyString(body.authenticationToken)) return null
    if (!isNonEmptyString(body.nonce)) return null
    return { kind: 'limited', authenticationToken: body.authenticationToken }
  }

  return null
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isFacebookUserAuthEnabled()) {
    return new NextResponse(null, { status: 404 })
  }

  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    return fail('invalid_request', 400)
  }

  const body = parsed as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail('invalid_request', 400)
  }

  const credential = parseCredential(body)
  if (!credential) return fail('invalid_request', 400)

  const ip = clientIp(req)

  try {
    if (await isRateLimited('facebook', null, ip)) return fail('unauthorized', 401)
    await recordAttempts('facebook', null, ip)

    /**
     * THE ONLY SOURCE OF IDENTITY.
     *
     * Two credential types, one identity contract: both verifiers return the same
     * `FacebookVerifyResult`, so everything below this line is unchanged and
     * cannot behave differently depending on how the user signed in. That is the
     * point — mobile and web must never disagree about WHO a Facebook identity is.
     */
    const verified =
      credential.kind === 'classic'
        ? await verifyFacebookAccessToken(credential.accessToken)
        : await verifyFacebookLimitedLoginToken(credential.authenticationToken)
    if (verified.ok === false) {
      console.warn('[mobile/auth/facebook] verification failed', { reason: verified.reason })
      return fail('unauthorized', 401)
    }

    const facebookSub = verified.identity.sub
    const email = normalizeEmail(verified.identity.email)
    if (email.length === 0) return fail('unauthorized', 401)

    const [bySub, byEmail] = await Promise.all([
      getUserByFacebookSub(facebookSub),
      getUserByEmail(email),
    ])
    const resolution = resolveFacebookLogin({ facebookSub, bySub, byEmail })

    if (resolution.kind === 'reject') {
      return resolution.reason === 'suspended'
        ? fail('suspended', 403)
        : fail('unauthorized', 401)
    }
    // No account: mobile does not sign up as a side effect.
    if (resolution.kind === 'register') return fail('unauthorized', 401)

    const userId = resolution.userId
    const row = await db('users').where({ id: userId }).first('agencyId', 'emailVerifiedAt')
    if (!row || typeof row.agencyId !== 'number') return fail('no_agency', 403)

    // Product access is agency-scoped and flag-gated, exactly as on web.
    if (!canUseFacebookUserAuth(row.agencyId)) return fail('forbidden', 403)

    // First proof of ownership — same rule as Google and the email code.
    if (resolution.verifyEmail && !row.emailVerifiedAt) {
      await revokeUserSessions(userId)
      await revokeAllRefreshTokens(userId, 'user_revoked')
    }

    await db('users')
      .where({ id: userId })
      .update({
        ...(resolution.attachFacebookSub ? { facebookSub } : {}),
        ...(resolution.verifyEmail ? { emailVerifiedAt: row.emailVerifiedAt ?? new Date() } : {}),
      })

    const issued = await issueRefreshToken(userId, {
      userAgent: req.headers.get('user-agent'),
      ip,
      deviceId: req.headers.get('x-device-id'),
      deviceName: req.headers.get('x-device-name'),
      platform: req.headers.get('x-platform'),
    })

    console.log('[mobile/auth/facebook] session issued', { userId })

    return ok({
      accessToken: await signMobileAccessToken(userId),
      refreshToken: issued.token,
    })
  } catch (err) {
    console.error('[mobile/auth/facebook] failed', { reason: (err as Error)?.message })
    return fail('server_error', 500)
  }
}
