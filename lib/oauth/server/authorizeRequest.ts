import 'server-only'
import { resolveClient } from './cimd'
import { redirectUriAllowed, isThisResource } from './redirectUri'
import { isValidCodeChallenge } from './pkce'
import { MCP_READ_SCOPES, isMcpScope, mcpResource, type McpScopeName } from './config'
import type { AuthorizeErrorCode } from './authorizeResponse'

/**
 * Validates an /authorize request in a fixed order.
 *
 *   1. client_id   — resolved through CIMD
 *   2. redirect_uri — exact member of that client's registered list
 *   ── only now is redirect_uri trusted to receive errors ──
 *   3. state, response_type, PKCE, resource, scope
 *
 * Steps 1–2 fail LOCALLY (the caller renders a page, never redirects). Step 3
 * failures are returned for the caller to send to the trusted redirect_uri.
 * Nothing is repaired: duplicates, empty scope tokens and unknown values are
 * rejected, not normalised.
 */

const MAX_STATE = 512

export type ResumeRequest = {
  clientId: string
  clientName: string
  redirectUri: string
  codeChallenge: string
  scopes: McpScopeName[]
  resource: string
  state: string | null
}

export type AuthorizeValidation =
  | { kind: 'local_error' }
  | { kind: 'redirect_error'; redirectUri: string; error: AuthorizeErrorCode; description: string; state: string | null }
  | { kind: 'ok'; request: ResumeRequest }

type One = { ok: true; value: string | null } | { ok: false }
function one(q: URLSearchParams, name: string): One {
  const all = q.getAll(name)
  return all.length > 1 ? { ok: false } : { ok: true, value: all[0] ?? null }
}

function parseScopes(raw: string | null): McpScopeName[] | null {
  if (raw === null || raw === '') return [...MCP_READ_SCOPES]
  const parts = raw.split(' ')
  if (parts.some((p) => p === '' || !isMcpScope(p))) return null
  if (new Set(parts).size !== parts.length) return null
  return parts as McpScopeName[]
}

export async function validateAuthorizeRequest(q: URLSearchParams): Promise<AuthorizeValidation> {
  // ── 1. client
  const clientId = one(q, 'client_id')
  if (!clientId.ok || !clientId.value) return { kind: 'local_error' }
  const client = await resolveClient(clientId.value)
  if (!client.ok) return { kind: 'local_error' }

  // ── 2. redirect_uri
  const redirect = one(q, 'redirect_uri')
  if (!redirect.ok || !redirect.value || !redirectUriAllowed(redirect.value, client.client.redirectUris)) {
    return { kind: 'local_error' }
  }
  const redirectUri = redirect.value

  // ── 3. everything else, reported to the now-trusted redirect_uri
  const state = one(q, 'state')
  const fail = (error: AuthorizeErrorCode, description: string, echoState = true): AuthorizeValidation => ({
    kind: 'redirect_error',
    redirectUri,
    error,
    description,
    state: echoState && state.ok ? state.value : null,
  })
  if (!state.ok) return fail('invalid_request', 'duplicate state', false)
  if (state.value !== null && state.value.length > MAX_STATE) return fail('invalid_request', 'state too long', false)

  const responseType = one(q, 'response_type')
  if (!responseType.ok) return fail('invalid_request', 'duplicate parameter')
  if (responseType.value !== 'code') return fail('unsupported_response_type', 'only code is supported')

  const method = one(q, 'code_challenge_method')
  const challenge = one(q, 'code_challenge')
  if (!method.ok || !challenge.ok) return fail('invalid_request', 'duplicate parameter')
  if (method.value !== 'S256' || !challenge.value || !isValidCodeChallenge(challenge.value)) {
    return fail('invalid_request', 'PKCE S256 required')
  }

  const resource = one(q, 'resource')
  if (!resource.ok) return fail('invalid_request', 'duplicate parameter')
  if (!resource.value || !isThisResource(resource.value)) return fail('invalid_target', 'invalid resource')

  const scope = one(q, 'scope')
  if (!scope.ok) return fail('invalid_request', 'duplicate parameter')
  const scopes = parseScopes(scope.value)
  if (!scopes) return fail('invalid_scope', 'invalid scope')

  return {
    kind: 'ok',
    request: {
      clientId: client.client.clientId,
      clientName: client.client.clientName,
      redirectUri,
      codeChallenge: challenge.value,
      scopes,
      resource: mcpResource(),
      state: state.value,
    },
  }
}
