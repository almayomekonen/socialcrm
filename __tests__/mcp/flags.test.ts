import { describe, it, expect, afterEach, vi } from 'vitest'
import { canUseMcp, isMcpEnabled, isMcpAgencyAllowlisted } from '@/lib/flags/mcpFlags'

afterEach(() => vi.unstubAllEnvs())

describe('mcp flags', () => {
  it('absence blocks', () => {
    vi.stubEnv('MCP_ENABLED', '')
    vi.stubEnv('MCP_AGENCY_ALLOWLIST', 'all')
    expect(isMcpEnabled()).toBe(false)
    expect(canUseMcp(5)).toBe(false)
  })

  it.each(['true', 'yes', 'on', '01', ' 1', '1 ', 'TRUE', '2'])('fails closed for MCP_ENABLED=%j', (v) => {
    vi.stubEnv('MCP_ENABLED', v)
    vi.stubEnv('MCP_AGENCY_ALLOWLIST', 'all')
    expect(isMcpEnabled()).toBe(false)
    expect(canUseMcp(5)).toBe(false)
  })

  it('master switch alone exposes nobody', () => {
    vi.stubEnv('MCP_ENABLED', '1')
    vi.stubEnv('MCP_AGENCY_ALLOWLIST', '')
    expect(canUseMcp(5)).toBe(false)
  })

  it('allowlist by id or all', () => {
    vi.stubEnv('MCP_ENABLED', '1')
    vi.stubEnv('MCP_AGENCY_ALLOWLIST', '103, 7')
    expect(canUseMcp(103)).toBe(true)
    expect(canUseMcp(7)).toBe(true)
    expect(canUseMcp(8)).toBe(false)
    vi.stubEnv('MCP_AGENCY_ALLOWLIST', 'all')
    expect(canUseMcp(8)).toBe(true)
  })

  it('ignores junk allowlist entries and never matches a missing agency', () => {
    vi.stubEnv('MCP_ENABLED', '1')
    vi.stubEnv('MCP_AGENCY_ALLOWLIST', 'abc, -3, 0, 12')
    expect(isMcpAgencyAllowlisted(12)).toBe(true)
    expect(isMcpAgencyAllowlisted(0)).toBe(false)
    expect(canUseMcp(null)).toBe(false)
    expect(canUseMcp(undefined)).toBe(false)
    expect(canUseMcp(0)).toBe(false)
  })

  it('reads env per call (kill switch works without a redeploy)', () => {
    vi.stubEnv('MCP_ENABLED', '1')
    vi.stubEnv('MCP_AGENCY_ALLOWLIST', 'all')
    expect(canUseMcp(1)).toBe(true)
    vi.stubEnv('MCP_ENABLED', '0')
    expect(canUseMcp(1)).toBe(false)
  })
})
