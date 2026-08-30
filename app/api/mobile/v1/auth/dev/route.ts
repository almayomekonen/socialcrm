import { NextResponse } from 'next/server'
import { db } from '@/config/db'
import { issueRefreshToken, secretEquals, signMobileAccessToken } from '@/lib/mobile/tokens'
import { clientIp, fail, ok } from '@/lib/mobile/http'
import { isRateLimited, recordAttempts } from '@/lib/mobile/rateLimit'
import { normalizeEmail } from '@/lib/normalizeEmail'

/**
 * POST /api/mobile/v1/auth/dev — LOCAL DEVELOPMENT SIGN-IN. NEVER PRODUCTION.
 *
 * WHY IT EXISTS. Native Google Sign-In needs an iOS OAuth client ID that does not
 * exist yet; the backend knows exactly one audience (`NEXT_PUBLIC_GGLID`, the web
 * client) and would reject an iOS token. Until that client ID is created there is
 * no way for the Simulator to obtain a session — and without a session the only
 * way to see a populated screen would be fabricated CRM data. This endpoint exists
 * so that trade never has to be made: it issues a REAL session for ONE REAL
 * pre-configured user, and every screen downstream shows genuine database rows.
 *
 * IT TAKES NO INPUT. Not an email, not a user id, not a role — nothing from the
 * request influences WHO is authenticated. The account is named once in
 * `MOBILE_DEV_AUTH_EMAIL`, server-side. This is the difference between a
 * development convenience and an impersonation oracle: even holding the secret,
 * a caller cannot pivot to another user, because there is no parameter to pivot
 * with.
 *
 * FOUR INDEPENDENT LOCKS, every one required:
 *   1. `NODE_ENV === 'production'` → 404. Not 403 — in production this route does
 *      not exist and must not admit that it ever did.
 *   2. `MOBILE_DEV_AUTH_SECRET` must be set and non-trivial. No default, no
 *      fallback, so forgetting to configure it fails CLOSED.
 *   3. `MOBILE_DEV_AUTH_EMAIL` must name an existing account.
 *   4. The caller must present the secret, compared in constant time — `===`
 *      would leak length and prefix through timing.
 *
 * WHAT IT DOES NOT DO. It creates no user. It fabricates no lead. It weakens no
 * check: the tokens it mints are the same ones `/auth/google` will mint, bound to
 * the same `sessionVersion`, rotated and revoked by the same machinery, and every
 * later request still goes through `requireMobileUser` — suspension, agency,
 * revocation and product access are all re-verified per request, none of which
 * this endpoint can influence.
 *
 * DELETE THIS FILE once `/auth/google` works end-to-end. It is scaffolding with
 * an expiry date.
 */
type DevAuthConfig = { secret: string; email: string }

function devAuthConfig(): DevAuthConfig | null {
  // Lock 1 — checked first, so production never even reads the variables.
  if (process.env.NODE_ENV === 'production') return null

  // Lock 2 — absent or trivially short means the door does not exist.
  const secret = process.env.MOBILE_DEV_AUTH_SECRET
  if (!secret || secret.length < 16) return null

  // Lock 3 — the single account this endpoint may ever authenticate.
  const email = process.env.MOBILE_DEV_AUTH_EMAIL
  if (!email || email.trim().length === 0) return null

  return { secret, email }
}

export async function POST(req: Request): Promise<NextResponse> {
  const config = devAuthConfig()
  // Indistinguishable from a route that was never deployed.
  if (!config) return new NextResponse(null, { status: 404 })

  // Lock 4.
  const presented = req.headers.get('x-dev-auth-secret') ?? ''
  if (!secretEquals(presented, config.secret)) return new NextResponse(null, { status: 404 })

  const ip = clientIp(req)

  try {
    /**
     * Throttled even though four locks already guard this route: the secret is
     * compared in constant time, but an unbounded loop against it is still free
     * work. Returns the same 404 the other locks return, so a throttled caller
     * cannot distinguish "rate limited" from "route does not exist".
     */
    if (await isRateLimited('dev', null, ip)) return new NextResponse(null, { status: 404 })
    await recordAttempts('dev', null, ip)

    /**
     * The email comes from the SERVER's configuration, never the request body.
     * The account must already exist — no row is ever created here, because the
     * web registration flow is what assigns an agency, seeds settings and starts
     * a trial. A partial version of that would produce a half-provisioned tenant.
     */
    const row = await db('users')
      .whereRaw('lower(email) = ?', [normalizeEmail(config.email)])
      .first('id', 'suspended', 'agencyId')

    if (!row) {
      console.error('[mobile/auth/dev] MOBILE_DEV_AUTH_EMAIL names no existing user')
      return fail('unauthorized', 401)
    }

    // The same conditions `requireMobileUser` enforces on every subsequent
    // request, applied here at issue time so a dead account never gets a token.
    if (row.suspended || typeof row.agencyId !== 'number') {
      return fail('unauthorized', 401)
    }

    const userId = Number(row.id)

    const issued = await issueRefreshToken(userId, {
      userAgent: req.headers.get('user-agent'),
      ip,
      deviceId: req.headers.get('x-device-id'),
      deviceName: req.headers.get('x-device-name'),
      platform: req.headers.get('x-platform'),
    })

    console.warn('[mobile/auth/dev] DEVELOPMENT session issued', { userId })

    /**
     * Only the two credentials. No profile, no agency, and above all no
     * `agencyId` or `idNum` — the client bootstraps identity from `/me`, which is
     * the one place that projection is defined.
     */
    return ok({
      accessToken: await signMobileAccessToken(userId),
      refreshToken: issued.token,
    })
  } catch (err) {
    console.error('[mobile/auth/dev] failed', { reason: (err as Error)?.message })
    return fail('server_error', 500)
  }
}
