import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'

const h = vi.hoisted(() => ({ productAccess: vi.fn() }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: h.productAccess }))

import { db } from '@/config/db'
import { POST as token } from '@/app/api/oauth/token/route'
import { POST as revoke } from '@/app/api/oauth/revoke/route'
import { upsertActiveGrant, getActiveGrant, revokeGrant } from '@/lib/oauth/server/grants'
import { issueAuthorizationCode } from '@/lib/oauth/server/authorizationCodes'
import { issueRefreshToken } from '@/lib/oauth/server/refreshTokens'
import { verifyMcpAccessToken } from '@/lib/oauth/server/accessToken'
import { sha256Hex } from '@/lib/oauth/server/hash'

const CLIENT = 'https://chatgpt.com/oauth/client.json'
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect'
const RES = 'https://crm.test/api/mcp'
const V = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const C = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
const BOTH = ['crm.leads.read', 'crm.conversations.read']
let agencyId: number
let userId: number

type Pair = [string, string]
function post(route: typeof token, pairs: Pair[], opts: { contentType?: string; authorization?: string; rawBody?: string } = {}) {
  const body = opts.rawBody ?? new URLSearchParams(pairs).toString()
  const headers: Record<string, string> = { 'content-type': opts.contentType ?? 'application/x-www-form-urlencoded' }
  if (opts.authorization) headers.authorization = opts.authorization
  return route(new Request('https://crm.test/api/oauth/token', { method: 'POST', body, headers }))
}
const exchangePairs = (code: string, extra: Pair[] = []): Pair[] => [
  ['grant_type', 'authorization_code'],
  ['code', code],
  ['code_verifier', V],
  ['client_id', CLIENT],
  ['redirect_uri', REDIRECT],
  ['resource', RES],
  ...extra,
]
const refreshPairs = (rt: string, extra: Pair[] = []): Pair[] => [
  ['grant_type', 'refresh_token'],
  ['refresh_token', rt],
  ['client_id', CLIENT],
  ...extra,
]
const without = (pairs: Pair[], name: string) => pairs.filter(([k]) => k !== name)
const replace = (pairs: Pair[], name: string, value: string) => pairs.map(([k, v]): Pair => [k, k === name ? value : v])

async function grantAndCode(scopes = BOTH) {
  const g = await upsertActiveGrant({
    userId,
    agencyId,
    clientId: CLIENT,
    clientName: 'ChatGPT',
    resource: RES,
    scopes,
    sessionVersion: 0,
  })
  const code = await issueAuthorizationCode({
    grantId: g.id,
    requestJti: randomUUID(),
    clientId: CLIENT,
    redirectUri: REDIRECT,
    codeChallenge: C,
    scopes,
    resource: RES,
  })
  return { g, code }
}
async function tokens(scopes = BOTH) {
  const { g, code } = await grantAndCode(scopes)
  const res = await post(token, exchangePairs(code))
  expect(res.status).toBe(200)
  return { g, body: await res.json() }
}
const err = async (res: Response) => ({ status: res.status, error: (await res.json()).error as string })

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__mcp_token__' }).returning('id')
  agencyId = a.id
  const [u] = await db('users').insert({ firstName: 'T', role: 'AGNT', agencyId }).returning('id')
  userId = u.id
})
beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubEnv('MCP_ENABLED', '1')
  vi.stubEnv('MCP_AGENCY_ALLOWLIST', String(agencyId))
  h.productAccess.mockResolvedValue({ status: 'PAID', hasAccess: true })
  await db.raw(
    'TRUNCATE mcp_audit_events, oauth_refresh_tokens, oauth_authorization_codes, oauth_grants RESTART IDENTITY CASCADE',
  )
  await db('users').where({ id: userId }).update({ suspended: false, sessionVersion: 0, agencyId })
})
afterAll(async () => {
  await db.destroy()
})

