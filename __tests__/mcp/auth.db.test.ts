import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'

const h = vi.hoisted(() => ({ productAccess: vi.fn() }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: h.productAccess }))

import { db } from '@/config/db'
import { authenticateMcpRequest, type McpAuthResult } from '@/lib/mcp/auth'
import { upsertActiveGrant, revokeGrant, getActiveGrant } from '@/lib/oauth/server/grants'
import { signMcpAccessToken } from '@/lib/oauth/server/accessToken'

const CLIENT = 'https://chatgpt.com/oauth/client.json'
const RES = 'https://crm.test/api/mcp'
const BOTH = ['crm.leads.read', 'crm.conversations.read']
let agencyId: number
let otherAgencyId: number
let adminId: number
let repId: number
let rep2Id: number

const req = (authorization?: string, url = 'https://crm.test/api/mcp') =>
  new Request(url, { method: 'POST', headers: authorization === undefined ? {} : { authorization } })
const auth = (authorization?: string) => authenticateMcpRequest(req(authorization), 'req-1')
const kind = (r: McpAuthResult) => ('principal' in r ? 'ok' : r.kind)

async function connect(userId: number, opts: { scopes?: string[]; sv?: number } = {}) {
  const scopes = opts.scopes ?? BOTH
  const sv = opts.sv ?? 0
  const g = await upsertActiveGrant({
    userId,
    agencyId,
    clientId: CLIENT,
    clientName: 'ChatGPT',
    resource: RES,
    scopes,
    sessionVersion: sv,
  })
  const t = await signMcpAccessToken({ userId, agencyId, grantId: g.id, sessionVersion: sv, scopes, clientId: CLIENT })
  return { g, bearer: `Bearer ${t}` }
}

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__mcp_auth__' }).returning('id')
  const [b] = await db('agencies').insert({ name: '__mcp_auth_other__' }).returning('id')
  agencyId = a.id
  otherAgencyId = b.id
  const [ad] = await db('users').insert({ firstName: 'Ada', lastName: 'Admin', role: 'ADMIN', agencyId }).returning('id')
  const [r1] = await db('users').insert({ firstName: 'Rina', lastName: 'Rep', role: 'AGNT', agencyId }).returning('id')
  const [r2] = await db('users').insert({ firstName: 'Bob', lastName: 'Rep', role: 'AGNT', agencyId }).returning('id')
  adminId = ad.id
  repId = r1.id
  rep2Id = r2.id
  // Rina was given visibility of Bob's leads (gotId sees gaveId).
  await db('user_perms').insert({ gotId: repId, gaveId: rep2Id })
})
beforeEach(async () => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.stubEnv('MCP_ENABLED', '1')
  vi.stubEnv('MCP_AGENCY_ALLOWLIST', String(agencyId))
  h.productAccess.mockResolvedValue({ status: 'PAID', hasAccess: true })
  await db.raw(
    'TRUNCATE mcp_audit_events, oauth_refresh_tokens, oauth_authorization_codes, oauth_grants RESTART IDENTITY CASCADE',
  )
  await db('users').whereIn('id', [adminId, repId, rep2Id]).update({ suspended: false, sessionVersion: 0, agencyId })
})
afterAll(async () => {
  await db.destroy()
})

describe('authenticateMcpRequest — valid', () => {
  it('builds exactly the principal tools need (rep: getPerms visibility)', async () => {
    const { g, bearer } = await connect(repId)
    const r = await auth(bearer)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Object.keys(r.principal).sort()).toEqual(
      ['agencyId', 'clientId', 'firstName', 'gotPermIds', 'grantId', 'plan', 'requestId', 'role', 'scopes', 'userId'].sort(),
    )
    expect(r.principal).toMatchObject({
      requestId: 'req-1',
      userId: repId,
      agencyId,
      role: 'AGNT',
      firstName: 'Rina',
      grantId: g.id,
      clientId: CLIENT,
      scopes: BOTH,
    })
    expect(['free', 'pro']).toContain(r.principal.plan)
    expect([...r.principal.gotPermIds].sort()).toEqual([repId, rep2Id].sort())
  })

  it('admins are unrestricted ([]), exactly as the product treats them', async () => {
    const { bearer } = await connect(adminId)
    const r = await auth(bearer)
    expect(r.ok && r.principal.gotPermIds).toEqual([])
  })

  it('a rep without grants sees only themself', async () => {
    const { bearer } = await connect(rep2Id)
    const r = await auth(bearer)
    expect(r.ok && r.principal.gotPermIds).toEqual([rep2Id])
  })

  it('the Bearer scheme is case-insensitive', async () => {
    const { bearer } = await connect(repId)
    expect(kind(await auth(bearer.replace('Bearer', 'bearer')))).toBe('ok')
  })

  it('touches last_used_at at most once per 5 minutes', async () => {
    const { g, bearer } = await connect(repId)
    await auth(bearer)
    const first = (await getActiveGrant(g.id))!.lastUsedAt
    expect(first).not.toBeNull()
    await auth(bearer)
    expect((await getActiveGrant(g.id))!.lastUsedAt).toEqual(first)
  })

  it('never logs the bearer token', async () => {
    const spies = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'log')]
    const { bearer } = await connect(repId)
    await auth(bearer)
    await auth(bearer + 'x')
    const token = bearer.slice(7)
    for (const s of spies) for (const call of s.mock.calls) expect(JSON.stringify(call)).not.toContain(token.slice(0, 40))
  })
})

