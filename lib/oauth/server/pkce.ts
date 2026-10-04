import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * PKCE, S256 ONLY (OAuth 2.1). There is deliberately no `plain` branch: a
 * verifier is always hashed before comparison, so presenting the verifier as its
 * own challenge can never match.
 */

// RFC 7636 §4.1: 43–128 chars from the unreserved set [A-Z a-z 0-9 - . _ ~].
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/
// base64url(SHA-256(verifier)) without padding is always exactly 43 chars.
const S256_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/

export function isValidCodeChallenge(c: string): boolean {
  return typeof c === 'string' && S256_CHALLENGE_RE.test(c)
}

/** Constant-time comparison of BASE64URL(SHA256(verifier)) against the stored challenge. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (typeof verifier !== 'string' || !VERIFIER_RE.test(verifier) || !isValidCodeChallenge(challenge)) return false
  const computed = Buffer.from(createHash('sha256').update(verifier, 'ascii').digest('base64url'), 'ascii')
  const expected = Buffer.from(challenge, 'ascii')
  return computed.length === expected.length && timingSafeEqual(computed, expected)
}
