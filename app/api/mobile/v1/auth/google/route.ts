import { NextResponse } from 'next/server'
import { db } from '@/config/db'
import { getUserByEmail, revokeUserSessions } from '@/db/auth'
import { normalizeEmail } from '@/lib/normalizeEmail'
import { verifyMobileGoogleIdToken } from '@/lib/mobile/google'
import {
  issueRefreshToken,
  revokeAllRefreshTokens,
  signMobileAccessToken,
} from '@/lib/mobile/tokens'
import { clientIp, fail, ok } from '@/lib/mobile/http'
import { isRateLimited, recordAttempts } from '@/lib/mobile/rateLimit'

/**
 * POST /api/mobile/v1/auth/google — the PRODUCTION mobile sign-in.
 *
 * IDENTITY COMES ONLY FROM THE VERIFIED TOKEN. The body carries exactly one
 * field — the Google ID token — and every identity fact (`email`, `sub`, `name`,
 * `picture`) is read out of it AFTER `verifyMobileGoogleIdToken` has checked the
 * signature against Google's JWKS, the issuer, the configured audience, and
 * `email_verified`. Nothing the client asserts about who it is participates.
 * Unknown body keys are rejected outright so a future `email` or `userId` field
 * cannot be smuggled in and quietly honoured by a later edit.
 *
 * NEVER CREATES A USER. Registration is a web flow that assigns an agency, seeds
 * settings and starts a trial; a partial version of it here would produce a
 * half-provisioned tenant. A verified Google account with no SocialCRM user is
 * simply not signed in.
 *
 * UNAUTHENTICATED AND NOT PRODUCT-GATED, deliberately. This is where a session
 * begins, so there is no bearer token yet; and a rep whose trial has lapsed must
 * still be able to sign in and be told WHY they are blocked — the same reason
 * `/me` uses `requireMobileUser` rather than `requireMobileProductAccess`.
 *
 * MIRRORS `checkUser` (the web Google path) on purpose, including the
 * first-verification revocation below. Where the two surfaces agree about an
 * account, they must agree for the same reasons.
 */

/**
 * Why some failures are distinguishable and one is not.
 *
 * `unauthorized` covers BOTH "the token did not verify" and "no SocialCRM user
 * has that email". Splitting them would turn this endpoint into an account
 * existence oracle for any email an attacker can mint a Google token for.
 *
 * `suspended` and `no_agency` ARE distinguished, and that is not a leak: to
 * reach them the caller has already proved, cryptographically, that they control
 * that Google account. Telling the legitimate owner of a suspended account why
 * they cannot get in is the point — it is the same taxonomy `requireMobileUser`
 * returns, so the client's existing classifier handles it with no new branch.
 */
export async function POST(req: Request): Promise<NextResponse> {
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

  // Strict allow-list. The only accepted key is the credential itself.
  const unexpected = Object.keys(body).filter((key) => key !== 'idToken')
  if (unexpected.length > 0) return fail('invalid_request', 400)

  const { idToken } = body
  if (typeof idToken !== 'string' || idToken.length === 0) {
    return fail('invalid_request', 400)
  }

  const ip = clientIp(req)

  try {
    /**
     * ⚠️ THROTTLED BEFORE VERIFICATION, and keyed by IP ALONE. There is no
     * subject yet — the email only exists after the token verifies — and keying
     * on the token itself would put credential material in the throttle table.
     *
     * Returns 401 rather than 429 so the client's existing failure taxonomy is
     * unchanged: this endpoint has only ever answered 401 for "you are not
     * getting a session", and a new status here would be a contract change.
     * Verification behaviour below is untouched.
     */
    if (await isRateLimited('google', null, ip)) return fail('unauthorized', 401)
    await recordAttempts('google', null, ip)

    /**
     * THE ONLY SOURCE OF IDENTITY.
     *
     * Returns null for a bad signature, a wrong issuer, an audience that is not
     * one of ours, an unverified email, or no configured audience at all — every
     * one of which is "not authenticated" and nothing more specific.
     */
    const verified = await verifyMobileGoogleIdToken(idToken)
    if (!verified) return fail('unauthorized', 401)

    const email = normalizeEmail(verified.email)
    if (email.length === 0) return fail('unauthorized', 401)

    const existing = await getUserByEmail(email)

    // No account, or an account with no tenant. Indistinguishable from a bad
    // token by design — see the note above.
    if (!existing) return fail('unauthorized', 401)

    if (existing.suspended) return fail('suspended', 403)
    if (typeof existing.agencyId !== 'number') return fail('no_agency', 403)

    const userId = Number(existing.id)

    /**
     * FIRST PROOF OF OWNERSHIP — copied from the web path, and load-bearing.
     *
     * Registration can create an account for an address nobody has proved they
     * own. The moment the real owner authenticates with Google, any session
     * issued before that proof must die.
     *
     * `revokeUserSessions` bumps `sessionVersion`, which invalidates web cookies
     * AND mobile access tokens. It does NOT touch `mobile_refresh_tokens` —
     * that is a separate table — so the refresh families are revoked explicitly.
     * Missing that second call would leave a pre-ownership device able to keep
     * minting fresh access tokens indefinitely.
     *
     * Both happen BEFORE the new pair is minted, so the credentials issued below
     * carry the new session version and survive.
     */
    if (!existing.emailVerifiedAt) {
      await revokeUserSessions(userId)
      await revokeAllRefreshTokens(userId, 'user_revoked')
      console.warn('[mobile/auth/google] first email verification — prior sessions revoked', {
        userId,
      })
    }

    /**
     * Same profile write as `checkUser`, so the two sign-in surfaces cannot
     * disagree about a user's photo or name. `picture` is re-validated as an
     * absolute https URL at the `/me` boundary before it ever reaches a device.
     */
    await db('users')
      .where({ id: userId })
      .update({
        gglName: verified.name ?? null,
        picture: verified.picture ?? null,
        gglSub: verified.sub,
        emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
      })

    /**
     * A NEW FAMILY. This is a new sign-in on a device, not a continuation, so it
     * gets its own lineage — which is what lets logout end this device alone and
     * lets reuse detection trace a replay back to exactly one sign-in.
     *
     * Device labelling comes from headers, never the body: it is metadata for a
     * human reading the session list, and must not sit next to identity input.
     */
    const issued = await issueRefreshToken(userId, {
      userAgent: req.headers.get('user-agent'),
      ip,
      deviceId: req.headers.get('x-device-id'),
      deviceName: req.headers.get('x-device-name'),
      platform: req.headers.get('x-platform'),
    })

    console.log('[mobile/auth/google] session issued', { userId })

    /**
     * THE TWO CREDENTIALS AND NOTHING ELSE.
     *
     * No agencyId, no idNum, no sessionVersion, no token hash, no Google claim
     * beyond what the client already had. The app bootstraps its identity from
     * `/me`, which is the single place that projection is defined.
     */
    return ok({
      accessToken: await signMobileAccessToken(userId),
      refreshToken: issued.token,
    })
  } catch (err) {
    console.error('[mobile/auth/google] failed', { reason: (err as Error)?.message })
    return fail('server_error', 500)
  }
}
