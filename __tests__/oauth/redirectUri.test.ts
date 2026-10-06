import { describe, it, expect } from 'vitest'
import { redirectUriAllowed, isThisResource } from '@/lib/oauth/server/redirectUri'

const REG = ['https://chatgpt.com/connector_platform_oauth_redirect']

describe('redirect_uri exact match', () => {
  it('accepts the exact registered value', () => {
    expect(redirectUriAllowed(REG[0], REG)).toBe(true)
  })

  it('accepts any exact member of a multi-entry list', () => {
    const reg = [...REG, 'https://chatgpt.com/connector/oauth/abc123']
    expect(redirectUriAllowed('https://chatgpt.com/connector/oauth/abc123', reg)).toBe(true)
  })

  it.each([
    'https://chatgpt.com/connector_platform_oauth_redirect/',
    'https://CHATGPT.com/connector_platform_oauth_redirect',
    'HTTPS://chatgpt.com/connector_platform_oauth_redirect',
    'https://chatgpt.com/Connector_platform_oauth_redirect',
    'https://chatgpt.com/connector_platform_oauth_redirect?x=1',
    'https://chatgpt.com/connector_platform_oauth_redirect#f',
    'https://chatgpt.com:443/connector_platform_oauth_redirect',
    'https://chatgpt.com/./connector_platform_oauth_redirect',
    'https://chatgpt.com/connector_platform_oauth_redirect%2F',
    'https://chatgpt.com.evil.com/connector_platform_oauth_redirect',
    'https://evil.com@chatgpt.com/connector_platform_oauth_redirect',
    'http://chatgpt.com/connector_platform_oauth_redirect',
    ' https://chatgpt.com/connector_platform_oauth_redirect',
    '',
  ])('rejects %j', (u) => {
    expect(redirectUriAllowed(u, REG)).toBe(false)
  })

  it('rejects everything against an empty registration list', () => {
    expect(redirectUriAllowed(REG[0], [])).toBe(false)
  })

  it('rejects a non-string input without throwing', () => {
    expect(redirectUriAllowed(undefined as unknown as string, REG)).toBe(false)
    expect(redirectUriAllowed(null as unknown as string, REG)).toBe(false)
  })
})

describe('resource indicator (RFC 8707) — only the canonical MCP URI', () => {
  // MCP_PUBLIC_ORIGIN is https://crm.test in the test setup.
  it('accepts the canonical URI', () => {
    expect(isThisResource('https://crm.test/api/mcp')).toBe(true)
  })

  it('tolerates only what the plan permits: scheme/host case and one trailing slash', () => {
    expect(isThisResource('HTTPS://CRM.TEST/api/mcp')).toBe(true)
    expect(isThisResource('https://crm.test/api/mcp/')).toBe(true)
  })

  it.each([
    ['bare origin', 'https://crm.test'],
    ['origin with slash', 'https://crm.test/'],
    ['fragment', 'https://crm.test/api/mcp#x'],
    ['empty fragment', 'https://crm.test/api/mcp#'],
    ['query', 'https://crm.test/api/mcp?x=1'],
    ['empty query', 'https://crm.test/api/mcp?'],
    ['credentials', 'https://user:pw@crm.test/api/mcp'],
    ['user only', 'https://user@crm.test/api/mcp'],
    ['explicit default port', 'https://crm.test:443/api/mcp'],
    ['other port', 'https://crm.test:8443/api/mcp'],
    ['path case', 'https://crm.test/api/MCP'],
    ['double trailing slash', 'https://crm.test/api/mcp//'],
    ['dot segment', 'https://crm.test/api/x/../mcp'],
    ['dot segment 2', 'https://crm.test/api/./mcp'],
    ['percent-encoded path', 'https://crm.test/api/%6Dcp'],
    ['sub-path', 'https://crm.test/api/mcp/tools'],
    ['other origin', 'https://other.test/api/mcp'],
    ['look-alike host', 'https://crm.test.evil.com/api/mcp'],
    ['http', 'http://crm.test/api/mcp'],
    ['missing scheme', 'crm.test/api/mcp'],
    ['protocol-relative', '//crm.test/api/mcp'],
    ['whitespace', ' https://crm.test/api/mcp'],
    ['backslash', 'https://crm.test\\api\\mcp'],
    ['empty', ''],
  ])('rejects %s', (_name, r) => {
    expect(isThisResource(r)).toBe(false)
  })

  it('rejects non-string input without throwing', () => {
    expect(isThisResource(undefined as unknown as string)).toBe(false)
  })
})
