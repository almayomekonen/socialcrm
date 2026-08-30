import 'server-only'
import { createRemoteJWKSet, jwtVerify } from 'jose'

/**
 * Google ID-token verification for the NATIVE clients.
 *
 * WHY THIS IS NOT `actions/auth.ts#verifyGoogleCredential`. That verifier is
 * module-private inside a `'use server'` file and, more importantly, it accepts
 * exactly ONE audience: `NEXT_PUBLIC_GGLID`, the web client ID. A Google ID token
 * is minted for the client ID that requested it, so a token from an iOS app
 * carries the iOS client ID as its `aud` and the web verifier rejects it — that
 * single-audience assumption is the concrete reason mobile sign-in cannot simply
 * reuse the web path.
 *
 * MULTI-AUDIENCE IS NOT LOOSER. Every accepted audience must be an OAuth client
 * ID this project owns, listed explicitly in env. `jose` still requires `aud` to
 * match one of them exactly, so widening the list adds clients, never trust:
 * a token minted for someone else's client ID matches nothing here.
 *
 * The signature check against Google's published keys is what gates everything.
 * Without it a caller could assert any `email` and be logged in as that user.
 */

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

// Module-scope so the key set is fetched once and cached across requests, with
// jose handling rotation. Re-creating it per call would hit Google on every login.
const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

export type VerifiedGoogleIdentity = {
  email: string
  name?: string
  picture?: string
  sub: string
}

/**
 * The client IDs a native token may legitimately have been minted for.
 *
 * The web client ID is included because the Expo auth proxy performs the OAuth
 * exchange against a web client. Each entry is optional — an unset platform is
 * simply not accepted, which is the honest behaviour for a platform that has not
 * been configured yet.
 */
export function mobileGoogleAudiences(): string[] {
  return [
    process.env.MOBILE_GOOGLE_IOS_CLIENT_ID,
    process.env.MOBILE_GOOGLE_ANDROID_CLIENT_ID,
    process.env.NEXT_PUBLIC_GGLID,
  ].filter((id): id is string => typeof id === 'string' && id.length > 0)
}

export async function verifyMobileGoogleIdToken(
  idToken: unknown,
): Promise<VerifiedGoogleIdentity | null> {
  if (typeof idToken !== 'string' || idToken.length === 0) return null

  const audience = mobileGoogleAudiences()
  if (audience.length === 0) {
    // FAIL CLOSED. With no configured audience there is nothing to verify
    // against, and "no audience" must never degrade into "any audience".
    console.error('[mobile/auth/google] no Google client IDs configured — cannot verify')
    return null
  }

  try {
    const { payload } = await jwtVerify(idToken, googleJwks, {
      issuer: GOOGLE_ISSUERS,
      audience,
    })

    // Matches the web verifier: some token variants send the string "true".
    // Accepting both is safe — the signature above is what establishes trust.
    const emailVerified = payload.email_verified === true || payload.email_verified === 'true'
    if (!emailVerified) return null
    if (typeof payload.email !== 'string' || !payload.sub) return null

    return {
      email: payload.email,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      picture: typeof payload.picture === 'string' ? payload.picture : undefined,
      sub: String(payload.sub),
    }
  } catch (err) {
    console.warn('[mobile/auth/google] verification failed', { reason: (err as Error)?.message })
    return null
  }
}