describe('authenticateMcpRequest — credentials', () => {
  it('no Authorization header → missing (a token in the query string is ignored)', async () => {
    const { bearer } = await connect(repId)
    expect(kind(await auth())).toBe('missing')
    expect(
      kind(await authenticateMcpRequest(req(undefined, `https://crm.test/api/mcp?access_token=${bearer.slice(7)}`), 'r')),
    ).toBe('missing')
  })

  it.each([
    ['empty', ''],
    ['scheme only', 'Bearer'],
    ['scheme and space', 'Bearer '],
    ['double space', 'Bearer  abc.def.ghi'],
    ['Basic', 'Basic dXNlcjpwYXNz'],
    ['two credentials', 'Bearer a.b.c, Bearer d.e.f'],
    ['garbage token', 'Bearer not-a-jwt'],
  ])('malformed Authorization (%s) → invalid', async (_n, header) => {
    expect(kind(await auth(header))).toBe('invalid')
  })

  it('bad signature / tampered token → invalid', async () => {
    const { bearer } = await connect(repId)
    expect(kind(await auth(bearer.slice(0, -3) + 'xyz'))).toBe('invalid')
  })

  it('expired token → invalid', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-03T12:00:00Z'))
    const { bearer } = await connect(repId)
    vi.setSystemTime(new Date('2026-10-03T12:20:00Z'))
    expect(kind(await auth(bearer))).toBe('invalid')
    vi.useRealTimers()
  })

  it('wrong audience / issuer (another deployment) → invalid', async () => {
    const { bearer } = await connect(repId)
    vi.stubEnv('MCP_PUBLIC_ORIGIN', 'https://other.test')
    expect(kind(await auth(bearer))).toBe('invalid')
  })
})

describe('authenticateMcpRequest — grant binding', () => {
  it('revoked or missing grant → invalid', async () => {
    const { g, bearer } = await connect(repId)
    await revokeGrant(g.id, 'user_disconnect')
    expect(kind(await auth(bearer))).toBe('invalid')
    await db('oauth_grants').where({ id: g.id }).delete()
    expect(kind(await auth(bearer))).toBe('invalid')
  })

  it.each([
    [
      'wrong user',
      (g: { id: number }) => ({ userId: rep2Id, agencyId, grantId: g.id, sessionVersion: 0, scopes: BOTH, clientId: CLIENT }),
    ],
    [
      'wrong agency',
      (g: { id: number }) => ({
        userId: repId,
        agencyId: otherAgencyId,
        grantId: g.id,
        sessionVersion: 0,
        scopes: BOTH,
        clientId: CLIENT,
      }),
    ],
    [
      'wrong client',
      (g: { id: number }) => ({
        userId: repId,
        agencyId,
        grantId: g.id,
        sessionVersion: 0,
        scopes: BOTH,
        clientId: 'https://chatgpt.com/other.json',
      }),
    ],
    [
      'wrong session version claim',
      (g: { id: number }) => ({ userId: repId, agencyId, grantId: g.id, sessionVersion: 3, scopes: BOTH, clientId: CLIENT }),
    ],
  ])('%s in the token vs the grant → invalid', async (_n, claims) => {
    const { g } = await connect(repId)
    const t = await signMcpAccessToken(claims(g))
    expect(kind(await auth(`Bearer ${t}`))).toBe('invalid')
  })

  it('grant bound to another resource → invalid', async () => {
    const { g, bearer } = await connect(repId)
    await db('oauth_grants').where({ id: g.id }).update({ resource: 'https://crm.test/api/other' })
    expect(kind(await auth(bearer))).toBe('invalid')
  })

  it('token scopes not covered by the grant → invalid', async () => {
    const { g } = await connect(repId, { scopes: ['crm.leads.read'] })
    const t = await signMcpAccessToken({
      userId: repId,
      agencyId,
      grantId: g.id,
      sessionVersion: 0,
      scopes: BOTH,
      clientId: CLIENT,
    })
    expect(kind(await auth(`Bearer ${t}`))).toBe('invalid')
  })

  it('token scopes may be a subset of the grant', async () => {
    const { g } = await connect(repId)
    const t = await signMcpAccessToken({
      userId: repId,
      agencyId,
      grantId: g.id,
      sessionVersion: 0,
      scopes: ['crm.leads.read'],
      clientId: CLIENT,
    })
    const r = await auth(`Bearer ${t}`)
    expect(r.ok && r.principal.scopes).toEqual(['crm.leads.read'])
  })
})

