import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/deviceOverride', () => ({
  DEVICE_OVERRIDE_HEADER: 'x-device-override',
  DEVICE_OVERRIDE_PARAM: 'device',
  isDeviceOverrideAllowed: () => false,
  parseDeviceOverride: () => null,
}))

import { proxy, OAUTH_DISCOVERY_PATHS } from '@/proxy'

const anon = (p: string) => new NextRequest(new URL(p, 'https://crm.test'))
const signedIn = (p: string) => new NextRequest(new URL(p, 'https://crm.test'), { headers: { cookie: 'user=session-jwt' } })
const isAuthRedirect = (res: Response) => res.status === 302 && (res.headers.get('location') ?? '').endsWith('/auth')

describe('proxy discovery exception (D3)', () => {
  it('is an exact allowlist of the three discovery documents', () => {
    expect([...OAUTH_DISCOVERY_PATHS].sort()).toEqual([
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/api/mcp',
    ])
  })

  it.each([...OAUTH_DISCOVERY_PATHS])('%s passes through without a session', async (p) => {
    const res = await proxy(anon(p))
    expect(isAuthRedirect(res)).toBe(false)
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('a query string on an allowed path does not change the decision', async () => {
    expect(isAuthRedirect(await proxy(anon('/.well-known/oauth-authorization-server?x=1')))).toBe(false)
  })

  it.each([
    '/.well-known/openid-configuration',
    '/.well-known/oauth-authorization-server/',
    '/.well-known/oauth-authorization-server/extra',
    '/.well-known/oauth-authorization-server.json',
    '/.well-known/oauth-protected-resource/',
    '/.well-known/oauth-protected-resource/api/mcp/',
    '/.well-known/oauth-protected-resource/api/mcp/tools',
    '/.well-known/oauth-protected-resource/api',
    '/.well-known/OAUTH-AUTHORIZATION-SERVER',
    '/.well-known/security.txt',
    '/.well-known/',
    '/.well-known',
    '/oauth/consent',
    '/dashboard',
  ])('%s still redirects to /auth without a session (existing behaviour)', async (p) => {
    expect(isAuthRedirect(await proxy(anon(p)))).toBe(true)
  })

  it('does not change behaviour for signed-in users or existing public routes', async () => {
    expect(isAuthRedirect(await proxy(signedIn('/.well-known/oauth-authorization-server')))).toBe(false)
    expect(isAuthRedirect(await proxy(signedIn('/dashboard')))).toBe(false)
    expect(isAuthRedirect(await proxy(anon('/')))).toBe(false)
    expect(isAuthRedirect(await proxy(anon('/pricing')))).toBe(false)
  })
})
