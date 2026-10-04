import 'server-only'
import { SignJWT, jwtVerify } from 'jose'
import { randomUUID } from 'node:crypto'
import { randomToken } from './hash'
import { isValidCodeChallenge } from './pkce'
import { mcpSigningKey } from './accessToken'
import { trustedClientHosts } from './cimd'
import { issuer, mcpResource, isMcpScope, type McpScopeName } from './config'

/**
 * The server-validated OAuth authorization request, carried across login in a
 * signed, httpOnly cookie.
 *
 * Written ONLY by /api/oauth/authorize after every check has passed. Lives 10
 * minutes. Holds only what the consent step needs to resume — no tokens, no
 * session data, no user data. It decides WHETHER login resumes OAuth, never
 * WHERE the browser goes (see postLoginDestination.ts).
 *
 * Single use is enforced when the code is minted: the consent POST inserts the
 * code with this jti, and oauth_authorization_codes.request_jti is UNIQUE.
 *
 * Signed with the MCP key behind a dedicated header typ, so it can never be
 * accepted as an access token (at+jwt) or the reverse. Verification treats the
 * decoded payload as untrusted and re-validates every field, even though only
 * this server can sign it.
 */

export const PENDING_COOKIE = 'scrm_oauth_pending'
export const PENDING_TTL_SECONDS = 600

const TYP_HEADER = 'oauth-pending+jwt'
const TYP_CLAIM = 'oauth_pending'
const CLOCK_TOLERANCE_SECONDS = 30
const MAX_STATE = 512
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CSRF_RE = /^[A-Za-z0-9_-]{32}$/
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/

export type PendingAuthorization = {
  jti: string
  clientId: string
  clientName: string
  redirectUri: string
  codeChallenge: string
  scopes: McpScopeName[]
  resource: string
  state: string | null
  csrf: string
}

type ResumeState = Omit<PendingAuthorization, 'jti' | 'csrf'>

// Audience for this token kind only; never a URL the browser is sent to.
const audience = () => `${issuer()}/oauth/consent#pending`

function isAllowedClientId(v: unknown): v is string {
  if (typeof v !== 'string') return false
  try {
    const u = new URL(v)
    return (
      u.href === v &&
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      !u.search &&
      !u.hash &&
      u.pathname.length > 1 &&
      trustedClientHosts().includes(u.hostname)
    )
  } catch {
    return false
  }
}

function isSafeRedirectUri(v: unknown): v is string {
  if (typeof v !== 'string' || /[\s\\#]/.test(v)) return false
  try {
    const u = new URL(v)
    if (u.username || u.password) return false
    if (u.protocol === 'https:') return true
    return (
      u.protocol === 'http:' &&
      (u.hostname === '127.0.0.1' || u.hostname === 'localhost') &&
      process.env.MCP_ALLOW_LOOPBACK_REDIRECTS === '1' &&
      process.env.NODE_ENV !== 'production'
    )
  } catch {
    return false
  }
}

function parseScopes(v: unknown): McpScopeName[] | null {
  if (!Array.isArray(v) || v.length === 0) return null
  if (!v.every((s) => typeof s === 'string' && isMcpScope(s))) return null
  return Array.from(new Set(v as McpScopeName[]))
}

/** One validator for both directions: what we sign and what we accept back. */
function validResumeState(p: Record<string, unknown>): ResumeState | null {
  const scopes = parseScopes(p.scopes)
  const state = p.state
  const ok =
    isAllowedClientId(p.clientId) &&
    typeof p.clientName === 'string' &&
    p.clientName.trim().length > 0 &&
    p.clientName.length <= 200 &&
    !CONTROL_RE.test(p.clientName) &&
    isSafeRedirectUri(p.redirectUri) &&
    typeof p.codeChallenge === 'string' &&
    isValidCodeChallenge(p.codeChallenge) &&
    scopes !== null &&
    p.resource === mcpResource() &&
    (state === null || (typeof state === 'string' && state.length <= MAX_STATE))
  if (!ok) return null
  return {
    clientId: p.clientId as string,
    clientName: p.clientName as string,
    redirectUri: p.redirectUri as string,
    codeChallenge: p.codeChallenge as string,
    scopes: scopes!,
    resource: p.resource as string,
    state: state as string | null,
  }
}

export async function signPendingRequest(p: ResumeState): Promise<{ token: string; pending: PendingAuthorization }> {
  const resume = validResumeState(p as unknown as Record<string, unknown>)
  if (!resume) throw new Error('refusing to sign an invalid pending authorization request')
  const pending: PendingAuthorization = { ...resume, jti: randomUUID(), csrf: randomToken(24) }
  const { jti, ...claims } = pending
  const now = Math.floor(Date.now() / 1000)
  const token = await new SignJWT({ ...claims, typ: TYP_CLAIM })
    .setProtectedHeader({ alg: 'HS256', typ: TYP_HEADER })
    .setIssuer(issuer())
    .setAudience(audience())
    .setJti(jti)
    .setIssuedAt(now)
    .setExpirationTime(now + PENDING_TTL_SECONDS)
    .sign(mcpSigningKey())
  return { token, pending }
}

/** Fail closed: anything invalid, foreign, expired or malformed → null. Never throws. */
export async function verifyPendingRequest(raw?: string | null): Promise<PendingAuthorization | null> {
  if (typeof raw !== 'string' || raw === '') return null
  try {
    const { payload: p } = await jwtVerify(raw, mcpSigningKey(), {
      algorithms: ['HS256'],
      typ: TYP_HEADER,
      issuer: issuer(),
      audience: audience(),
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ['iss', 'aud', 'jti', 'iat', 'exp'],
    })
    if (p.typ !== TYP_CLAIM || typeof p.jti !== 'string' || !UUID_RE.test(p.jti)) return null
    if (typeof p.csrf !== 'string' || !CSRF_RE.test(p.csrf)) return null
    if (!('state' in p)) return null
    const resume = validResumeState(p as Record<string, unknown>)
    if (!resume) return null
    return { ...resume, jti: p.jti, csrf: p.csrf }
  } catch {
    return null
  }
}

/**
 * HttpOnly; Secure everywhere except local development (plain-http localhost).
 *
 * SameSite=Lax, not Strict: the flow arrives by top-level cross-site
 * navigations — ChatGPT → /api/oauth/authorize, and a magic-link click from an
 * email client → /api/magic — and Strict would drop the cookie on the magic link.
 *
 * Path=/: it must reach /auth (the login server actions), /api/magic,
 * /oauth/consent and /api/oauth/consent, which share no narrower prefix.
 */
export function pendingCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: PENDING_TTL_SECONDS,
  }
}

/**
 * Deletion with the SAME name, path and flags as the original, so the browser
 * removes that cookie instead of creating a second variant beside it.
 */
export function clearedPendingCookieOptions() {
  return { ...pendingCookieOptions(), maxAge: 0, expires: new Date(0) }
}