describe('authenticateMcpRequest — rollout and product access', () => {
  it('MCP kill switch off → disabled', async () => {
    const { bearer } = await connect(repId)
    vi.stubEnv('MCP_ENABLED', '')
    expect(kind(await auth(bearer))).toBe('disabled')
  })

  it('agency not allowlisted → feature_not_enabled, with an audit identity, grant kept', async () => {
    const { g, bearer } = await connect(repId)
    vi.stubEnv('MCP_AGENCY_ALLOWLIST', '999999')
    const r = await auth(bearer)
    expect(kind(r)).toBe('feature_not_enabled')
    expect(!r.ok && 'identity' in r && r.identity).toEqual({
      userId: repId,
      agencyId,
      grantId: g.id,
      clientId: CLIENT,
      requestId: 'req-1',
    })
    expect(await getActiveGrant(g.id)).not.toBeNull()
  })

  it.each([
    ['NEVER_STARTED', 'trial_not_started'],
    ['TRIAL_EXPIRED', 'subscription_required'],
  ])('product access %s → product_access_required (%s), not an invalid token', async (status, reason) => {
    const { bearer } = await connect(repId)
    h.productAccess.mockResolvedValue({ status, hasAccess: false })
    const r = await auth(bearer)
    expect(kind(r)).toBe('product_access_required')
    expect(!r.ok && 'reason' in r && r.reason).toBe(reason)
  })

  it('active product access succeeds', async () => {
    const { bearer } = await connect(repId)
    h.productAccess.mockResolvedValue({ status: 'TRIAL_ACTIVE', hasAccess: true })
    expect(kind(await auth(bearer))).toBe('ok')
  })
})

describe('IMMEDIATE revocation: the SAME unexpired JWT stops working on the very next request', () => {
  const mutations: [string, (g: { id: number }) => Promise<void>, string, string | null][] = [
    ['grant revoked (disconnect)', async (g) => revokeGrant(g.id, 'user_disconnect'), 'invalid', 'user_disconnect'],
    [
      'sign out everywhere (sessionVersion bump)',
      async () => void (await db('users').where({ id: repId }).increment('sessionVersion', 1)),
      'invalid',
      'session_revoked',
    ],
    [
      'user suspended',
      async () => void (await db('users').where({ id: repId }).update({ suspended: true })),
      'invalid',
      'user_suspended',
    ],
    [
      'user moved to another agency',
      async () => void (await db('users').where({ id: repId }).update({ agencyId: otherAgencyId })),
      'invalid',
      'agency_changed',
    ],
    ['agency removed from allowlist', async () => vi.stubEnv('MCP_AGENCY_ALLOWLIST', ''), 'feature_not_enabled', null],
    ['MCP kill switch', async () => vi.stubEnv('MCP_ENABLED', '0'), 'disabled', null],
    [
      'product access expired',
      async () => void h.productAccess.mockResolvedValue({ status: 'TRIAL_EXPIRED', hasAccess: false }),
      'product_access_required',
      null,
    ],
  ]

  it.each(mutations)('%s', async (_n, mutate, expected, revokedReason) => {
    const { g, bearer } = await connect(repId)
    expect(kind(await auth(bearer))).toBe('ok')
    await mutate(g)
    expect(kind(await auth(bearer))).toBe(expected)
    const row = await db('oauth_grants').where({ id: g.id }).first('revoked_reason')
    expect(row.revoked_reason).toBe(revokedReason)
  })

  it('user deleted', async () => {
    const [tmp] = await db('users').insert({ firstName: 'Tmp', role: 'AGNT', agencyId }).returning('id')
    const { g, bearer } = await connect(tmp.id)
    expect(kind(await auth(bearer))).toBe('ok')
    await db('users').where({ id: tmp.id }).delete()
    expect(kind(await auth(bearer))).toBe('invalid')
    expect((await db('oauth_grants').where({ id: g.id }).first('revoked_reason')).revoked_reason).toBe('user_missing')
  })
})
