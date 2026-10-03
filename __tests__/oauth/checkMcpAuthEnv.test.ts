import { describe, it, expect, vi, afterEach } from 'vitest'
import { checkMcpAuthEnv, assertMcpAuthEnv } from '@/lib/startup/checkMcpAuthEnv'

const good = {
  MCP_ENABLED: '1',
  MCP_JWT_SECRET: 'x'.repeat(40),
  JWT_SECRET: 'j'.repeat(40),
  MOBILE_JWT_SECRET: 'm'.repeat(40),
  MCP_PUBLIC_ORIGIN: 'https://getsocialcrm.com',
  MCP_AGENCY_ALLOWLIST: '103',
  NODE_ENV: 'production',
} as unknown as NodeJS.ProcessEnv

afterEach(() => vi.restoreAllMocks())

describe('checkMcpAuthEnv', () => {
  it('is silent when MCP is disabled, whatever else is set', () => {
    expect(checkMcpAuthEnv({ NODE_ENV: 'production' } as unknown as NodeJS.ProcessEnv)).toEqual({ status: 'ok', issues: [] })
    expect(checkMcpAuthEnv({ ...good, MCP_ENABLED: 'true', MCP_JWT_SECRET: '' }).status).toBe('ok')
  })

  it('accepts a complete config', () => {
    expect(checkMcpAuthEnv(good)).toEqual({ status: 'ok', issues: [] })
  })

  it('is fatal on a missing or short secret (31 chars)', () => {
    expect(checkMcpAuthEnv({ ...good, MCP_JWT_SECRET: undefined }).status).toBe('fatal')
    expect(checkMcpAuthEnv({ ...good, MCP_JWT_SECRET: 'x'.repeat(31) }).status).toBe('fatal')
    expect(checkMcpAuthEnv({ ...good, MCP_JWT_SECRET: 'x'.repeat(32) }).status).toBe('ok')
  })

  it('is fatal when the secret equals JWT_SECRET or MOBILE_JWT_SECRET', () => {
    const shared = 's'.repeat(40)
    expect(checkMcpAuthEnv({ ...good, MCP_JWT_SECRET: shared, JWT_SECRET: shared }).status).toBe('fatal')
    expect(checkMcpAuthEnv({ ...good, MCP_JWT_SECRET: shared, MOBILE_JWT_SECRET: shared }).status).toBe('fatal')
  })

  it('is fatal on a bad or missing public origin', () => {
    expect(checkMcpAuthEnv({ ...good, MCP_PUBLIC_ORIGIN: 'http://getsocialcrm.com' }).status).toBe('fatal')
    expect(checkMcpAuthEnv({ ...good, MCP_PUBLIC_ORIGIN: 'https://getsocialcrm.com/app' }).status).toBe('fatal')
    expect(checkMcpAuthEnv({ ...good, MCP_PUBLIC_ORIGIN: undefined }).status).toBe('fatal')
  })

  it('warns (not fatal) when enabled with an empty allowlist', () => {
    const r = checkMcpAuthEnv({ ...good, MCP_AGENCY_ALLOWLIST: '' })
    expect(r.status).toBe('warn')
    expect(r.issues.map((i) => i.variable)).toEqual(['MCP_AGENCY_ALLOWLIST'])
  })

  it('never puts a secret value into an issue message', () => {
    const secret = 'super-secret-value-that-is-31ch'
    const r = checkMcpAuthEnv({ ...good, MCP_JWT_SECRET: secret })
    expect(JSON.stringify(r)).not.toContain(secret)
  })
})

describe('assertMcpAuthEnv', () => {
  it('throws in production on a fatal config', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => assertMcpAuthEnv({ ...good, MCP_JWT_SECRET: 'short' })).toThrow(/MCP authentication is misconfigured/)
  })

  it('only logs outside production', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => assertMcpAuthEnv({ ...good, NODE_ENV: 'development', MCP_JWT_SECRET: 'short' })).not.toThrow()
    expect(err).toHaveBeenCalledWith(expect.stringContaining('[startup/mcp-auth] MCP_JWT_SECRET'))
  })

  it('is silent and does not throw when MCP is off', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(() => assertMcpAuthEnv({ NODE_ENV: 'production' } as unknown as NodeJS.ProcessEnv)).not.toThrow()
    expect(err).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })
})
