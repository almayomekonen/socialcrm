import 'server-only'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { consumeLoginNonce } from '@/db/mobileAuthNonces'
import type { FacebookVerifyResult } from '@/lib/auth/verifyFacebookAccessToken'

/**
 * Facebook LIMITED LOGIN verification for the native iOS client.
 *
 * ⚠️ WHY THIS EXISTS AT ALL. On iOS, Meta serves Limited Login: the SDK returns an
 * OIDC `id_token` instead of a Graph access token, and `AccessToken.current` holds
 * an opaque value that `graph.facebook.com/debug_token` answers with error 190,
 * "Cannot parse access token". `verifyFacebookAccessToken` is therefore not merely
 * inconvenient here — it is structurally incapable of verifying this credential.
 *
 * ⚠️ THE SIGNATURE IS THE ONLY THING THAT ESTABLISHES TRUST. Every identity claim
 * below (`sub`, `email`, `name`, `picture`) is attacker-controlled text until
 * `jwtVerify` has checked it against Facebook's published RSA keys. Nothing is
 * read out of the token before that call returns.
 *
 * ⚠️ THIS RETURNS THE SAME SHAPE AS THE CLASSIC VERIFIER, deliberately. Callers
 * must not be able to tell which credential type was used when deciding WHO the
 * user is — that is how two auth surfaces drift apart on identity. The type is
 * imported rather than redeclared so the two cannot diverge silently.
 *
 * ⚠️ SINGLE USE IS ENFORCED HERE, NOT BY THE CALLER. Meta mints these tokens with
 * a 90-day lifetime, so signature validity alone would leave a captured token
 * replayable for three months. `consumeLoginNonce` is what makes it one-shot.
 */

const FACEBOOK_ISSUER = 'https://www.facebook.com'

/**
 * Key rotation and caching are delegated to `jose`, with the bounds stated
 * EXPLICITLY rather than left to defaults so they are reviewable:
 *
 * - `cacheMaxAge` bounds how long a fetched key set is trusted before refetch.
 * - On an UNKNOWN `kid`, jose refetches the JWKS once and retries the lookup;
 *   `cooldownDuration` is what stops a stream of forged `kid`s from turning that
 *   behaviour into an outbound request amplifier against Facebook.
 * - `timeoutDuration` keeps a hung JWKS fetch from holding a sign-in open.
 *
 * A `kid` is never trusted on its own: it is only ever used to LOOK UP a public
 * key, and a token whose `kid` resolves to nothing fails verification. There is
 * no path where an unresolved `kid` results in a skipped signature check.
 */
const facebookJwks = createRemoteJWKSet(
  new URL('https://www.facebook.com/.well-known/oauth/openid/jwks/'),
  {
    cacheMaxAge: 10 * 60 * 1000,
    cooldownDuration: 30 * 1000,
    timeoutDuration: 5 * 1000,
  },
)

/** Bounded skew for `exp` and `iat`. Devices drift; minutes do not matter here. */
const CLOCK_TOLERANCE_SECONDS = 60

/**
 * Upper bound on token age, deliberately LOOSER than the 5-minute nonce TTL so
 * the nonce remains the binding constraint. A legitimate token is seconds old by
 * the time it arrives; this only stops a token that somehow outlived its nonce
 * from being presented much later.
 */
const MAX_TOKEN_AGE_SECONDS = 10 * 60

export async function verifyFacebookLimitedLoginToken(
  authenticationToken: unknown,
  /** Injectable for tests ONLY. Production always resolves against Facebook. */
  keyResolver: JWTVerifyGetKey = facebookJwks,
): Promise<FacebookVerifyResult> {
  if (typeof authenticationToken !== 'string' || authenticationToken.length === 0) {
    return { ok: false, reason: 'invalid_token' }
  }

  const appId = process.env.AUTH_FACEBOOK_APP_ID
  if (!appId) {
    /**
     * FAIL CLOSED. With no configured audience there is nothing to bind the token
     * to, and "no audience" must never degrade into "any audience" — that is the
     * exact class of bug that let a token minted for a different Meta app reach
     * this system once already.
     */
    console.error('[AUTH] AUTH_FACEBOOK_APP_ID is not set — cannot verify Limited Login token')
    return { ok: false, reason: 'config' }
  }

  let payload: Record<string, unknown>
  try {
    const verified = await jwtVerify(authenticationToken, keyResolver, {
      /**
       * RS256 ONLY. Without an explicit allow-list, a token asserting `alg: none`
       * or a symmetric `alg` would be evaluated under an algorithm the attacker
       * chose — the classic JWT confusion attack. Facebook's discovery document
       * advertises RS256 as its only signing algorithm, so this list is exact.
       */
      algorithms: ['RS256'],
      issuer: FACEBOOK_ISSUER,
      audience: appId,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      maxTokenAge: MAX_TOKEN_AGE_SECONDS,
    })
    payload = verified.payload as Record<string, unknown>
  } catch (err) {
    // Covers a bad signature, unresolved `kid`, wrong issuer or audience, an
    // expired token, a token older than the age bound, and malformed input.
    // The token is NEVER logged — only the library's reason string.
    console.warn('[AUTH] Limited Login verification failed', {
      reason: (err as Error)?.message,
    })
    return { ok: false, reason: 'invalid_token' }
  }

  /**
   * `iat` IS REQUIRED AND MUST NOT BE IN THE FUTURE.
   *
   * `jose` uses `iat` for the `maxTokenAge` bound but does not reject a
   * forward-dated one, and it does not require the claim to be present at all. A
   * token stamped in the future would otherwise sail past the age check forever.
   */
  const iat = payload.iat
  if (typeof iat !== 'number' || !Number.isFinite(iat)) {
    return { ok: false, reason: 'invalid_token' }
  }
  if (iat > Math.floor(Date.now() / 1000) + CLOCK_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'invalid_token' }
  }

  /**
   * THE NONCE IS CHECKED ONLY AFTER THE SIGNATURE PASSES, and that order matters.
   * Consuming first would let anyone burn a legitimate user's pending nonce by
   * posting a forged token — a denial of service against sign-in. Only a
   * cryptographically valid token is allowed to spend one.
   */
  const nonce = payload.nonce
  if (typeof nonce !== 'string' || nonce.length === 0) {
    return { ok: false, reason: 'invalid_token' }
  }

  const consumed = await consumeLoginNonce(nonce)
  if (consumed.ok === false) {
    /**
     * `unknown`, `expired` and `already_used` all collapse to one client-visible
     * failure. Distinguishing them would tell an attacker holding a replayed
     * token whether their capture was ever valid, and the caller's taxonomy has
     * no place to express the difference anyway.
     */
    console.warn('[AUTH] Limited Login nonce rejected', { reason: consumed.reason })
    return { ok: false, reason: 'invalid_token' }
  }

  const sub = payload.sub
  if (typeof sub !== 'string' || sub.length === 0) {
    return { ok: false, reason: 'invalid_token' }
  }

  /**
   * `no_email` IS ITS OWN OUTCOME, matching the classic verifier. A Facebook
   * account with no email cannot be mapped to a SocialCRM user, and the caller
   * already renders an approved message for it — collapsing it into
   * `invalid_token` would replace that with "login failed, try again", which is
   * advice the user cannot act on.
   */
  const email = payload.email
  if (typeof email !== 'string' || email.trim().length === 0) {
    return { ok: false, reason: 'no_email' }
  }

  return {
    ok: true,
    identity: {
      sub,
      email,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      picture: typeof payload.picture === 'string' ? payload.picture : undefined,
    },
  }
}
