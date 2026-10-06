import 'server-only'
import { db } from '@/config/db'
import { canUseMcp } from '@/lib/flags/mcpFlags'
import { mcpResource, type McpScopeName } from './config'
import { isThisResource } from './redirectUri'
import { sha256Hex } from './hash'
import { consumeAuthorizationCode } from './authorizationCodes'
import { issueRefreshToken, rotateRefreshToken } from './refreshTokens'
import { getActiveGrant, revokeGrant, type Grant, type RevokeReason } from './grants'
import { signMcpAccessToken, ACCESS_TOKEN_TTL_SECONDS } from './accessToken'
import {
  OPAQUE_RE,
  VERIFIER_RE,
  canonicalScopes,
  fail,
  isClientIdSyntax,
  isRedirectUriSyntax,
  parseOAuthForm,
  parseRequestedScope,
  type TokenOutcome,
} from './tokenRequest'

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

const REFRESH_PER_HOUR = 120

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

// Re-exported for existing importers (the revocation route).
export { parseOAuthForm, OPAQUE_RE as OPAQUE_TOKEN_RE, type TokenOutcome }