// ─────────────────────────────────────────────────────── authorization_code ──
describe('authorization_code — valid exchange', () => {
  it('returns an audience-bound access token, a refresh token, canonical scope; no-store', async () => {
    const { g, code } = await grantAndCode()
    const res = await post(token, exchangePairs(code))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('pragma')).toBe('no-cache')
    expect(res.headers.get('content-type')).toMatch(/^application\/json/)
    const b = await res.json()
    expect(Object.keys(b).sort()).toEqual(['access_token', 'expires_in', 'refresh_token', 'scope', 'token_type'])
    expect(b).toMatchObject({ token_type: 'Bearer', expires_in: 900, scope: 'crm.leads.read crm.conversations.read' })
    expect(b.refresh_token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await verifyMcpAccessToken(b.access_token)).toMatchObject({
      userId,
      agencyId,
      grantId: g.id,
      scopes: BOTH,
      clientId: CLIENT,
    })
    expect(await db('oauth_refresh_tokens').where({ grant_id: g.id })).toHaveLength(1)
  })

  it('resource may be omitted (defaults to this MCP resource)', async () => {
    const { code } = await grantAndCode()
    expect((await post(token, without(exchangePairs(code), 'resource'))).status).toBe(200)
  })

  it('scope in the response reflects the grant, not a request parameter', async () => {
    const { code } = await grantAndCode(['crm.leads.read'])
    const b = await (await post(token, exchangePairs(code, [['scope', 'crm.leads.read crm.conversations.read']]))).json()
    expect(b.scope).toBe('crm.leads.read')
  })

  it('never calls product access', async () => {
    await tokens()
    expect(h.productAccess).not.toHaveBeenCalled()
  })
})

describe('authorization_code — a malformed outer request does NOT burn the code', () => {
  const cases: [string, (code: string) => { pairs: Pair[]; opts?: Parameters<typeof post>[2] }, number, string][] = [
    [
      'JSON content type',
      (c) => ({ pairs: exchangePairs(c), opts: { contentType: 'application/json' } }),
      400,
      'invalid_request',
    ],
    ['no content type', (c) => ({ pairs: exchangePairs(c), opts: { contentType: '' } }), 400, 'invalid_request'],
    ['missing grant_type', (c) => ({ pairs: without(exchangePairs(c), 'grant_type') }), 400, 'invalid_request'],
    [
      'unknown grant_type',
      (c) => ({ pairs: replace(exchangePairs(c), 'grant_type', 'password') }),
      400,
      'unsupported_grant_type',
    ],
    ['missing code', (c) => ({ pairs: without(exchangePairs(c), 'code') }), 400, 'invalid_request'],
    ['missing client_id', (c) => ({ pairs: without(exchangePairs(c), 'client_id') }), 400, 'invalid_request'],
    ['malformed client_id', (c) => ({ pairs: replace(exchangePairs(c), 'client_id', 'not a url') }), 401, 'invalid_client'],
    ['missing redirect_uri', (c) => ({ pairs: without(exchangePairs(c), 'redirect_uri') }), 400, 'invalid_request'],
    [
      'malformed redirect_uri',
      (c) => ({ pairs: replace(exchangePairs(c), 'redirect_uri', 'javascript:x') }),
      400,
      'invalid_request',
    ],
    ['missing code_verifier', (c) => ({ pairs: without(exchangePairs(c), 'code_verifier') }), 400, 'invalid_request'],
    ['malformed code_verifier', (c) => ({ pairs: replace(exchangePairs(c), 'code_verifier', 'short') }), 400, 'invalid_request'],
    [
      'wrong resource',
      (c) => ({ pairs: replace(exchangePairs(c), 'resource', 'https://other.test/api/mcp') }),
      400,
      'invalid_target',
    ],
    ['client_secret', (c) => ({ pairs: exchangePairs(c, [['client_secret', 's']]) }), 401, 'invalid_client'],
    ['client_assertion', (c) => ({ pairs: exchangePairs(c, [['client_assertion', 'eyJ.x.y']]) }), 401, 'invalid_client'],
    [
      'client_assertion_type (private_key_jwt)',
      (c) => ({ pairs: exchangePairs(c, [['client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer']]) }),
      401,
      'invalid_client',
    ],
    [
      'HTTP Basic client auth',
      (c) => ({ pairs: exchangePairs(c), opts: { authorization: 'Basic Y2xpZW50OnNlY3JldA==' } }),
      401,
      'invalid_client',
    ],
    ['oversized body', (c) => ({ pairs: exchangePairs(c, [['pad', 'x'.repeat(20_000)]]) }), 400, 'invalid_request'],
    ...(
      [
        'grant_type',
        'code',
        'code_verifier',
        'redirect_uri',
        'client_id',
        'resource',
        'scope',
        'client_assertion',
        'client_secret',
      ] as const
    ).map((name): [string, (code: string) => { pairs: Pair[] }, number, string] => [
      `duplicated ${name}`,
      (c) => {
        const base = exchangePairs(c, name === 'scope' ? [['scope', 'crm.leads.read']] : [])
        const existing = base.find(([k]) => k === name)?.[1]
        // Present twice either way: a copy of the existing value, or two fresh values.
        return { pairs: existing === undefined ? [...base, [name, 'x'], [name, 'y']] : [...base, [name, existing]] }
      },
      400,
      'invalid_request',
    ]),
  ]

  it.each(cases)('%s → %s/%s, and the code still exchanges afterwards', async (_n, make, status, error) => {
    const { code } = await grantAndCode()
    const { pairs, opts } = make(code)
    expect(await err(await post(token, pairs, opts))).toEqual({ status, error })
    expect((await post(token, exchangePairs(code))).status).toBe(200)
  })

  it('invalid_client responses to HTTP Basic carry a WWW-Authenticate challenge', async () => {
    const { code } = await grantAndCode()
    const res = await post(token, exchangePairs(code), { authorization: 'Basic eDp5' })
    expect(res.headers.get('www-authenticate')).toMatch(/^Basic /)
  })
})

