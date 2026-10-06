import { describe, it, expect, vi, afterEach } from 'vitest'
import { SignJWT, decodeJwt, decodeProtectedHeader, generateKeyPair } from 'jose'
import { signMcpAccessToken, verifyMcpAccessToken, ACCESS_TOKEN_TTL_SECONDS } from '@/lib/oauth/server/accessToken'

const base = {
  userId: 7,
  agencyId: 3,
  grantId: 9,
  sessionVersion: 2,
  scopes: ['crm.leads.read', 'crm.conversations.read'],
  clientId: 'https://chatgpt.com/oauth/client.json',
}
const enc = (s: string) => new TextEncoder().encode(s)
const mcpKey = () => enc(process.env.MCP_JWT_SECRET!)

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

/** A token with the exact production shape, every part overridable. */
async function forge(
  over: Record<string, unknown> = {},
  opts: { header?: Record<string, unknown>; key?: Uint8Array; omit?: string[] } = {},
) {
  const now = Math.floor(Date.now() / 1000)
  const claims: Record<string, unknown> = {
    iss: 'https://crm.test',
    aud: 'https://crm.test/api/mcp',
    sub: '7',
    jti: '6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b',
    iat: now,
    nbf: now,
    exp: now + 60,
    typ: 'mcp_access',
    agency: 3,
    gid: 9,
    sv: 2,
    scope: 'crm.leads.read',
    client_id: base.clientId,
    ...over,
  }
  for (const k of opts.omit ?? []) delete claims[k]
  return new SignJWT(claims)
    .setProtectedHeader((opts.header ?? { alg: 'HS256', typ: 'at+jwt' }) as never)
    .sign(opts.key ?? mcpKey())
}

describe('MCP access token — signing', () => {
  it('round-trips every claim', async () => {
    const t = await signMcpAccessToken(base)
    const c = await verifyMcpAccessToken(t)
    expect(c).toMatchObject(base)
    expect(c!.jti).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('has the exact header and claim shape, and nothing else', async () => {
    const t = await signMcpAccessToken(base)
    expect(decodeProtectedHeader(t)).toEqual({ alg: 'HS256', typ: 'at+jwt' })
    const p = decodeJwt(t)
    expect(Object.keys(p).sort()).toEqual([
      'agency',
      'aud',
      'client_id',
      'exp',
      'gid',
      'iat',
      'iss',
      'jti',
      'nbf',
      'scope',
      'sub',
      'sv',
      'typ',
    ])
    expect(p).toMatchObject({
      iss: 'https://crm.test',
      aud: 'https://crm.test/api/mcp',
      sub: '7',
      typ: 'mcp_access',
      agency: 3,
      gid: 9,
      sv: 2,
      scope: 'crm.leads.read crm.conversations.read',
      client_id: base.clientId,
    })
  })

  it('lives exactly 15 minutes (exp - iat === 900, nbf === iat)', async () => {
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(900)
    const before = Math.floor(Date.now() / 1000)
    const p = decodeJwt(await signMcpAccessToken(base))
    const after = Math.floor(Date.now() / 1000)
    expect(p.exp! - p.iat!).toBe(900)
    expect(p.nbf).toBe(p.iat)
    expect(p.iat!).toBeGreaterThanOrEqual(before)
    expect(p.iat!).toBeLessThanOrEqual(after)
  })

  it('is valid just before expiry and invalid just after it (beyond the 30 s tolerance)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-03T12:00:00Z'))
    const t = await signMcpAccessToken(base)
    vi.setSystemTime(new Date('2026-10-03T12:14:59Z'))
    expect(await verifyMcpAccessToken(t)).not.toBeNull()
    vi.setSystemTime(new Date('2026-10-03T12:15:31Z'))
    expect(await verifyMcpAccessToken(t)).toBeNull()
  })

  it('issues a unique jti per token', async () => {
    const jtis = new Set<string>()
    for (let i = 0; i < 20; i++) jtis.add(decodeJwt(await signMcpAccessToken(base)).jti!)
    expect(jtis.size).toBe(20)
  })

  it('carries no PII, names, secrets or refresh-token identifiers', async () => {
    const t = await signMcpAccessToken(base)
    const payload = decodeJwt(t) as Record<string, unknown>
    // Claim NAMES: none may describe personal, CRM or credential data.
    const keys = Object.keys(payload).join(' ').toLowerCase()
    // Claim VALUES other than `scope` (whose fixed names say "leads"/"conversations").
    const { scope: _scope, ...rest } = payload
    const values = JSON.stringify(Object.values(rest)).toLowerCase()
    for (const word of ['phone', 'email', 'name', 'lead', 'conversation', 'refresh', 'family', 'secret', 'password']) {
      expect(keys).not.toContain(word)
      expect(values).not.toContain(word)
    }
    expect(JSON.stringify(payload)).not.toContain(process.env.MCP_JWT_SECRET!)
    expect(JSON.stringify(decodeProtectedHeader(t))).not.toContain(process.env.MCP_JWT_SECRET!)
  })

  it('refuses to sign unknown scopes, an empty scope list or invalid ids', async () => {
    await expect(signMcpAccessToken({ ...base, scopes: ['full_access'] })).rejects.toThrow()
    await expect(signMcpAccessToken({ ...base, scopes: [] })).rejects.toThrow()
    await expect(signMcpAccessToken({ ...base, userId: 0 })).rejects.toThrow()
    await expect(signMcpAccessToken({ ...base, grantId: 1.5 })).rejects.toThrow()
    await expect(signMcpAccessToken({ ...base, sessionVersion: -1 })).rejects.toThrow()
    await expect(signMcpAccessToken({ ...base, clientId: '' })).rejects.toThrow()
  })
})

