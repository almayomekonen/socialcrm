import 'server-only'
import { db } from '@/config/db'
import { canUseMcp } from '@/lib/flags/mcpFlags'
import { MCP_READ_SCOPES, isMcpScope, mcpResource, type McpScopeName } from './config'
import { isThisResource } from './redirectUri'
import { sha256Hex } from './hash'
import { consumeAuthorizationCode } from './authorizationCodes'
import { issueRefreshToken, rotateRefreshToken } from './refreshTokens'
import { getActiveGrant, revokeGrant, type Grant, type RevokeReason } from './grants'
import { signMcpAccessToken, ACCESS_TOKEN_TTL_SECONDS } from './accessToken'

/**
 * OAuth 2.1 token endpoint logic (public clients only).
 *
 * consumeAuthorizationCode() burns a code the moment it is presented, so EVERY
 * check that does not need the stored code runs first: content type, body
 * size, duplicated parameters, client-authentication material, grant_type,
 * presence and shape of client_id / redirect_uri / code / code_verifier, and
 * resource. Only a well-formed request reaches the code. Checks that need the
 * stored code (client, redirect, PKCE, resource, expiry, replay) stay inside
 * the atomic consumption.
 *
 * Errors are RFC 6749 codes with short generic descriptions — never ids,
 * hashes, session versions, suspension or database details.
 */

export type TokenOutcome = { status: number; body: Record<string, unknown>; basicChallenge?: boolean }

const MAX_BODY_BYTES = 8 * 1024
const REFRESH_PER_HOUR = 120
const OPAQUE_RE = /^[A-Za-z0-9_-]{43}$/ // our codes and refresh tokens: 32 random bytes, base64url
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/ // RFC 7636 §4.1
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