describe('authorization_code — checks against the stored code (burn per Task 5 policy)', () => {
  it.each([
    ['wrong PKCE verifier', (c: string) => replace(exchangePairs(c), 'code_verifier', 'e' + V.slice(1))],
    ['wrong client', (c: string) => replace(exchangePairs(c), 'client_id', 'https://chatgpt.com/other.json')],
    ['wrong redirect_uri', (c: string) => replace(exchangePairs(c), 'redirect_uri', REDIRECT + '/x')],
  ])('%s → invalid_grant and the code is burned', async (_n, make) => {
    const { code } = await grantAndCode()
    expect(await err(await post(token, make(code)))).toEqual({ status: 400, error: 'invalid_grant' })
    expect(await err(await post(token, exchangePairs(code)))).toEqual({ status: 400, error: 'invalid_grant' })
  })

  it('replay → invalid_grant and the grant (and its tokens) are revoked', async () => {
    const { g, code } = await grantAndCode()
    const first = await (await post(token, exchangePairs(code))).json()
    expect(await err(await post(token, exchangePairs(code)))).toEqual({ status: 400, error: 'invalid_grant' })
    expect(await getActiveGrant(g.id)).toBeNull()
    expect((await post(token, refreshPairs(first.refresh_token))).status).toBe(400)
  })

  it('an expired code → invalid_grant', async () => {
    const { code } = await grantAndCode()
    await db('oauth_authorization_codes').update({ expires_at: db.raw("NOW() - interval '1 second'") })
    expect(await err(await post(token, exchangePairs(code)))).toEqual({ status: 400, error: 'invalid_grant' })
  })

  it('a malformed or unknown code → invalid_grant without touching anything', async () => {
    expect(await err(await post(token, exchangePairs('short')))).toEqual({ status: 400, error: 'invalid_grant' })
    expect(await err(await post(token, exchangePairs('A'.repeat(43))))).toEqual({ status: 400, error: 'invalid_grant' })
  })

  it('a code under a revoked grant → invalid_grant', async () => {
    const { g, code } = await grantAndCode()
    await revokeGrant(g.id, 'user_disconnect')
    expect(await err(await post(token, exchangePairs(code)))).toEqual({ status: 400, error: 'invalid_grant' })
  })

  it.each([
    [
      'agency changed',
      async () =>
        void (await db('agencies')
          .insert({ name: '__other__' })
          .returning('id')
          .then(async ([o]) => db('users').where({ id: userId }).update({ agencyId: o.id }))),
      'agency_changed',
    ],
    [
      'sessionVersion changed',
      async () => void (await db('users').where({ id: userId }).update({ sessionVersion: 1 })),
      'session_revoked',
    ],
    ['user suspended', async () => void (await db('users').where({ id: userId }).update({ suspended: true })), 'user_suspended'],
    ['agency removed from allowlist', async () => vi.stubEnv('MCP_AGENCY_ALLOWLIST', '999999'), 'not_allowlisted'],
  ])('%s after consent → invalid_grant, no tokens, grant revoked (%s)', async (_n, change, reason) => {
    const { g, code } = await grantAndCode()
    await change()
    expect(await err(await post(token, exchangePairs(code)))).toEqual({ status: 400, error: 'invalid_grant' })
    expect(await db('oauth_refresh_tokens').where({ grant_id: g.id })).toHaveLength(0)
    expect((await db('oauth_grants').where({ id: g.id }).first('revoked_reason')).revoked_reason).toBe(reason)
  })
})

