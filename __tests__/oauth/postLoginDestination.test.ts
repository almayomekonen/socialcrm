import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ cookieGet: vi.fn(), cookies: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: h.cookies }))

import { postLoginDestination, postLoginDestinationFromCookie, OAUTH_CONSENT_PATH } from '@/lib/oauth/server/postLoginDestination'
import { signPendingRequest, PENDING_COOKIE } from '@/lib/oauth/server/pendingRequest'
import { SignJWT, decodeJwt } from 'jose'

const P = {
  clientId: 'https://chatgpt.com/oauth/client.json',
  clientName: 'ChatGPT',
  redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect',
  codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  scopes: ['crm.leads.read' as const],
  resource: 'https://crm.test/api/mcp',
  state: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.cookies.mockResolvedValue({ get: h.cookieGet })
  vi.stubEnv('MCP_ENABLED', '1')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('post-login destination (D1)', () => {
  it('the consent path is a fixed internal constant', () => {
    expect(OAUTH_CONSENT_PATH).toBe('/oauth/consent')
  })

  it('no pending request → /dashboard', async () => {
    expect(await postLoginDestinationFromCookie(undefined)).toBe('/dashboard')
    expect(await postLoginDestinationFromCookie(null)).toBe('/dashboard')
    expect(await postLoginDestinationFromCookie('')).toBe('/dashboard')
  })

  it('valid pending request → /oauth/consent', async () => {
    const { token } = await signPendingRequest(P)
    expect(await postLoginDestinationFromCookie(token)).toBe('/oauth/consent')
  })

  it('expired request → /dashboard', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-03T12:00:00Z'))
    const { token } = await signPendingRequest(P)
    vi.setSystemTime(new Date('2026-10-03T12:11:00Z'))
    expect(await postLoginDestinationFromCookie(token)).toBe('/dashboard')
  })

  it('invalid signature → /dashboard', async () => {
    const { token } = await signPendingRequest(P)
    expect(await postLoginDestinationFromCookie(token.slice(0, -3) + 'xyz')).toBe('/dashboard')
  })

  it('malformed request → /dashboard', async () => {
    for (const bad of ['a.b.c', 'not-a-jwt', '{"x":1}', 'x'.repeat(5000)]) {
      expect(await postLoginDestinationFromCookie(bad)).toBe('/dashboard')
    }
  })

  it('a URL inside the pending payload can never become the destination', async () => {
    // Even validly signed, with hostile URLs in every field that holds one.
    const { token } = await signPendingRequest({ ...P, redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect' })
    const p = decodeJwt(token) as Record<string, unknown>
    const hostile = await new SignJWT({
      ...p,
      redirectUri: 'https://evil.test/steal',
      returnTo: '//evil.test',
      next: 'https://evil.test',
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'oauth-pending+jwt' })
      .sign(new TextEncoder().encode(process.env.MCP_JWT_SECRET!))
    const dest = await postLoginDestinationFromCookie(hostile)
    expect(['/dashboard', '/oauth/consent']).toContain(dest)
    expect(dest).not.toContain('evil')
  })

  it('MCP disabled → /dashboard even with a valid pending request', async () => {
    const { token } = await signPendingRequest(P)
    for (const v of ['', '0', 'true']) {
      vi.stubEnv('MCP_ENABLED', v)
      expect(await postLoginDestinationFromCookie(token)).toBe('/dashboard')
    }
  })

  it('normal login does not depend on MCP_ENABLED: no pending cookie → /dashboard either way', async () => {
    for (const v of ['1', '', '0']) {
      vi.stubEnv('MCP_ENABLED', v)
      expect(await postLoginDestinationFromCookie(undefined)).toBe('/dashboard')
    }
  })

  it('never throws: an unusable MCP key falls back to /dashboard', async () => {
    const { token } = await signPendingRequest(P)
    vi.stubEnv('MCP_JWT_SECRET', '')
    expect(await postLoginDestinationFromCookie(token)).toBe('/dashboard')
  })
})

describe('postLoginDestination() reads the request cookie', () => {
  it('reads exactly the pending cookie and does not modify the cookie store', async () => {
    const { token } = await signPendingRequest(P)
    const store = { get: vi.fn(() => ({ value: token })), set: vi.fn(), delete: vi.fn() }
    h.cookies.mockResolvedValue(store)
    expect(await postLoginDestination()).toBe('/oauth/consent')
    expect(store.get).toHaveBeenCalledWith(PENDING_COOKIE)
    expect(store.set).not.toHaveBeenCalled()
    expect(store.delete).not.toHaveBeenCalled()
  })

  it('does not touch cookies at all when MCP is disabled', async () => {
    vi.stubEnv('MCP_ENABLED', '')
    expect(await postLoginDestination()).toBe('/dashboard')
    expect(h.cookies).not.toHaveBeenCalled()
  })

  it('falls back to /dashboard if reading cookies throws', async () => {
    h.cookies.mockRejectedValue(new Error('no request scope'))
    expect(await postLoginDestination()).toBe('/dashboard')
  })
})
