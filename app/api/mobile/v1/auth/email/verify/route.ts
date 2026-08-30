import { NextResponse } from 'next/server'
import { db } from '@/config/db'
import { getUserByEmail, revokeUserSessions } from '@/db/auth'
import { verifyEmailCode } from '@/db/mobileAuthCodes'
import { normalizeEmail } from '@/lib/normalizeEmail'
import {
  issueRefreshToken,
  revokeAllRefreshTokens,
  signMobileAccessToken,
} from '@/lib/mobile/tokens'
import { clientIp, fail, ok } from '@/lib/mobile/http'
import { isRateLimited, recordAttempts } from '@/lib/mobile/rateLimit'

/**
 * POST /api/mobile/v1/auth/email/verify — exchange a code for a MOBILE session.
 *
 * ⚠️ THE WEB'S `/api/magic` IS DELIBERATELY NOT REUSED. That route is a GET that
 * sets a cookie and 302s to `/dashboard`. Pointing a phone at it would mint a
 * Safari session the app cannot read AND consume the single-use token, leaving
 * the client with nothing. This endpoint issues the mobile pair instead.
 *
 * ⚠️ EVERY FAILURE IS ONE 401. Unknown address, wrong code, expired code,
 * exhausted attempts — the client is told only "unauthenticated". Separating
 * them would reveal whether an address has an account and whether a guess was
 * close, which is exactly what a brute-force needs to steer.
 *
 * ⚠️ TWO INDEPENDENT CEILINGS. `verifyEmailCode` bounds guesses against ONE code
 * (locked row, so concurrency cannot buy extra attempts); the throttle bounds
 * verify calls per address and per IP, so requesting fresh codes cannot be used
 * to refill the guess budget.
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

  // Strict allow-list — no `userId`, no `agencyId`, nothing but the two fields.
  if (Object.keys(body).filter((k) => k !== 'email' && k !== 'code').length > 0) {
    return fail('invalid_request', 400)
  }

  const rawEmail = body.email
  const rawCode = body.code
  if (typeof rawEmail !== 'string' || rawEmail.length === 0 || rawEmail.length > 320) {
    return fail('invalid_request', 400)
  }
  if (typeof rawCode !== 'string' || !/^\d{6}$/.test(rawCode)) {
    return fail('invalid_request', 400)
  }

  const email = normalizeEmail(rawEmail)
  const ip = clientIp(req)

  try {
    if (await isRateLimited('email_verify', email, ip)) {
      return fail('unauthorized', 401)
    }
    await recordAttempts('email_verify', email, ip)

    const check = await verifyEmailCode(email, rawCode)
    if (check.ok === false) {
      // Logged for operators; the CLIENT is told only "unauthenticated".
      console.warn('[mobile/auth/email/verify] rejected', { reason: check.reason })
      return fail('unauthorized', 401)
    }

    /**
     * THE CODE PROVED CONTROL OF THE MAILBOX — it did not prove the account is
     * usable. Suspension and tenancy are database facts, re-read here, exactly as
     * `/auth/google` does.
     */
    const user = await getUserByEmail(email)
    if (!user) return fail('unauthorized', 401)
    if (user.suspended) return fail('suspended', 403)
    if (typeof user.agencyId !== 'number') return fail('no_agency', 403)

    const userId = Number(user.id)

    /**
     * FIRST PROOF OF OWNERSHIP — the same rule the web magic link applies in
     * `/api/magic`, and that `/auth/google` applies. Registration can create an
     * account for an address nobody has proved they own; the moment the real
     * owner authenticates, sessions issued before that proof must die.
     *
     * `revokeUserSessions` bumps `sessionVersion` (killing web cookies and mobile
     * access tokens); refresh families live in a separate table and are revoked
     * explicitly. Both run BEFORE minting, so the new pair survives.
     */
    if (!user.emailVerifiedAt) {
      await revokeUserSessions(userId)
      await revokeAllRefreshTokens(userId, 'user_revoked')
      console.warn('[mobile/auth/email/verify] first email verification — prior sessions revoked', {
        userId,
      })
    }

    await db('users')
      .where({ id: userId })
      .update({ emailVerifiedAt: user.emailVerifiedAt ?? new Date() })

    const issued = await issueRefreshToken(userId, {
      userAgent: req.headers.get('user-agent'),
      ip,
      deviceId: req.headers.get('x-device-id'),
      deviceName: req.headers.get('x-device-name'),
      platform: req.headers.get('x-platform'),
    })

    console.log('[mobile/auth/email/verify] session issued', { userId })

    // The two credentials and nothing else — no agencyId, no idNum, no email.
    return ok({
      accessToken: await signMobileAccessToken(userId),
      refreshToken: issued.token,
    })
  } catch (err) {
    console.error('[mobile/auth/email/verify] failed', { reason: (err as Error)?.message })
    return fail('server_error', 500)
  }
}