// ───────────────────────────────────────────────────────────── refresh_token ──
describe('refresh_token', () => {
  it('rotates: new access + refresh token, the old refresh token dies', async () => {
    const { body } = await tokens()
    const res = await post(token, refreshPairs(body.refresh_token))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const b = await res.json()
    expect(b).toMatchObject({ token_type: 'Bearer', expires_in: 900, scope: 'crm.leads.read crm.conversations.read' })
    expect(b.refresh_token).not.toBe(body.refresh_token)
    expect(await verifyMcpAccessToken(b.access_token)).not.toBeNull()
  })

  it('narrows scope when asked, and the access token carries only the narrowed scope', async () => {
    const { body } = await tokens()
    const b = await (await post(token, refreshPairs(body.refresh_token, [['scope', 'crm.leads.read']]))).json()
    expect(b.scope).toBe('crm.leads.read')
    expect((await verifyMcpAccessToken(b.access_token))!.scopes).toEqual(['crm.leads.read'])
  })

  it('widening scope → invalid_scope, and the token is not burned', async () => {
    const { body } = await tokens(['crm.leads.read'])
    expect(
      await err(await post(token, refreshPairs(body.refresh_token, [['scope', 'crm.leads.read crm.conversations.read']]))),
    ).toEqual({
      status: 400,
      error: 'invalid_scope',
    })
    expect((await post(token, refreshPairs(body.refresh_token))).status).toBe(200)
  })

  it.each([
    ['unknown scope', 'crm.leads.read full_access'],
    ['empty token in scope', 'crm.leads.read  crm.conversations.read'],
    ['duplicate scope', 'crm.leads.read crm.leads.read'],
  ])('%s → invalid_scope, token not burned', async (_n, scope) => {
    const { body } = await tokens()
    expect((await err(await post(token, refreshPairs(body.refresh_token, [['scope', scope]])))).error).toBe('invalid_scope')
    expect((await post(token, refreshPairs(body.refresh_token))).status).toBe(200)
  })

  it('wrong resource → invalid_target, token not burned', async () => {
    const { body } = await tokens()
    expect(await err(await post(token, refreshPairs(body.refresh_token, [['resource', 'https://other.test/api/mcp']])))).toEqual({
      status: 400,
      error: 'invalid_target',
    })
    expect((await post(token, refreshPairs(body.refresh_token))).status).toBe(200)
  })

  it('duplicated refresh_token or missing refresh_token → invalid_request, token not burned', async () => {
    const { body } = await tokens()
    const rt = body.refresh_token as string
    expect((await err(await post(token, [...refreshPairs(rt), ['refresh_token', rt]]))).error).toBe('invalid_request')
    expect((await err(await post(token, without(refreshPairs(rt), 'refresh_token')))).error).toBe('invalid_request')
    expect((await post(token, refreshPairs(rt))).status).toBe(200)
  })

  it('expired, revoked, unknown and malformed tokens → invalid_grant', async () => {
    const { g, body } = await tokens()
    await db('oauth_refresh_tokens').update({ expires_at: db.raw("NOW() - interval '1 second'") })
    expect((await err(await post(token, refreshPairs(body.refresh_token)))).error).toBe('invalid_grant')
    const t2 = await issueRefreshToken({ grantId: g.id, userId, scopes: BOTH })
    await db('oauth_refresh_tokens')
      .where({ family_id: t2.familyId })
      .update({ revoked_at: db.fn.now(), revoked_reason: 'admin' })
    expect((await err(await post(token, refreshPairs(t2.token)))).error).toBe('invalid_grant')
    expect((await err(await post(token, refreshPairs('A'.repeat(43))))).error).toBe('invalid_grant')
    expect((await err(await post(token, refreshPairs('short')))).error).toBe('invalid_grant')
  })

  it('replay → invalid_grant; family and grant revoked; the successor is dead', async () => {
    const { g, body } = await tokens()
    const r1 = await (await post(token, refreshPairs(body.refresh_token))).json()
    expect((await err(await post(token, refreshPairs(body.refresh_token)))).error).toBe('invalid_grant')
    expect(await getActiveGrant(g.id)).toBeNull()
    expect((await err(await post(token, refreshPairs(r1.refresh_token)))).error).toBe('invalid_grant')
  })

  /**
   * Concurrent reuse of one refresh token over HTTP.
   *
   * The contract is the SECURITY outcome, not a particular HTTP winner: the
   * first internal rotation may succeed, the concurrent reuse revokes the whole
   * family and the grant (reason refresh_reuse), and nothing from the family
   * stays usable. Whether the rotating request's own post-rotation grant check
   * runs before or after that revocation decides if it answers 200 or
   * invalid_grant — both interleavings are legitimate:
   *   A. one 200 + one invalid_grant, authorization revoked
   *   B. two invalid_grant,           authorization revoked
   * Exact error_description strings are deliberately not part of the contract.
   */
  it('CONCURRENT refresh over HTTP: never two 200s; family + grant always revoked with refresh_reuse (60 iterations)', async () => {
    const ITERATIONS = 60
    const tally = { A_one200: 0, B_none200: 0 }
    for (let i = 0; i < ITERATIONS; i++) {
      await db.raw('TRUNCATE oauth_refresh_tokens, oauth_authorization_codes, oauth_grants RESTART IDENTITY CASCADE')
      const { g, body } = await tokens()
      const original = await db('oauth_refresh_tokens')
        .where({ token_hash: sha256Hex(body.refresh_token) })
        .first('family_id')
      const familyId = original.family_id as string

      const responses = await Promise.all([
        post(token, refreshPairs(body.refresh_token)),
        post(token, refreshPairs(body.refresh_token)),
      ])
      const bodies = await Promise.all(responses.map((r) => r.json()))
      const at = `iteration ${i}: ${JSON.stringify(responses.map((r, k) => [r.status, bodies[k].error ?? 'ok']))}`

      // 1. HTTP: zero or one 200, never two; at least one invalid_grant; nothing else.
      const ok = bodies.filter((_, k) => responses[k].status === 200)
      const rejected = bodies.filter((_, k) => responses[k].status === 400)
      expect(ok.length, at).toBeLessThanOrEqual(1)
      expect(rejected.length, at).toBeGreaterThanOrEqual(1)
      expect(ok.length + rejected.length, at).toBe(2)
      for (const b of rejected) expect(b.error, at).toBe('invalid_grant')

      // 2–3. Database: an internal rotation happened, and replay revoked everything.
      const family = await db('oauth_refresh_tokens')
        .where({ family_id: familyId })
        .select('token_hash', 'used_at', 'revoked_at', 'revoked_reason')
      expect(family, at).toHaveLength(2) // the original + exactly one successor
      const orig = family.find((r) => r.token_hash === sha256Hex(body.refresh_token))!
      const successor = family.find((r) => r.token_hash !== sha256Hex(body.refresh_token))!
      expect(orig.used_at, at).not.toBeNull()
      expect(successor.used_at, at).toBeNull()
      for (const r of family) {
        expect(r.revoked_at, at).not.toBeNull()
        expect(r.revoked_reason, at).toBe('refresh_reuse')
      }
      expect(
        family.filter((r) => r.used_at === null && r.revoked_at === null),
        at,
      ).toHaveLength(0)
      expect(await getActiveGrant(g.id), at).toBeNull()
      expect((await db('oauth_grants').where({ id: g.id }).first('revoked_reason')).revoked_reason, at).toBe('refresh_reuse')

      // 4. A 200 is never evidence of a still-valid authorization.
      if (ok.length === 1) {
        expect(sha256Hex(ok[0].refresh_token), at).toBe(successor.token_hash)
        expect((await err(await post(token, refreshPairs(ok[0].refresh_token)))).error, at).toBe('invalid_grant')
        tally.A_one200++
      } else {
        tally.B_none200++
      }
    }
    // Both interleavings are legitimate; every iteration landed in one of them.
    expect(tally.A_one200 + tally.B_none200).toBe(ITERATIONS)
  })

  it('grant revoked after issuance (disconnect) → refresh fails', async () => {
    const { g, body } = await tokens()
    await revokeGrant(g.id, 'user_disconnect')
    expect((await err(await post(token, refreshPairs(body.refresh_token)))).error).toBe('invalid_grant')
  })

  it.each([
    [
      'sessionVersion change',
      async () => void (await db('users').where({ id: userId }).update({ sessionVersion: 1 })),
      'session_revoked',
    ],
    [
      'agency change',
      async () =>
        void (await db('agencies')
          .insert({ name: '__other2__' })
          .returning('id')
          .then(async ([o]) => db('users').where({ id: userId }).update({ agencyId: o.id }))),
      'agency_changed',
    ],
    ['allowlist removal', async () => vi.stubEnv('MCP_AGENCY_ALLOWLIST', ''), 'not_allowlisted'],
    ['user suspended', async () => void (await db('users').where({ id: userId }).update({ suspended: true })), 'user_suspended'],
  ])('%s → refresh fails, grant revoked (%s), the rotated successor cannot remain usable', async (_n, change, reason) => {
    const { g, body } = await tokens()
    await change()
    expect((await err(await post(token, refreshPairs(body.refresh_token)))).error).toBe('invalid_grant')
    expect((await db('oauth_grants').where({ id: g.id }).first('revoked_reason')).revoked_reason).toBe(reason)
    expect(await db('oauth_refresh_tokens').where({ grant_id: g.id }).whereNull('revoked_at')).toHaveLength(0)
  })

  it('a refresh token presented by a different client_id → invalid_grant and the grant is revoked', async () => {
    const { g, body } = await tokens()
    expect(
      (await err(await post(token, replace(refreshPairs(body.refresh_token), 'client_id', 'https://chatgpt.com/other.json'))))
        .error,
    ).toBe('invalid_grant')
    expect(await getActiveGrant(g.id)).toBeNull()
  })

  it('expired product access does NOT prevent refresh (Phase A); product access is never consulted', async () => {
    const { body } = await tokens()
    h.productAccess.mockResolvedValue({ status: 'TRIAL_EXPIRED', hasAccess: false })
    expect((await post(token, refreshPairs(body.refresh_token))).status).toBe(200)
    expect(h.productAccess).not.toHaveBeenCalled()
  })

  it('per-grant rate limit → invalid_grant with a generic description; another grant is unaffected', async () => {
    const { g, body } = await tokens()
    const rows = Array.from({ length: 120 }, (_, i) => ({
      grant_id: g.id,
      user_id: userId,
      family_id: randomUUID(),
      token_hash: `${'f'.repeat(56)}${String(i).padStart(8, '0')}`,
      scopes: BOTH,
      expires_at: db.raw("NOW() + interval '1 day'"),
    }))
    await db('oauth_refresh_tokens').insert(rows)
    const res = await post(token, refreshPairs(body.refresh_token))
    const b = await res.json()
    expect(b.error).toBe('invalid_grant')
    expect(b.error_description).not.toMatch(/\d/)

    // A different user's grant is not coupled to this one's counter.
    const [u2] = await db('users').insert({ firstName: 'U2', role: 'AGNT', agencyId }).returning('id')
    const g2 = await upsertActiveGrant({
      userId: u2.id,
      agencyId,
      clientId: CLIENT,
      clientName: 'ChatGPT',
      resource: RES,
      scopes: BOTH,
      sessionVersion: 0,
    })
    const t2 = await issueRefreshToken({ grantId: g2.id, userId: u2.id, scopes: BOTH })
    expect((await post(token, refreshPairs(t2.token))).status).toBe(200)
  })

  it('client_secret / client_assertion / Basic on refresh → invalid_client, token not burned', async () => {
    const { body } = await tokens()
    const rt = body.refresh_token as string
    expect((await err(await post(token, refreshPairs(rt, [['client_secret', 'x']])))).error).toBe('invalid_client')
    expect((await err(await post(token, refreshPairs(rt, [['client_assertion', 'x']])))).error).toBe('invalid_client')
    expect((await err(await post(token, refreshPairs(rt), { authorization: 'Basic eDp5' }))).error).toBe('invalid_client')
    expect((await post(token, refreshPairs(rt))).status).toBe(200)
  })
})

