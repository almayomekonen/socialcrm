import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  buildAuthorizationRedirect,
  readAuthorizationResponseIssuer,
  ISS_PARAMETER_SUPPORTED,
} from '@/lib/oauth/server/authorizeResponse'
import { issuer } from '@/lib/oauth/server/config'

const R = 'https://chatgpt.com/connector_platform_oauth_redirect'
const ERRORS = [
  'access_denied',
  'invalid_request',
  'invalid_scope',
  'invalid_target',
  'unsupported_response_type',
  'server_error',
  'temporarily_unavailable',
] as const

afterEach(() => vi.unstubAllEnvs())

describe('RFC 9207 iss on every authorization response', () => {
  it('advertises support only as a constant owned by the builder module', () => {
    expect(ISS_PARAMETER_SUPPORTED).toBe(true)
  })

  it('correct issuer: a success response carries iss === published issuer', () => {
    const url = buildAuthorizationRedirect(R, { code: 'abc', state: 's1' })
    const u = new URL(url)
    expect(u.searchParams.get('iss')).toBe(issuer())
    expect(u.searchParams.get('iss')).toBe('https://crm.test')
    expect(u.searchParams.get('code')).toBe('abc')
    expect(u.searchParams.get('state')).toBe('s1')
    expect(readAuthorizationResponseIssuer(url, issuer())).toEqual({ ok: true })
  })

  it.each(ERRORS)('correct issuer: the %s error response carries iss too', (error) => {
    const url = buildAuthorizationRedirect(R, { error, error_description: 'x', state: 's' })
    const u = new URL(url)
    expect(u.searchParams.get('iss')).toBe(issuer())
    expect(u.searchParams.get('error')).toBe(error)
    expect(readAuthorizationResponseIssuer(url, issuer())).toEqual({ ok: true })
  })

  it('missing issuer is detected', () => {
    const u = new URL(buildAuthorizationRedirect(R, { code: 'abc' }))
    u.searchParams.delete('iss')
    expect(readAuthorizationResponseIssuer(u.toString(), issuer())).toEqual({ ok: false, reason: 'missing' })
  })

  it('mismatched issuer is detected', () => {
    const u = new URL(buildAuthorizationRedirect(R, { code: 'abc' }))
    u.searchParams.set('iss', 'https://evil.test')
    expect(readAuthorizationResponseIssuer(u.toString(), issuer())).toEqual({ ok: false, reason: 'mismatch' })
    // Exact comparison: a trailing slash or case variant is a mismatch, not "close enough".
    u.searchParams.set('iss', 'https://crm.test/')
    expect(readAuthorizationResponseIssuer(u.toString(), issuer())).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('a caller cannot inject or override iss', () => {
    expect(() => buildAuthorizationRedirect(R, { code: 'abc', iss: 'https://evil.test' } as never)).toThrow(/iss/)
    expect(() => buildAuthorizationRedirect(R, { error: 'access_denied', iss: undefined } as never)).toThrow(/iss/)
  })

  it('a registered redirect_uri that already carries iss/code/error is overridden by the server values', () => {
    const u = new URL(buildAuthorizationRedirect(`${R}?iss=https://evil.test&code=old`, { error: 'access_denied' }))
    expect(u.searchParams.getAll('iss')).toEqual(['https://crm.test'])
    expect(u.searchParams.has('code')).toBe(false)
  })

  it('only OAuth authorization-response parameters can be set (no generic redirect helper)', () => {
    expect(() => buildAuthorizationRedirect(R, { code: 'abc', next: 'https://evil.test' } as never)).toThrow()
    expect(() => buildAuthorizationRedirect(R, { code: 'abc', error: 'access_denied' } as never)).toThrow()
    expect(() => buildAuthorizationRedirect(R, {} as never)).toThrow()
    expect(() => buildAuthorizationRedirect(R, { error: 'not_a_code' } as never)).toThrow()
  })

  it('refuses a redirect_uri that is not an absolute https URL without fragment', () => {
    expect(() => buildAuthorizationRedirect('/relative', { code: 'c' })).toThrow()
    expect(() => buildAuthorizationRedirect('javascript:alert(1)', { code: 'c' })).toThrow()
    expect(() => buildAuthorizationRedirect(`${R}#frag`, { code: 'c' })).toThrow()
  })

  it('omits a null/absent state rather than sending "null"', () => {
    const u = new URL(buildAuthorizationRedirect(R, { code: 'c', state: null }))
    expect(u.searchParams.has('state')).toBe(false)
  })

  it('issuer stays identical when the configured origin is written differently', () => {
    vi.stubEnv('MCP_PUBLIC_ORIGIN', 'HTTPS://CRM.TEST/')
    expect(new URL(buildAuthorizationRedirect(R, { code: 'c' })).searchParams.get('iss')).toBe('https://crm.test')
  })

  it('preserves existing unrelated query params of the registered redirect_uri', () => {
    const u = new URL(buildAuthorizationRedirect(`${R}?tenant=1`, { code: 'c' }))
    expect(u.searchParams.get('tenant')).toBe('1')
    expect(u.origin + u.pathname).toBe(R)
  })
})
