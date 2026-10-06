import { issuer } from './config'

/**
 * RFC 9207 — the ONLY builder of OAuth authorization redirects (success and
 * error). It always sets `iss` to the configured issuer, and callers cannot set
 * or override it. That guarantee is what makes advertising
 * `authorization_response_iss_parameter_supported: true` honest: the metadata
 * imports this constant instead of hard-coding `true`.
 *
 * It is NOT a generic redirect helper: it accepts only the authorization
 * response parameters (code | error [+ error_description], state), and the
 * target must already be a validated, registered redirect_uri.
 */
export const ISS_PARAMETER_SUPPORTED = true as const

export type AuthorizeErrorCode =
  | 'access_denied'
  | 'invalid_request'
  | 'invalid_scope'
  | 'invalid_target'
  | 'unsupported_response_type'
  | 'server_error'
  | 'temporarily_unavailable'

const ERROR_CODES: ReadonlySet<string> = new Set<AuthorizeErrorCode>([
  'access_denied',
  'invalid_request',
  'invalid_scope',
  'invalid_target',
  'unsupported_response_type',
  'server_error',
  'temporarily_unavailable',
])

type Success = { code: string; state?: string | null }
type Failure = { error: AuthorizeErrorCode; error_description?: string; state?: string | null }

const ALLOWED_KEYS = new Set(['code', 'error', 'error_description', 'state'])
// Response parameters the server owns: any copy already on the registered URI is dropped.
const RESPONSE_KEYS = ['code', 'error', 'error_description', 'state', 'iss']

function assertParams(params: Record<string, unknown>): void {
  for (const k of Object.keys(params)) {
    if (k === 'iss') throw new Error('iss is set by the authorization server only')
    if (!ALLOWED_KEYS.has(k)) throw new Error(`unsupported authorization response parameter: ${k}`)
  }
  const hasCode = typeof params.code === 'string' && params.code !== ''
  const hasError = typeof params.error === 'string' && ERROR_CODES.has(params.error)
  if (hasCode === hasError) throw new Error('an authorization response carries exactly one of code or a known error')
  if (hasCode && 'error_description' in params) throw new Error('error_description is only valid on an error response')
}

function assertRedirectTarget(u: URL): void {
  if (u.hash) throw new Error('redirect_uri must not contain a fragment')
  if (u.username || u.password) throw new Error('redirect_uri must not contain credentials')
  if (u.protocol === 'https:') return
  const loopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost'
  const devLoopback =
    u.protocol === 'http:' &&
    loopback &&
    process.env.MCP_ALLOW_LOOPBACK_REDIRECTS === '1' &&
    process.env.NODE_ENV !== 'production'
  if (!devLoopback) throw new Error('redirect_uri must use https')
}

export function buildAuthorizationRedirect(redirectUri: string, params: Success | Failure): string {
  assertParams(params as Record<string, unknown>)
  const u = new URL(redirectUri) // throws on a relative or malformed value
  assertRedirectTarget(u)
  for (const k of RESPONSE_KEYS) u.searchParams.delete(k)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v))
  }
  u.searchParams.set('iss', issuer())
  return u.toString()
}

/** Test oracle / client-side check: exactly what a conforming client verifies. */
export function readAuthorizationResponseIssuer(
  url: string,
  expected: string,
): { ok: true } | { ok: false; reason: 'missing' | 'mismatch' } {
  const iss = new URL(url).searchParams.get('iss')
  if (!iss) return { ok: false, reason: 'missing' }
  return iss === expected ? { ok: true } : { ok: false, reason: 'mismatch' }
}