// ───────────────────────────────────────────────────────────── error privacy ──
describe('error privacy', () => {
  it('error bodies carry only error + a short generic description', async () => {
    const { g, code } = await grantAndCode()
    await db('users').where({ id: userId }).update({ suspended: true })
    const b = await (await post(token, exchangePairs(code))).json()
    expect(Object.keys(b).sort()).toEqual(['error', 'error_description'])
    const s = JSON.stringify(b).toLowerCase()
    for (const leak of ['suspend', 'session', 'agency', 'grant ', String(g.id), 'select', 'knex', 'stack'])
      expect(s).not.toContain(leak)
  })

  it('404 while MCP is disabled', async () => {
    vi.stubEnv('MCP_ENABLED', '')
    const { code } = await grantAndCode()
    expect((await post(token, exchangePairs(code))).status).toBe(404)
    expect((await post(token, exchangePairs(code))).status).toBe(404)
  })
})

// ──────────────────────────────────────────────────────────────── revocation ──
describe('POST /api/oauth/revoke', () => {
  const rv = (pairs: Pair[], opts: Parameters<typeof post>[2] = {}) => post(revoke, pairs, opts)

  it('known refresh token → 200, empty body, no-store; its family is revoked', async () => {
    const { g, body } = await tokens()
    const res = await rv([['token', body.refresh_token]])
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect((await err(await post(token, refreshPairs(body.refresh_token)))).error).toBe('invalid_grant')
    expect(await getActiveGrant(g.id)).not.toBeNull() // RFC 7009 revokes the token lineage, not the user's grant
  })

  it('unknown token, repeated revocation and any token_type_hint → identical 200 responses', async () => {
    const { body } = await tokens()
    const responses = [
      await rv([['token', 'unknown-token']]),
      await rv([['token', body.refresh_token]]),
      await rv([['token', body.refresh_token]]),
      await rv([
        ['token', body.refresh_token],
        ['token_type_hint', 'access_token'],
      ]),
      await rv([
        ['token', 'unknown'],
        ['token_type_hint', 'refresh_token'],
      ]),
      await rv([
        ['token', 'unknown'],
        ['token_type_hint', 'something_else'],
      ]),
    ]
    for (const r of responses) {
      expect(r.status).toBe(200)
      expect(await r.text()).toBe('')
    }
  })

  it('a malformed request → 400 invalid_request (missing/duplicated token, wrong content type)', async () => {
    expect((await err(await rv([]))).error).toBe('invalid_request')
    expect(
      (
        await err(
          await rv([
            ['token', 'a'],
            ['token', 'b'],
          ]),
        )
      ).error,
    ).toBe('invalid_request')
    expect((await err(await rv([['token', 'a']], { contentType: 'application/json' }))).error).toBe('invalid_request')
  })

  it('client authentication material → invalid_client', async () => {
    expect(
      (
        await err(
          await rv([
            ['token', 'a'],
            ['client_secret', 's'],
          ]),
        )
      ).error,
    ).toBe('invalid_client')
    expect((await err(await rv([['token', 'a']], { authorization: 'Basic eDp5' }))).error).toBe('invalid_client')
  })

  it('404 while MCP is disabled', async () => {
    vi.stubEnv('MCP_ENABLED', '')
    expect((await rv([['token', 'x']])).status).toBe(404)
  })
})