const fail = (error: string, description: string, status = 400, basicChallenge = false): TokenOutcome => ({
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

function isClientIdSyntax(v: string): boolean {
  try {
    const u = new URL(v)
    return v.length <= 2048 && u.href === v && u.protocol === 'https:' && !u.username && !u.password && !u.hash
  } catch {
    return false
  }
}

function isRedirectUriSyntax(v: string): boolean {
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
function parseRequestedScope(raw: string | null): McpScopeName[] | undefined | null {
  if (raw === null || raw === '') return undefined
  const parts = raw.split(' ')
  if (parts.some((p) => p === '' || !isMcpScope(p))) return null
  if (new Set(parts).size !== parts.length) return null
  return parts as McpScopeName[]
}

/** Canonical OAuth form: a fixed order, only known scopes, never added ones. */
const canonicalScopes = (list: readonly string[]): McpScopeName[] => MCP_READ_SCOPES.filter((s) => list.includes(s))

/**
 * DB facts that must still hold for a grant to mint tokens. On failure the
 * grant is revoked with the reason — which also revokes every refresh token
 * under it, including a successor minted moments earlier by rotation.
 * Product access is deliberately NOT checked (Phase A): the MCP request path
 * reports it as product_access_required instead.
 */
export async function checkGrantStillValid(grantId: number): Promise<{ ok: true; grant: Grant } | { ok: false }> {
  const grant = await getActiveGrant(grantId)
  if (!grant) return { ok: false }
  const user = await db('users').where({ id: grant.userId }).first('agencyId', 'suspended', 'sessionVersion')
  const reason: RevokeReason | null = !user
    ? 'user_missing'
    : user.suspended
      ? 'user_suspended'
      : user.agencyId !== grant.agencyId
        ? 'agency_changed'
        : Number(user.sessionVersion ?? 0) !== grant.sessionVersion
          ? 'session_revoked'
          : !canUseMcp(grant.agencyId)
            ? 'not_allowlisted'
            : null
  if (reason) {
    await revokeGrant(grant.id, reason)
    return { ok: false }
  }
  return { ok: true, grant }
}

async function tokensFor(grant: Grant, scopes: McpScopeName[], refreshToken: string): Promise<TokenOutcome> {
  const accessToken = await signMcpAccessToken({
    userId: grant.userId,
    agencyId: grant.agencyId,
    grantId: grant.id,
    sessionVersion: grant.sessionVersion,
    scopes,
    clientId: grant.clientId,
  })
  return {
    status: 200,
    body: {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    },
  }
}

async function refreshRateLimited(rawRefreshToken: string): Promise<boolean> {
  const row = await db('oauth_refresh_tokens')
    .where({ token_hash: sha256Hex(rawRefreshToken) })
    .first('grant_id')
  if (!row) return false
  const [{ n }] = await db('oauth_refresh_tokens')
    .where({ grant_id: row.grant_id })
    .where('issued_at', '>', db.raw("NOW() - interval '1 hour'"))
    .count<{ n: string }[]>('* as n')
  return Number(n) > REFRESH_PER_HOUR
}

export async function handleTokenRequest(input: {
  contentType: string | null
  hasAuthorizationHeader: boolean
  body: string
}): Promise<TokenOutcome> {
  const parsed = parseOAuthForm(input)
  if ('outcome' in parsed) return parsed.outcome
  const f = parsed.form

  const grantType = f.get('grant_type')
  if (!grantType) return fail('invalid_request', 'grant_type required')
  if (grantType !== 'authorization_code' && grantType !== 'refresh_token') {
    return fail('unsupported_grant_type', 'authorization_code or refresh_token')
  }

  const clientId = f.get('client_id')
  if (!clientId) return fail('invalid_request', 'client_id required')
  if (!isClientIdSyntax(clientId)) return fail('invalid_client', 'unknown client', 401)

  const resource = f.get('resource')
  if (resource !== null && !isThisResource(resource)) return fail('invalid_target', 'resource must be this server')

  if (grantType === 'authorization_code') {
    const code = f.get('code')
    const redirectUri = f.get('redirect_uri')
    const verifier = f.get('code_verifier')
    if (!code) return fail('invalid_request', 'code required')
    if (!redirectUri || !isRedirectUriSyntax(redirectUri)) return fail('invalid_request', 'valid redirect_uri required')
    if (!verifier || !VERIFIER_RE.test(verifier)) return fail('invalid_request', 'valid code_verifier required')
    if (!OPAQUE_RE.test(code)) return fail('invalid_grant', 'invalid authorization code')

    // ── The code is consumed (burned) from here on.
    const out = await consumeAuthorizationCode(code, { clientId, redirectUri, resource: mcpResource(), codeVerifier: verifier })
    if (!out.ok) return fail('invalid_grant', 'invalid authorization code')
    const valid = await checkGrantStillValid(out.grantId)
    if (!valid.ok) return fail('invalid_grant', 'authorization is no longer valid')
    const scopes = canonicalScopes(out.scopes)
    const refresh = await issueRefreshToken({ grantId: valid.grant.id, userId: valid.grant.userId, scopes })
    return tokensFor(valid.grant, scopes, refresh.token)
  }

  // ── refresh_token
  const refreshToken = f.get('refresh_token')
  if (!refreshToken) return fail('invalid_request', 'refresh_token required')
  const requested = parseRequestedScope(f.get('scope'))
  if (requested === null) return fail('invalid_scope', 'invalid scope')
  if (!OPAQUE_RE.test(refreshToken)) return fail('invalid_grant', 'invalid refresh token')
  if (await refreshRateLimited(refreshToken)) {
    console.warn('[oauth/token] refresh rate limited')
    return fail('invalid_grant', 'too many refresh requests; try again later')
  }

  const rot = await rotateRefreshToken(refreshToken, { resource: mcpResource(), requestedScopes: requested })
  if ('reason' in rot) {
    if (rot.reason === 'invalid_scope') return fail('invalid_scope', 'scope exceeds the original grant')
    if (rot.reason === 'invalid_target') return fail('invalid_target', 'resource must be this server')
    return fail('invalid_grant', 'invalid refresh token')
  }
  const valid = await checkGrantStillValid(rot.grantId)
  if (!valid.ok) return fail('invalid_grant', 'authorization is no longer valid')
  if (valid.grant.clientId !== clientId) {
    // Presented by a different client than it was issued to: treat as theft.
    await revokeGrant(valid.grant.id, 'client_revoked')
    return fail('invalid_grant', 'invalid refresh token')
  }
  return tokensFor(valid.grant, canonicalScopes(rot.scopes), rot.token)
}

export { OPAQUE_RE as OPAQUE_TOKEN_RE }
