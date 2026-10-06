import 'server-only'
import { NextResponse, connection } from 'next/server'
import { isMcpEnabled } from '@/lib/flags/mcpFlags'
import { issuer, mcpResource, publicOrigin, MCP_READ_SCOPES } from './config'
import { ISS_PARAMETER_SUPPORTED } from './authorizeResponse'

/**
 * OAuth discovery documents (RFC 8414 authorization server metadata, RFC 9728
 * protected resource metadata). Every URL comes from config.ts, the same source
 * as the token audience and the RFC 9207 `iss`, so they cannot drift.
 *
 * Only implemented capabilities are advertised: authorization code + PKCE S256,
 * rotating refresh tokens, public clients (`none`), CIMD, RFC 7009 revocation,
 * RFC 9207 `iss`. Deliberately absent: DCR (no registration_endpoint), PAR,
 * JAR/JARM, introspection, OIDC, and private_key_jwt — even though ChatGPT's own
 * client document lists it, we advertise only what we support.
 */

export function authorizationServerMetadata(): Record<string, unknown> {
  const o = publicOrigin()
  return {
    issuer: issuer(),
    authorization_endpoint: `${o}/api/oauth/authorize`,
    token_endpoint: `${o}/api/oauth/token`,
    revocation_endpoint: `${o}/api/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...MCP_READ_SCOPES],
    client_id_metadata_document_supported: true,
    // Honest only because authorizeResponse.ts is the single redirect builder.
    authorization_response_iss_parameter_supported: ISS_PARAMETER_SUPPORTED,
  }
}

export function protectedResourceMetadata(): Record<string, unknown> {
  return {
    resource: mcpResource(),
    authorization_servers: [issuer()],
    scopes_supported: [...MCP_READ_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'SocialCRM',
  }
}

const NO_STORE = { 'cache-control': 'no-store' }

/**
 * Shared GET behaviour for the discovery routes.
 *
 * `connection()` forces request-time rendering: under cacheComponents a GET
 * handler that reads only process.env could otherwise be prerendered at build,
 * freezing the MCP_ENABLED kill switch into the deployment. `no-store` keeps
 * any cache from serving metadata after the switch is flipped. MCP off → 404
 * with no body, so a half-configured server is never advertised.
 */
export async function discoveryResponse(build: () => Record<string, unknown>): Promise<NextResponse> {
  await connection()
  if (!isMcpEnabled()) return new NextResponse(null, { status: 404, headers: NO_STORE })
  try {
    return NextResponse.json(build(), { headers: { ...NO_STORE, 'access-control-allow-origin': '*' } })
  } catch (e) {
    console.error('[oauth/metadata] cannot build discovery document', { reason: (e as Error)?.message })
    return NextResponse.json({ error: 'server_error' }, { status: 500, headers: NO_STORE })
  }
}
