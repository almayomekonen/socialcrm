import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ connection: vi.fn(async () => undefined) }))
vi.mock('next/server', async (importActual) => ({
  ...(await importActual<typeof import('next/server')>()),
  connection: h.connection,
}))

import { GET as asGET } from '@/app/.well-known/oauth-authorization-server/route'
import { GET as prmGET } from '@/app/.well-known/oauth-protected-resource/api/mcp/route'
import { GET as prmRootGET } from '@/app/.well-known/oauth-protected-resource/route'
import { buildAuthorizationRedirect, ISS_PARAMETER_SUPPORTED } from '@/lib/oauth/server/authorizeResponse'
import { issuer, mcpResource, MCP_READ_SCOPES, protectedResourceMetadataUrl } from '@/lib/oauth/server/config'

const ROUTES = [
  ['AS metadata', asGET],
  ['PRM (path form)', prmGET],
  ['PRM (root form)', prmRootGET],
] as const

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('MCP_ENABLED', '1')
})
afterEach(() => vi.unstubAllEnvs())

describe('discovery metadata — feature gate', () => {
  it.each(ROUTES)('%s is 404 (no-store, empty body) while MCP is disabled', async (_n, GET) => {
    for (const v of ['', '0', 'true']) {
      vi.stubEnv('MCP_ENABLED', v)
      const res = await GET()
      expect(res.status).toBe(404)
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(await res.text()).toBe('')
    }
  })

  it.each(ROUTES)('%s follows the kill switch on every request (no stale snapshot)', async (_n, GET) => {
    expect((await GET()).status).toBe(200)
    vi.stubEnv('MCP_ENABLED', '')
    expect((await GET()).status).toBe(404)
    vi.stubEnv('MCP_ENABLED', '1')
    expect((await GET()).status).toBe(200)
  })

  it.each(ROUTES)('%s opts into request-time rendering before reading config', async (_n, GET) => {
    await GET()
    expect(h.connection).toHaveBeenCalledTimes(1)
  })

  it.each(ROUTES)('%s is never cached and is JSON', async (_n, GET) => {
    const res = await GET()
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('content-type')).toMatch(/^application\/json/)
  })

  it.each(ROUTES)('%s fails closed (500, no body detail) when the origin is misconfigured', async (_n, GET) => {
    vi.stubEnv('MCP_PUBLIC_ORIGIN', 'http://not-https.example.com')
    vi.stubEnv('NODE_ENV', 'production')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const res = await GET()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'server_error' })
  })
})

describe('authorization server metadata', () => {
  it('is exactly the implemented capability set — nothing more', async () => {
    const body = await (await asGET()).json()
    expect(body).toEqual({
      issuer: 'https://crm.test',
      authorization_endpoint: 'https://crm.test/api/oauth/authorize',
      token_endpoint: 'https://crm.test/api/oauth/token',
      revocation_endpoint: 'https://crm.test/api/oauth/revoke',
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['crm.leads.read', 'crm.conversations.read'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    })
  })

  it('advertises no DCR, PAR, JAR/JARM, introspection, OIDC or extra client-auth methods', async () => {
    const body = (await (await asGET()).json()) as Record<string, unknown>
    for (const absent of [
      'registration_endpoint',
      'pushed_authorization_request_endpoint',
      'require_pushed_authorization_requests',
      'request_parameter_supported',
      'request_uri_parameter_supported',
      'request_object_signing_alg_values_supported',
      'authorization_signing_alg_values_supported',
      'introspection_endpoint',
      'userinfo_endpoint',
      'jwks_uri',
      'id_token_signing_alg_values_supported',
      'token_endpoint_auth_signing_alg_values_supported',
    ]) {
      expect(body, absent).not.toHaveProperty(absent)
    }
    expect(body.token_endpoint_auth_methods_supported).toEqual(['none'])
    expect(body.token_endpoint_auth_methods_supported).not.toContain('private_key_jwt')
    expect(body.code_challenge_methods_supported).toEqual(['S256'])
    expect(body.scopes_supported).not.toContain('openid')
  })

  it('RFC 9207: the advertised flag and the single response builder agree', async () => {
    const body = await (await asGET()).json()
    expect(body.authorization_response_iss_parameter_supported).toBe(ISS_PARAMETER_SUPPORTED)
    const success = new URL(buildAuthorizationRedirect('https://chatgpt.com/cb', { code: 'c' }))
    const failure = new URL(buildAuthorizationRedirect('https://chatgpt.com/cb', { error: 'access_denied' }))
    expect(success.searchParams.get('iss')).toBe(body.issuer)
    expect(failure.searchParams.get('iss')).toBe(body.issuer)
  })
})

describe('protected resource metadata', () => {
  it('is exactly the MCP resource description', async () => {
    expect(await (await prmGET()).json()).toEqual({
      resource: 'https://crm.test/api/mcp',
      authorization_servers: ['https://crm.test'],
      scopes_supported: ['crm.leads.read', 'crm.conversations.read'],
      bearer_methods_supported: ['header'],
      resource_name: 'SocialCRM',
    })
  })

  it('root and path forms serve the identical document', async () => {
    expect(await (await prmRootGET()).json()).toEqual(await (await prmGET()).json())
  })

  it('agrees with the AS metadata and the token audience', async () => {
    const as = await (await asGET()).json()
    const prm = await (await prmGET()).json()
    expect(prm.authorization_servers).toEqual([as.issuer])
    expect(prm.scopes_supported).toEqual(as.scopes_supported)
    expect(prm.scopes_supported).toEqual([...MCP_READ_SCOPES])
    expect(prm.resource).toBe(mcpResource())
  })
})

describe('URL consistency — one origin source, no hard-coded host', () => {
  it('every published URL moves with MCP_PUBLIC_ORIGIN', async () => {
    vi.stubEnv('MCP_PUBLIC_ORIGIN', 'https://staging.example.org')
    const as = await (await asGET()).json()
    const prm = await (await prmGET()).json()
    const urls = [
      as.issuer,
      as.authorization_endpoint,
      as.token_endpoint,
      as.revocation_endpoint,
      prm.resource,
      ...prm.authorization_servers,
    ]
    for (const u of urls) expect(u.startsWith('https://staging.example.org')).toBe(true)
    expect(as.issuer).toBe(issuer())
    expect(prm.resource).toBe(mcpResource())
    expect(protectedResourceMetadataUrl()).toBe('https://staging.example.org/.well-known/oauth-protected-resource/api/mcp')
    expect(new URL(buildAuthorizationRedirect('https://chatgpt.com/cb', { code: 'c' })).searchParams.get('iss')).toBe(as.issuer)
    expect(JSON.stringify([as, prm])).not.toContain('getsocialcrm.com')
    expect(JSON.stringify([as, prm])).not.toContain('crm.test')
  })
})
