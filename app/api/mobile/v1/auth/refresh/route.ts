import { NextResponse } from 'next/server'
import { db } from '@/config/db'
import {
  consumeRefreshToken,
  issueRefreshToken,
  revokeAllRefreshTokens,
  signMobileAccessToken,
} from '@/lib/mobile/tokens'
import { clientIp, fail, ok } from '@/lib/mobile/http'
import { isRateLimited, recordAttempts } from '@/lib/mobile/rateLimit'

/**
 * POST /api/mobile/v1/auth/refresh — exchange a refresh credential for a new pair.
 *
 * ROTATION IS MANDATORY. The presented credential is consumed and a brand-new one
 * is returned, so a refresh token is valid exactly once. A long-lived reusable
 * refresh token is a permanent session for whoever copies it.
 *
 * UNAUTHENTICATED BY DESIGN — the refresh credential IS the authentication. It
 * must never require a bearer token, because the entire reason to call it is that
 * the bearer token has expired.
 *
 * EVERY FAILURE IS THE SAME 401. Whether the token is unknown, expired, revoked,
 * or a detected replay, the client is told only "unauthenticated" and signs the
 * user out. Distinguishing them in the response would let an attacker probe which
 * stolen credentials are live.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail('invalid_request', 400)
  }

  const refreshToken = (body as { refreshToken?: unknown })?.refreshToken
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    return fail('invalid_request', 400)
  }

  const ip = clientIp(req)

  try {
    /**
     * ⚠️ IP-ONLY, AND GENEROUS. The credential cannot be a throttle subject — that
     * would write token material into the table — and there is no other subject
     * before it is consumed. The ceiling exists to bound resource exhaustion
     * (every call takes a `forUpdate` row lock), not to resist guessing: a 32-byte
     * CSPRNG token is not guessable.
     *
     * A limited caller gets the SAME 401 as every other refresh failure, so
     * rotation and reuse-detection semantics below are entirely unchanged.
     */
    if (await isRateLimited('refresh', null, ip)) return fail('unauthorized', 401)
    await recordAttempts('refresh', null, ip)

    const outcome = await consumeRefreshToken(refreshToken)

    if (outcome.ok === false) {
      /**
       * REUSE IS A BREACH SIGNAL, not a routine failure. `consumeRefreshToken`
       * has already killed the token family; the loud log is what lets a human
       * notice. The response stays identical to every other failure.
       */
      if (outcome.reason === 'reused') {
        console.warn('[mobile/auth/refresh] refresh token reuse detected — family revoked')
      }
      return fail('unauthorized', 401)
    }

    /**
     * RE-VALIDATE THE USER, every time. A refresh credential can outlive the
     * account it belongs to: the user may have been suspended, lost their agency,
     * or been signed out everywhere since the token was issued. A valid row in the
     * token table is not evidence that the person is still allowed in.
     */
    const row = await db('users')
      .where({ id: outcome.userId })
      .first('id', 'suspended', 'agencyId')

    if (!row || row.suspended || typeof row.agencyId !== 'number') {
      await revokeAllRefreshTokens(outcome.userId, 'user_revoked')
      return fail('unauthorized', 401)
    }

    // Same family: this is a continuation of one sign-in, not a new one, which is
    // what keeps reuse detection able to trace the whole lineage.
    const issued = await issueRefreshToken(
      outcome.userId,
      {
        userAgent: req.headers.get('user-agent'),
        ip,
        deviceId: req.headers.get('x-device-id'),
        deviceName: req.headers.get('x-device-name'),
        platform: req.headers.get('x-platform'),
      },
      outcome.familyId,
    )

    return ok({
      accessToken: await signMobileAccessToken(outcome.userId),
      refreshToken: issued.token,
    })
  } catch (err) {
    console.error('[mobile/auth/refresh] failed', { reason: (err as Error)?.message })
    return fail('server_error', 500)
  }
}
