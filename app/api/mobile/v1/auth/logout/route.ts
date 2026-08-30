import { NextResponse } from 'next/server'
import { consumeRefreshToken, revokeRefreshFamily } from '@/lib/mobile/tokens'
import { clientIp, noContent } from '@/lib/mobile/http'
import { isRateLimited, recordAttempts } from '@/lib/mobile/rateLimit'

/**
 * POST /api/mobile/v1/auth/logout — end THIS device's session.
 *
 * Revokes the presented credential's whole family, which is one sign-in on one
 * device. Other devices are untouched, and the user's web cookie is untouched —
 * that separation is the entire reason `mobile_refresh_tokens` exists rather than
 * reusing `sessionVersion`, which can only sign out everything at once.
 *
 * ALWAYS 204, even for a token that is unknown, already expired, or already
 * revoked. Sign-out must be idempotent and must never fail: a client that cannot
 * complete logout would be stuck holding a credential it has already discarded
 * locally, and reporting "that token doesn't exist" would leak which credentials
 * are live. The access token is not revoked server-side — it is short-lived by
 * design and the client drops it immediately.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let refreshToken: unknown
  try {
    refreshToken = ((await req.json()) as { refreshToken?: unknown })?.refreshToken
  } catch {
    // A malformed body still means "I am signing out".
    return noContent()
  }

  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    return noContent()
  }

  const ip = clientIp(req)

  try {
    /**
     * ⚠️ STILL 204 WHEN LIMITED. Logout must remain idempotent and must never
     * fail for the user — a client that cannot complete sign-out would be stuck
     * holding a credential it has already discarded locally. So the ceiling drops
     * the WORK, not the response.
     */
    if (await isRateLimited('logout', null, ip)) return noContent()
    await recordAttempts('logout', null, ip)

    /**
     * `consumeRefreshToken` both validates and marks the credential used, so a
     * token surrendered at logout cannot be replayed in the gap before the family
     * revocation lands.
     */
    const outcome = await consumeRefreshToken(refreshToken)
    if (outcome.ok) await revokeRefreshFamily(outcome.familyId, 'logout')
  } catch (err) {
    // Logged, never surfaced. The user is signed out on the device regardless.
    console.error('[mobile/auth/logout] revoke failed', { reason: (err as Error)?.message })
  }

  return noContent()
}
