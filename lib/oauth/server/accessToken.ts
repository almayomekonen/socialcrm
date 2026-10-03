import 'server-only'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { randomUUID } from 'node:crypto'
import { issuer, mcpResource, isMcpScope, type McpScopeName } from './config'

/**
 * MCP access tokens: HS256 JWTs (RFC 9068 shape), 15 minutes, audience-bound to
 * the MCP resource.
 *
 * A token proves ONLY "we issued it, for this resource, and it is inside its
 * time window". It is NOT the source of truth for authorization: on every MCP
 * request lib/mcp/auth.ts re-reads the grant, user, agency, sessionVersion,
 * suspension, product access and allowlist from the database.
 *
 * Decoded payloads are untrusted input: every claim is validated, never cast.
 */

export const ACCESS_TOKEN_TTL_SECONDS = 900

const TYP_HEADER = 'at+jwt'
const TYP_CLAIM = 'mcp_access'
const MIN_SECRET_LENGTH = 32
const CLOCK_TOLERANCE_SECONDS = 30
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const POSITIVE_INT_STRING_RE = /^[1-9][0-9]{0,15}$/

export type McpAccessClaims = {
  userId: number
  agencyId: number
  grantId: number
  sessionVersion: number
  scopes: McpScopeName[]
  clientId: string
  jti: string
}

/**
 * Only MCP_JWT_SECRET, never a fallback. Fails closed on a key that is missing,
 * short, or shared with the web-session or mobile key (Task 2 blocks this at
 * boot in production; this is the per-call backstop).
 */
function mcpKey(): Uint8Array {
  const s = process.env.MCP_JWT_SECRET ?? ''
  if (s.length < MIN_SECRET_LENGTH || s === process.env.JWT_SECRET || s === process.env.MOBILE_JWT_SECRET) {
    throw new Error('MCP_JWT_SECRET is missing, too short, or shared with another signing key')
  }
  return new TextEncoder().encode(s)
}

const isPositiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const isNonNegativeInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const isClientId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 2048

function parseScopes(v: unknown): McpScopeName[] | null {
  if (typeof v !== 'string' || v === '') return null
  const parts = v.split(' ')
  if (parts.some((s) => !isMcpScope(s))) return null
  return Array.from(new Set(parts)) as McpScopeName[]
}

export async function signMcpAccessToken(
  c: Omit<McpAccessClaims, 'jti'> | (Omit<McpAccessClaims, 'jti' | 'scopes'> & { scopes: string[] }),
): Promise<string> {
  if (!isPositiveInt(c.userId) || !isPositiveInt(c.agencyId) || !isPositiveInt(c.grantId)) throw new Error('invalid id claim')
  if (!isNonNegativeInt(c.sessionVersion)) throw new Error('invalid sessionVersion')
  if (!isClientId(c.clientId)) throw new Error('invalid clientId')
  const scope = parseScopes(c.scopes.join(' '))
  if (!scope) throw new Error('invalid scopes')

  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    typ: TYP_CLAIM,
    agency: c.agencyId,
    gid: c.grantId,
    sv: c.sessionVersion,
    scope: scope.join(' '),
    client_id: c.clientId,
  })
    .setProtectedHeader({ alg: 'HS256', typ: TYP_HEADER })
    .setIssuer(issuer())
    .setAudience(mcpResource())
    .setSubject(String(c.userId))
    .setJti(randomUUID())
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL_SECONDS)
    .sign(mcpKey())
}

function toClaims(p: JWTPayload): McpAccessClaims | null {
  if (p.typ !== TYP_CLAIM) return null
  if (typeof p.aud !== 'string') return null // exactly one audience: ours
  if (typeof p.sub !== 'string' || !POSITIVE_INT_STRING_RE.test(p.sub)) return null
  if (typeof p.jti !== 'string' || !UUID_RE.test(p.jti)) return null
  if (!isPositiveInt(p.iat) || !isPositiveInt(p.exp) || p.exp - p.iat > ACCESS_TOKEN_TTL_SECONDS) return null

  const userId = Number(p.sub)
  const { agency, gid, sv, client_id: clientId } = p as Record<string, unknown>
  if (!isPositiveInt(userId) || !isPositiveInt(agency) || !isPositiveInt(gid) || !isNonNegativeInt(sv)) return null
  if (!isClientId(clientId)) return null
  const scopes = parseScopes(p.scope)
  if (!scopes) return null

  return { userId, agencyId: agency, grantId: gid, sessionVersion: sv, scopes, clientId, jti: p.jti }
}

/** Fail closed: any invalid, foreign, expired or malformed token → null, with no reason exposed. */
export async function verifyMcpAccessToken(token: string): Promise<McpAccessClaims | null> {
  if (typeof token !== 'string' || token === '') return null
  try {
    const { payload } = await jwtVerify(token, mcpKey(), {
      algorithms: ['HS256'], // never inferred from the header
      typ: TYP_HEADER,
      issuer: issuer(),
      audience: mcpResource(),
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ['iss', 'aud', 'sub', 'jti', 'iat', 'nbf', 'exp'],
    })
    return toClaims(payload)
  } catch {
    return null
  }
}
