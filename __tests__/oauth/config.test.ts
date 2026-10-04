import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  publicOrigin,
  issuer,
  mcpResource,
  protectedResourceMetadataUrl,
  leadUrl,
  isMcpScope,
  MCP_READ_SCOPES,
} from '@/lib/oauth/server/config'

afterEach(() => vi.unstubAllEnvs())

describe('oauth config', () => {
  it('derives issuer/resource/PRM from MCP_PUBLIC_ORIGIN, normalised', () => {
    vi.stubEnv('MCP_PUBLIC_ORIGIN', 'HTTPS://GetSocialCRM.com/')
    expect(publicOrigin()).toBe('https://getsocialcrm.com')
    expect(issuer()).toBe('https://getsocialcrm.com')
    expect(mcpResource()).toBe('https://getsocialcrm.com/api/mcp')
    expect(protectedResourceMetadataUrl()).toBe('https://getsocialcrm.com/.well-known/oauth-protected-resource/api/mcp')
    expect(leadUrl(42)).toBe('https://getsocialcrm.com/clients/42')
  })

  it('refuses a non-https origin in production', () => {
    vi.stubEnv('MCP_PUBLIC_ORIGIN', 'http://getsocialcrm.com')
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => publicOrigin()).toThrow(/https/)
  })

  it('allows http only for loopback outside production', () => {
    vi.stubEnv('MCP_PUBLIC_ORIGIN', 'http://localhost:3000')
    expect(publicOrigin()).toBe('http://localhost:3000')
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => publicOrigin()).toThrow(/https/)
  })

  it('refuses an origin with a path, query, fragment or credentials', () => {
    for (const bad of ['https://a.com/x', 'https://a.com?q=1', 'https://a.com#f', 'https://u:p@a.com']) {
      vi.stubEnv('MCP_PUBLIC_ORIGIN', bad)
      expect(() => publicOrigin(), bad).toThrow()
    }
  })

  it('refuses a missing origin', () => {
    vi.stubEnv('MCP_PUBLIC_ORIGIN', '')
    expect(() => publicOrigin()).toThrow(/MCP_PUBLIC_ORIGIN/)
  })

  it('knows exactly the Phase A scopes', () => {
    expect(MCP_READ_SCOPES).toEqual(['crm.leads.read', 'crm.conversations.read'])
    expect(isMcpScope('crm.leads.read')).toBe(true)
    expect(isMcpScope('crm.conversations.read')).toBe(true)
    expect(isMcpScope('full_access')).toBe(false)
    expect(isMcpScope('crm.leads.status.write')).toBe(false)
  })
})