describe('MCP access token — secret separation (fail closed)', () => {
  it('throws on sign and returns null on verify when MCP_JWT_SECRET is missing or short', async () => {
    const t = await signMcpAccessToken(base)
    for (const bad of ['', 'x'.repeat(31)]) {
      vi.stubEnv('MCP_JWT_SECRET', bad)
      await expect(signMcpAccessToken(base)).rejects.toThrow(/MCP_JWT_SECRET/)
      expect(await verifyMcpAccessToken(t)).toBeNull()
    }
  })

  it('fails closed when MCP_JWT_SECRET equals JWT_SECRET or MOBILE_JWT_SECRET', async () => {
    for (const other of ['JWT_SECRET', 'MOBILE_JWT_SECRET']) {
      vi.stubEnv(other, process.env.MCP_JWT_SECRET!)
      await expect(signMcpAccessToken(base)).rejects.toThrow(/MCP_JWT_SECRET/)
      vi.unstubAllEnvs()
    }
  })

  it('rejects a token signed with JWT_SECRET (web session key)', async () => {
    vi.stubEnv('JWT_SECRET', 'web-session-key-for-this-test-only-xxxxxxxxxxxx')
    expect(await verifyMcpAccessToken(await forge({}, { key: enc(process.env.JWT_SECRET!) }))).toBeNull()
  })

  it('rejects a token signed with MOBILE_JWT_SECRET', async () => {
    expect(await verifyMcpAccessToken(await forge({}, { key: enc(process.env.MOBILE_JWT_SECRET!) }))).toBeNull()
  })

  it('rejects a token with a tampered signature', async () => {
    const t = await signMcpAccessToken(base)
    const [h, p, s] = t.split('.')
    const flipped = s.slice(0, -2) + (s.endsWith('AA') ? 'BB' : 'AA')
    expect(await verifyMcpAccessToken(`${h}.${p}.${flipped}`)).toBeNull()
  })

  it('rejects a token whose payload was edited after signing', async () => {
    const t = await signMcpAccessToken(base)
    const [h, , s] = t.split('.')
    const forged = Buffer.from(JSON.stringify({ ...decodeJwt(t), agency: 999 })).toString('base64url')
    expect(await verifyMcpAccessToken(`${h}.${forged}.${s}`)).toBeNull()
  })
})