describe('authorization_code — Claude (public client, no authentication)', () => {
  it('exchanges a Claude code with no client authentication and refreshes', async () => {
    const CLAUDE_ID = 'https://claude.ai/oauth/mcp-oauth-client-metadata'
    const CLAUDE_CB = 'https://claude.ai/api/mcp/auth_callback'
    const g = await upsertActiveGrant({
      userId,
      agencyId,
      clientId: CLAUDE_ID,
      clientName: 'Claude',
      resource: RES,
      scopes: BOTH,
      sessionVersion: 0,
    })
    const code = await issueAuthorizationCode({
      grantId: g.id,
      requestJti: randomUUID(),
      clientId: CLAUDE_ID,
      redirectUri: CLAUDE_CB,
      codeChallenge: C,
      scopes: BOTH,
      resource: RES,
    })
    const res = await post(token, [
      ['grant_type', 'authorization_code'],
      ['code', code],
      ['code_verifier', V],
      ['client_id', CLAUDE_ID],
      ['redirect_uri', CLAUDE_CB],
      ['resource', RES],
    ])
    expect(res.status).toBe(200)
    const b = await res.json()
    expect(await verifyMcpAccessToken(b.access_token)).toMatchObject({ clientId: CLAUDE_ID, grantId: g.id })
    const r = await post(token, [
      ['grant_type', 'refresh_token'],
      ['refresh_token', b.refresh_token],
      ['client_id', CLAUDE_ID],
    ])
    expect(r.status).toBe(200)
  })

  it('a Claude code cannot be exchanged as ChatGPT (client mismatch burns it)', async () => {
    const CLAUDE_ID = 'https://claude.ai/oauth/mcp-oauth-client-metadata'
    const g = await upsertActiveGrant({
      userId,
      agencyId,
      clientId: CLAUDE_ID,
      clientName: 'Claude',
      resource: RES,
      scopes: BOTH,
      sessionVersion: 0,
    })
    const code = await issueAuthorizationCode({
      grantId: g.id,
      requestJti: randomUUID(),
      clientId: CLAUDE_ID,
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      codeChallenge: C,
      scopes: BOTH,
      resource: RES,
    })
    expect((await err(await post(token, exchangePairs(code)))).error).toBe('invalid_grant')
  })
})
