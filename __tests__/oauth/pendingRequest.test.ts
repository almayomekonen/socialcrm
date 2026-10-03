import { describe, it, expect, vi, afterEach } from 'vitest'
import { SignJWT, decodeJwt, decodeProtectedHeader } from 'jose'
import {
  signPendingRequest,
  verifyPendingRequest,
  pendingCookieOptions,
  PENDING_COOKIE,
  PENDING_TTL_SECONDS,
  type PendingAuthorization,
} from '@/lib/oauth/server/pendingRequest'
import { signMcpAccessToken, verifyMcpAccessToken } from '@/lib/oauth/server/accessToken'

export const P = {
  clientId: 'https://chatgpt.com/oauth/client.json',
  clientName: 'ChatGPT',
  redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect',
  codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  scopes: ['crm.leads.read', 'crm.conversations.read'] as PendingAuthorization['scopes'],
  resource: 'https://crm.test/api/mcp',
  state: 'st-123',
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

/** Re-sign an edited payload with the real key, to prove validation does not trust content just because it is signed. */
async function resign(token: string, edit: (p: Record<string, unknown>) => void, header?: Record<string, unknown>) {
  const p = decodeJwt(token) as Record<string, unknown>
  edit(p)
  return new SignJWT(p)
    .setProtectedHeader((header ?? decodeProtectedHeader(token)) as never)
    .sign(new TextEncoder().encode(process.env.MCP_JWT_SECRET!))
}

describe('pending authorization cookie — round trip', () => {
  it('round-trips and adds a UUID jti and a csrf token', async () => {
    const { token, pending } = await signPendingRequest(P)
    expect(pending.jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(pending.csrf).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(await verifyPendingRequest(token)).toEqual(pending)
  })

  it('accepts a null state', async () => {
    const { token } = await signPendingRequest({ ...P, state: null })
    expect((await verifyPendingRequest(token))!.state).toBeNull()
  })

  it('each request gets its own jti and csrf', async () => {
    const a = await signPendingRequest(P)
    const b = await signPendingRequest(P)
    expect(a.pending.jti).not.toBe(b.pending.jti)
    expect(a.pending.csrf).not.toBe(b.pending.csrf)
  })

  it('has a dedicated header typ and holds only the OAuth resume state', async () => {
    const { token } = await signPendingRequest(P)
    expect(decodeProtectedHeader(token)).toEqual({ alg: 'HS256', typ: 'oauth-pending+jwt' })
    expect(Object.keys(decodeJwt(token)).sort()).toEqual(
      [
        'aud',
        'clientId',
        'clientName',
        'codeChallenge',
        'csrf',
        'exp',
        'iat',
        'iss',
        'jti',
        'redirectUri',
        'resource',
        'scopes',
        'state',
        'typ',
      ].sort(),
    )
    const raw = JSON.stringify(decodeJwt(token)).toLowerCase()
    for (const word of ['access_token', 'refresh', 'password', 'session', 'email', 'phone']) expect(raw).not.toContain(word)
  })

  it('lives exactly 10 minutes', async () => {
    expect(PENDING_TTL_SECONDS).toBe(600)
    const p = decodeJwt((await signPendingRequest(P)).token)
    expect(p.exp! - p.iat!).toBe(600)
  })
})

describe('pending authorization cookie — fails closed', () => {
  it('expires after the TTL (plus the 30 s tolerance)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-03T12:00:00Z'))
    const { token } = await signPendingRequest(P)
    vi.setSystemTime(new Date('2026-10-03T12:09:59Z'))
    expect(await verifyPendingRequest(token)).not.toBeNull()
    vi.setSystemTime(new Date('2026-10-03T12:10:31Z'))
    expect(await verifyPendingRequest(token)).toBeNull()
  })

  it('rejects a bad signature, a foreign key and unsigned tokens', async () => {
    const { token } = await signPendingRequest(P)
    const [h, p, s] = token.split('.')
    expect(await verifyPendingRequest(`${h}.${p}.${s.slice(0, -2)}${s.endsWith('AA') ? 'BB' : 'AA'}`)).toBeNull()
    const foreign = await new SignJWT(decodeJwt(token))
      .setProtectedHeader({ alg: 'HS256', typ: 'oauth-pending+jwt' })
      .sign(new TextEncoder().encode(process.env.MOBILE_JWT_SECRET!))
    expect(await verifyPendingRequest(foreign)).toBeNull()
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'oauth-pending+jwt' })).toString('base64url')}.${p}.`
    expect(await verifyPendingRequest(none)).toBeNull()
  })

  it('rejects malformed values without throwing', async () => {
    for (const bad of [undefined, null, '', 'abc', 'a.b.c', '...', 'x'.repeat(10_000)]) {
      expect(await verifyPendingRequest(bad as string | null | undefined)).toBeNull()
    }
  })

  it('is not interchangeable with an MCP access token, in either direction', async () => {
    const access = await signMcpAccessToken({
      userId: 1,
      agencyId: 1,
      grantId: 1,
      sessionVersion: 0,
      scopes: ['crm.leads.read'],
      clientId: P.clientId,
    })
    expect(await verifyPendingRequest(access)).toBeNull()
    expect(await verifyMcpAccessToken((await signPendingRequest(P)).token)).toBeNull()
  })

  it.each([
    ['missing clientId', (p: Record<string, unknown>) => delete p.clientId],
    ['missing redirectUri', (p: Record<string, unknown>) => delete p.redirectUri],
    ['missing codeChallenge', (p: Record<string, unknown>) => delete p.codeChallenge],
    ['missing csrf', (p: Record<string, unknown>) => delete p.csrf],
    ['missing resource', (p: Record<string, unknown>) => delete p.resource],
    ['missing scopes', (p: Record<string, unknown>) => delete p.scopes],
    ['missing state key', (p: Record<string, unknown>) => delete p.state],
    ['wrong typ claim', (p: Record<string, unknown>) => (p.typ = 'mcp_access')],
    ['wrong issuer', (p: Record<string, unknown>) => (p.iss = 'https://evil.test')],
    ['wrong audience', (p: Record<string, unknown>) => (p.aud = 'https://crm.test/api/mcp')],
    ['non-uuid jti', (p: Record<string, unknown>) => (p.jti = 'abc')],
    ['unknown scope (not filtered — rejected)', (p: Record<string, unknown>) => (p.scopes = ['crm.leads.read', 'full_access'])],
    ['empty scopes', (p: Record<string, unknown>) => (p.scopes = [])],
    ['scopes as string', (p: Record<string, unknown>) => (p.scopes = 'crm.leads.read')],
    ['wrong resource', (p: Record<string, unknown>) => (p.resource = 'https://evil.test/api/mcp')],
    ['client id on an untrusted host', (p: Record<string, unknown>) => (p.clientId = 'https://evil.com/c.json')],
    ['client id over http', (p: Record<string, unknown>) => (p.clientId = 'http://chatgpt.com/oauth/client.json')],
    ['empty client name', (p: Record<string, unknown>) => (p.clientName = '')],
    ['control chars in client name', (p: Record<string, unknown>) => (p.clientName = 'Chat\u0007GPT')],
    ['javascript redirect', (p: Record<string, unknown>) => (p.redirectUri = 'javascript:alert(1)')],
    ['http redirect', (p: Record<string, unknown>) => (p.redirectUri = 'http://chatgpt.com/cb')],
    ['protocol-relative redirect', (p: Record<string, unknown>) => (p.redirectUri = '//evil.com/cb')],
    ['redirect with fragment', (p: Record<string, unknown>) => (p.redirectUri = 'https://chatgpt.com/cb#x')],
    ['malformed code challenge', (p: Record<string, unknown>) => (p.codeChallenge = 'short')],
    ['overlong state', (p: Record<string, unknown>) => (p.state = 'x'.repeat(513))],
    ['numeric state', (p: Record<string, unknown>) => (p.state = 5)],
    ['malformed csrf', (p: Record<string, unknown>) => (p.csrf = 'a b')],
  ])('rejects %s even when correctly signed', async (_n, edit) => {
    const { token } = await signPendingRequest(P)
    expect(await verifyPendingRequest(await resign(token, edit))).toBeNull()
  })

  it('rejects a wrong header typ even when correctly signed', async () => {
    const { token } = await signPendingRequest(P)
    expect(await verifyPendingRequest(await resign(token, () => undefined, { alg: 'HS256', typ: 'JWT' }))).toBeNull()
    expect(await verifyPendingRequest(await resign(token, () => undefined, { alg: 'HS256', typ: 'at+jwt' }))).toBeNull()
  })

  it('fails closed when MCP_JWT_SECRET is unusable', async () => {
    const { token } = await signPendingRequest(P)
    vi.stubEnv('MCP_JWT_SECRET', 'short')
    expect(await verifyPendingRequest(token)).toBeNull()
    await expect(signPendingRequest(P)).rejects.toThrow(/MCP_JWT_SECRET/)
  })

  it('refuses to sign invalid resume state', async () => {
    await expect(signPendingRequest({ ...P, scopes: ['full_access'] as never })).rejects.toThrow()
    await expect(signPendingRequest({ ...P, redirectUri: 'javascript:x' })).rejects.toThrow()
    await expect(signPendingRequest({ ...P, resource: 'https://evil.test/api/mcp' })).rejects.toThrow()
  })
})

describe('pending authorization cookie — cookie attributes', () => {
  it('is HttpOnly, SameSite=Lax, path /, 10 minutes, Secure outside development', () => {
    expect(PENDING_COOKIE).toBe('scrm_oauth_pending')
    expect(pendingCookieOptions()).toEqual({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600 })
    vi.stubEnv('NODE_ENV', 'production')
    expect(pendingCookieOptions().secure).toBe(true)
    vi.stubEnv('NODE_ENV', 'development')
    expect(pendingCookieOptions().secure).toBe(false)
  })
})

describe('pending authorization cookie — Claude', () => {
  it('round-trips a Claude resume state (claude.ai is a default trusted client host)', async () => {
    const { token, pending } = await signPendingRequest({
      clientId: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
      clientName: 'Claude',
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      scopes: ['crm.leads.read' as const, 'crm.conversations.read' as const],
      resource: 'https://crm.test/api/mcp',
      state: 'claude-state',
    })
    expect(await verifyPendingRequest(token)).toEqual(pending)
    expect(pending).toMatchObject({ clientName: 'Claude', redirectUri: 'https://claude.ai/api/mcp/auth_callback' })
  })

  it('still rejects a look-alike Claude client id', async () => {
    await expect(
      signPendingRequest({
        ...{
          clientId: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
          clientName: 'Claude',
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
          scopes: ['crm.leads.read' as const, 'crm.conversations.read' as const],
          resource: 'https://crm.test/api/mcp',
          state: 'claude-state',
        },
        clientId: 'https://claude.ai.evil.com/x.json',
      }),
    ).rejects.toThrow()
  })
})
