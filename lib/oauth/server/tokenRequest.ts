import { MCP_READ_SCOPES, isMcpScope, type McpScopeName } from './config'

/**
 * OAuth token/revocation request SHAPE: parsing and syntax validation that
 * needs no database and burns nothing. Extracted from tokenEndpoint.ts
 * unchanged (Task 17); tokenEndpoint.ts runs these checks before it ever
 * touches a stored code or refresh token.
 */

export type TokenOutcome = { status: number; body: Record<string, unknown>; basicChallenge?: boolean }

const MAX_BODY_BYTES = 8 * 1024
export const OPAQUE_RE = /^[A-Za-z0-9_-]{43}$/ // our codes and refresh tokens: 32 random bytes, base64url
export const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/ // RFC 7636 §4.1
const SENSITIVE = [
  'grant_type',
  'code',
  'refresh_token',
  'code_verifier',
  'redirect_uri',
  'client_id',
  'resource',
  'scope',
  'client_assertion',
  'client_assertion_type',
  'client_secret',
  'token',
  'token_type_hint',
]
const CLIENT_AUTH_PARAMS = ['client_secret', 'client_assertion', 'client_assertion_type']

export const fail = (error: string, description: string, status = 400, basicChallenge = false): TokenOutcome => ({
  status,
  body: { error, error_description: description },
  basicChallenge,
})

/**
 * Shared by the token and revocation endpoints: form-encoded only, bounded,
 * no repeated security-sensitive parameter, no client authentication material
 * (Phase A supports token_endpoint_auth_method=none only).
 */
export function parseOAuthForm(input: {
  contentType: string | null
  hasAuthorizationHeader: boolean
  body: string
}): { ok: true; form: URLSearchParams } | { ok: false; outcome: TokenOutcome } {
  const media = (input.contentType ?? '').split(';')[0].trim().toLowerCase()
  if (media !== 'application/x-www-form-urlencoded')
    return { ok: false, outcome: fail('invalid_request', 'form-encoded body required') }
  if (Buffer.byteLength(input.body, 'utf8') > MAX_BODY_BYTES)
    return { ok: false, outcome: fail('invalid_request', 'request too large') }
  const form = new URLSearchParams(input.body)
  for (const name of SENSITIVE) {
    if (form.getAll(name).length > 1) return { ok: false, outcome: fail('invalid_request', 'repeated parameter') }
  }
  if (input.hasAuthorizationHeader) {
    return { ok: false, outcome: fail('invalid_client', 'client authentication is not supported', 401, true) }
  }
  if (CLIENT_AUTH_PARAMS.some((p) => form.has(p))) {
    return { ok: false, outcome: fail('invalid_client', 'client authentication is not supported', 401) }
  }
  return { ok: true, form }
}

export function isClientIdSyntax(v: string): boolean {
  try {
    const u = new URL(v)
    return v.length <= 2048 && u.href === v && u.protocol === 'https:' && !u.username && !u.password && !u.hash
  } catch {
    return false
  }
}

export function isRedirectUriSyntax(v: string): boolean {
  if (v.length > 2048 || /[\s\\#]/.test(v)) return false
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

/** undefined = not requested; null = malformed/unknown (rejected, never repaired). */
export function parseRequestedScope(raw: string | null): McpScopeName[] | undefined | null {
  if (raw === null || raw === '') return undefined
  const parts = raw.split(' ')
  if (parts.some((p) => p === '' || !isMcpScope(p))) return null
  if (new Set(parts).size !== parts.length) return null
  return parts as McpScopeName[]
}

/** Canonical OAuth form: a fixed order, only known scopes, never added ones. */
export const canonicalScopes = (list: readonly string[]): McpScopeName[] => MCP_READ_SCOPES.filter((s) => list.includes(s))