describe('MCP access token — algorithm', () => {
  it('rejects alg none (unsigned)', async () => {
    const h = Buffer.from(JSON.stringify({ alg: 'none', typ: 'at+jwt' })).toString('base64url')
    const p = Buffer.from(JSON.stringify(decodeJwt(await forge()))).toString('base64url')
    expect(await verifyMcpAccessToken(`${h}.${p}.`)).toBeNull()
  })

  it('rejects HS512 with the right key', async () => {
    expect(await verifyMcpAccessToken(await forge({}, { header: { alg: 'HS512', typ: 'at+jwt' } }))).toBeNull()
  })

  it('rejects RS256 (asymmetric) tokens', async () => {
    const { privateKey } = await generateKeyPair('RS256')
    const now = Math.floor(Date.now() / 1000)
    const t = await new SignJWT({
      typ: 'mcp_access',
      agency: 3,
      gid: 9,
      sv: 2,
      scope: 'crm.leads.read',
      client_id: base.clientId,
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt' })
      .setIssuer('https://crm.test')
      .setAudience('https://crm.test/api/mcp')
      .setSubject('7')
      .setJti('6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b')
      .setIssuedAt(now)
      .setNotBefore(now)
      .setExpirationTime(now + 60)
      .sign(privateKey)
    expect(await verifyMcpAccessToken(t)).toBeNull()
  })

  it('rejects a missing or wrong header typ', async () => {
    expect(await verifyMcpAccessToken(await forge({}, { header: { alg: 'HS256' } }))).toBeNull()
    expect(await verifyMcpAccessToken(await forge({}, { header: { alg: 'HS256', typ: 'JWT' } }))).toBeNull()
  })
})

describe('MCP access token — claim validation', () => {
  it('accepts the forged baseline (control case)', async () => {
    expect(await verifyMcpAccessToken(await forge())).toMatchObject({ userId: 7, agencyId: 3, grantId: 9, sessionVersion: 2 })
  })

  it.each([
    ['wrong issuer', { iss: 'https://evil.test' }],
    ['issuer with trailing slash', { iss: 'https://crm.test/' }],
    ['wrong audience', { aud: 'https://crm.test/other' }],
    ['audience is the issuer', { aud: 'https://crm.test' }],
    ['audience array without ours', { aud: ['https://other.test/api/mcp'] }],
    ['wrong typ claim', { typ: 'mobile_access' }],
    ['session typ claim', { typ: 'session' }],
    ['expired', { exp: Math.floor(Date.now() / 1000) - 120 }],
    ['not yet valid', { nbf: Math.floor(Date.now() / 1000) + 600 }],
    ['non-numeric sub', { sub: 'abc' }],
    ['zero sub', { sub: '0' }],
    ['negative sub', { sub: '-4' }],
    ['fractional sub', { sub: '7.5' }],
    ['string agency', { agency: '3' }],
    ['zero agency', { agency: 0 }],
    ['fractional grant', { gid: 9.5 }],
    ['negative sessionVersion', { sv: -1 }],
    ['string sessionVersion', { sv: '2' }],
    ['unknown scope', { scope: 'crm.leads.read full_access' }],
    ['write scope not in Phase A', { scope: 'crm.leads.status.write' }],
    ['empty scope', { scope: '' }],
    ['array scope', { scope: ['crm.leads.read'] }],
    ['empty client_id', { client_id: '' }],
    ['numeric client_id', { client_id: 5 }],
    ['non-uuid jti', { jti: 'abc' }],
  ])('rejects %s', async (_n, over) => {
    expect(await verifyMcpAccessToken(await forge(over))).toBeNull()
  })

  it.each(['iss', 'aud', 'sub', 'jti', 'iat', 'nbf', 'exp', 'typ', 'agency', 'gid', 'sv', 'scope', 'client_id'])(
    'rejects a token missing %s',
    async (claim) => {
      expect(await verifyMcpAccessToken(await forge({}, { omit: [claim] }))).toBeNull()
    },
  )

  it('rejects malformed JWT strings without throwing', async () => {
    for (const bad of ['', 'abc', 'a.b', 'a.b.c', '...', 'Bearer x.y.z', 'x'.repeat(10_000)]) {
      expect(await verifyMcpAccessToken(bad)).toBeNull()
    }
    expect(await verifyMcpAccessToken(undefined as unknown as string)).toBeNull()
  })
})
