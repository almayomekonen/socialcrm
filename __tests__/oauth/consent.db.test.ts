import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ getUser: vi.fn(), productAccess: vi.fn() }))
vi.mock('@/db/auth', async (importActual) => ({
  ...(await importActual<typeof import('@/db/auth')>()),
  getUser: h.getUser,
}))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: h.productAccess }))

import { db } from '@/config/db'
import { POST } from '@/app/api/oauth/consent/route'
import { signPendingRequest, PENDING_COOKIE } from '@/lib/oauth/server/pendingRequest'
import { consumeAuthorizationCode } from '@/lib/oauth/server/authorizationCodes'
import { readAuthorizationResponseIssuer } from '@/lib/oauth/server/authorizeResponse'

const CLIENT = 'https://chatgpt.com/oauth/client.json'
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect'
const V = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const P = {
  clientId: CLIENT,
  clientName: 'ChatGPT',
  redirectUri: REDIRECT,
  codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  scopes: ['crm.leads.read' as const, 'crm.conversations.read' as const],
  resource: 'https://crm.test/api/mcp',
  state: 'st-1',
}
let agencyId: number
let userId: number

function post(opts: { token?: string | null; csrf?: string; decision?: string; origin?: string | null }) {
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' }
  if (opts.origin !== null) headers.origin = opts.origin ?? 'https://crm.test'
  if (opts.token) headers.cookie = `${PENDING_COOKIE}=${opts.token}; user=session`
  const body = new URLSearchParams()
  if (opts.csrf !== undefined) body.set('csrf', opts.csrf)
  if (opts.decision !== undefined) body.set('decision', opts.decision)
  return POST(new NextRequest('https://crm.test/api/oauth/consent', { method: 'POST', headers, body }))
}
const count = async (t: string) => Number((await db(t).count<{ n: string }[]>('* as n'))[0].n)
/** The Set-Cookie that deletes the pending cookie, or null. */
const clearHeader = (res: Response) =>
  (res.headers.get('set-cookie') ?? '').split(/,(?=\s*\w+=)/).find((c) => c.trim().startsWith(`${PENDING_COOKIE}=`)) ?? null

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: 'סוכנות בדיקה' }).returning('id')
  agencyId = a.id
  const [u] = await db('users').insert({ firstName: 'Dana', role: 'AGNT', agencyId, sessionVersion: 4 }).returning('id')
  userId = u.id
})
beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubEnv('MCP_ENABLED', '1')
  vi.stubEnv('MCP_AGENCY_ALLOWLIST', String(agencyId))
  await db.raw(
    'TRUNCATE mcp_audit_events, oauth_refresh_tokens, oauth_authorization_codes, oauth_grants RESTART IDENTITY CASCADE',
  )
  await db('users').where({ id: userId }).update({ suspended: false, agencyId, sessionVersion: 4 })
  h.getUser.mockResolvedValue({ id: userId, agencyId })
  h.productAccess.mockResolvedValue({ status: 'PAID', hasAccess: true })
})
afterAll(async () => {
  await db.destroy()
})

describe('POST /api/oauth/consent — approval', () => {
  it('creates the grant snapshot + one code, redirects with code, state and iss, and clears the cookie', async () => {
    const { token, pending } = await signPendingRequest(P)
    const res = await post({ token, csrf: pending.csrf, decision: 'approve' })
    expect(res.status).toBe(303)
    const loc = res.headers.get('location')!
    const u = new URL(loc)
    expect(u.origin + u.pathname).toBe(REDIRECT)
    expect(u.searchParams.get('state')).toBe('st-1')
    expect(readAuthorizationResponseIssuer(loc, 'https://crm.test')).toEqual({ ok: true })
    expect(u.searchParams.has('error')).toBe(false)

    const grant = await db('oauth_grants').first(
      'user_id',
      'agency_id',
      'session_version',
      'client_id',
      'client_name',
      'resource',
      'scopes',
      'revoked_at',
    )
    expect(grant).toEqual({
      user_id: userId,
      agency_id: agencyId,
      session_version: 4,
      client_id: CLIENT,
      client_name: 'ChatGPT',
      resource: 'https://crm.test/api/mcp',
      scopes: ['crm.conversations.read', 'crm.leads.read'],
      revoked_at: null,
    })
    const code = await db('oauth_authorization_codes').first(
      'request_jti',
      'redirect_uri',
      'code_challenge',
      'scopes',
      'resource',
    )
    expect(code).toEqual({
      request_jti: pending.jti,
      redirect_uri: REDIRECT,
      code_challenge: P.codeChallenge,
      scopes: ['crm.leads.read', 'crm.conversations.read'],
      resource: 'https://crm.test/api/mcp',
    })
    expect(
      await consumeAuthorizationCode(u.searchParams.get('code')!, {
        clientId: CLIENT,
        redirectUri: REDIRECT,
        resource: P.resource,
        codeVerifier: V,
      }),
    ).toMatchObject({
      ok: true,
    })
    expect(clearHeader(res)).not.toBeNull()
  })

  it('takes the user from the session and the facts from the database, not from the cookie', async () => {
    await db('users').where({ id: userId }).update({ sessionVersion: 9 })
    const { token, pending } = await signPendingRequest(P)
    await post({ token, csrf: pending.csrf, decision: 'approve' })
    expect(await db('oauth_grants').first('user_id', 'session_version')).toEqual({ user_id: userId, session_version: 9 })
  })

  it('re-consent reuses the active grant (no second active grant)', async () => {
    const a = await signPendingRequest({ ...P, scopes: ['crm.leads.read'] })
    await post({ token: a.token, csrf: a.pending.csrf, decision: 'approve' })
    const b = await signPendingRequest(P)
    await post({ token: b.token, csrf: b.pending.csrf, decision: 'approve' })
    const active = await db('oauth_grants').whereNull('revoked_at').select('id', 'scopes')
    expect(active).toHaveLength(1)
    expect(active[0].scopes).toEqual(['crm.conversations.read', 'crm.leads.read'])
    expect(await count('oauth_authorization_codes')).toBe(2)
  })
})

describe('POST /api/oauth/consent — single use and concurrency', () => {
  it('the same POST submitted twice mints exactly one code', async () => {
    const { token, pending } = await signPendingRequest(P)
    const first = await post({ token, csrf: pending.csrf, decision: 'approve' })
    const second = await post({ token, csrf: pending.csrf, decision: 'approve' })
    expect(first.status).toBe(303)
    expect(second.status).toBe(400)
    expect(second.headers.get('location')).toBeNull()
    expect(await count('oauth_authorization_codes')).toBe(1)
    expect(clearHeader(second)).not.toBeNull()
  })

  it('near-simultaneous approvals: one succeeds, the other is refused; one code, one active grant', async () => {
    const { token, pending } = await signPendingRequest(P)
    const results = await Promise.all([
      post({ token, csrf: pending.csrf, decision: 'approve' }),
      post({ token, csrf: pending.csrf, decision: 'approve' }),
      post({ token, csrf: pending.csrf, decision: 'approve' }),
    ])
    expect(results.filter((r) => r.status === 303)).toHaveLength(1)
    expect(results.filter((r) => r.status === 400)).toHaveLength(2)
    expect(results.filter((r) => r.headers.get('location')).length).toBe(1)
    expect(await count('oauth_authorization_codes')).toBe(1)
    expect(await db('oauth_grants').whereNull('revoked_at')).toHaveLength(1)
  })

  it('replay after success cannot produce another code, even after the first code was exchanged', async () => {
    const { token, pending } = await signPendingRequest(P)
    const first = await post({ token, csrf: pending.csrf, decision: 'approve' })
    const code = new URL(first.headers.get('location')!).searchParams.get('code')!
    await consumeAuthorizationCode(code, { clientId: CLIENT, redirectUri: REDIRECT, resource: P.resource, codeVerifier: V })
    expect((await post({ token, csrf: pending.csrf, decision: 'approve' })).status).toBe(400)
    expect((await post({ token, csrf: pending.csrf, decision: 'deny' })).status).toBe(400)
    expect(await count('oauth_authorization_codes')).toBe(1)
  })
})

describe('POST /api/oauth/consent — denial', () => {
  it('creates no grant or code, redirects access_denied with state and iss, clears the cookie', async () => {
    const { token, pending } = await signPendingRequest(P)
    const res = await post({ token, csrf: pending.csrf, decision: 'deny' })
    expect(res.status).toBe(303)
    const loc = res.headers.get('location')!
    expect(new URL(loc).searchParams.get('error')).toBe('access_denied')
    expect(new URL(loc).searchParams.get('state')).toBe('st-1')
    expect(new URL(loc).searchParams.has('code')).toBe(false)
    expect(readAuthorizationResponseIssuer(loc, 'https://crm.test')).toEqual({ ok: true })
    expect(await count('oauth_grants')).toBe(0)
    expect(await count('oauth_authorization_codes')).toBe(0)
    expect(clearHeader(res)).not.toBeNull()
  })
})

describe('POST /api/oauth/consent — fails closed', () => {
  it('404 while MCP is disabled', async () => {
    vi.stubEnv('MCP_ENABLED', '')
    const { token, pending } = await signPendingRequest(P)
    expect((await post({ token, csrf: pending.csrf, decision: 'approve' })).status).toBe(404)
  })

  it.each([
    ['cross-site origin', 'https://evil.test'],
    ['missing origin', null],
    ['null origin', 'null'],
  ])('%s → 403 local, nothing written, cookie kept', async (_n, origin) => {
    const { token, pending } = await signPendingRequest(P)
    const res = await post({ token, csrf: pending.csrf, decision: 'approve', origin })
    expect(res.status).toBe(403)
    expect(res.headers.get('location')).toBeNull()
    expect(clearHeader(res)).toBeNull()
    expect(await count('oauth_grants')).toBe(0)
  })

  it('CSRF mismatch or missing → 400 local, nothing written, cookie kept', async () => {
    const { token, pending } = await signPendingRequest(P)
    for (const csrf of ['wrong', '', undefined, pending.csrf.slice(0, -1) + 'A']) {
      const res = await post({ token, csrf, decision: 'approve' })
      expect(res.status).toBe(400)
      expect(res.headers.get('location')).toBeNull()
      expect(clearHeader(res)).toBeNull()
    }
    expect(await count('oauth_grants')).toBe(0)
    expect(await count('oauth_authorization_codes')).toBe(0)
  })

  it('an unknown decision value → 400 local, nothing written', async () => {
    const { token, pending } = await signPendingRequest(P)
    for (const decision of ['yes', '', undefined]) {
      expect((await post({ token, csrf: pending.csrf, decision })).status).toBe(400)
    }
    expect(await count('oauth_grants')).toBe(0)
  })

  it('no session → 401 local; the pending request is kept so login can resume', async () => {
    h.getUser.mockResolvedValue(null)
    const { token, pending } = await signPendingRequest(P)
    const res = await post({ token, csrf: pending.csrf, decision: 'approve' })
    expect(res.status).toBe(401)
    expect(res.headers.get('location')).toBeNull()
    expect(clearHeader(res)).toBeNull()
  })

  it('missing, expired, tampered or malformed pending state → 400 local (never a redirect), cookie cleared', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-03T12:00:00Z'))
    const expired = await signPendingRequest(P)
    vi.setSystemTime(new Date('2026-10-03T12:11:00Z'))
    const fresh = await signPendingRequest(P)
    const cases: (string | null)[] = [null, expired.token, fresh.token.slice(0, -3) + 'xyz', 'garbage']
    for (const token of cases) {
      const res = await post({ token, csrf: fresh.pending.csrf, decision: 'approve' })
      expect(res.status).toBe(400)
      expect(res.headers.get('location')).toBeNull()
      expect(await res.text()).not.toContain('chatgpt.com')
      if (token) expect(clearHeader(res)).not.toBeNull()
    }
    vi.useRealTimers()
    expect(await count('oauth_grants')).toBe(0)
  })

  it.each([
    ['agency not allowlisted', async () => vi.stubEnv('MCP_AGENCY_ALLOWLIST', '999999')],
    ['MCP allowlist emptied', async () => vi.stubEnv('MCP_AGENCY_ALLOWLIST', '')],
    ['user suspended', async () => void (await db('users').where({ id: userId }).update({ suspended: true }))],
    ['trial expired', async () => void h.productAccess.mockResolvedValue({ status: 'TRIAL_EXPIRED', hasAccess: false })],
    ['trial never started', async () => void h.productAccess.mockResolvedValue({ status: 'NEVER_STARTED', hasAccess: false })],
    ['user no longer exists', async () => void h.getUser.mockResolvedValue({ id: 99_999_999, agencyId })],
  ])('eligibility re-checked at submit time: %s → access_denied redirect, no grant/code, cookie cleared', async (_n, setup) => {
    const { token, pending } = await signPendingRequest(P)
    await setup()
    const res = await post({ token, csrf: pending.csrf, decision: 'approve' })
    expect(res.status).toBe(303)
    const u = new URL(res.headers.get('location')!)
    expect(u.searchParams.get('error')).toBe('access_denied')
    expect(u.searchParams.get('state')).toBe('st-1')
    const desc = u.searchParams.get('error_description') ?? ''
    for (const leak of ['suspend', 'trial', 'allowlist', 'agency', String(userId)]) expect(desc.toLowerCase()).not.toContain(leak)
    expect(await count('oauth_grants')).toBe(0)
    expect(await count('oauth_authorization_codes')).toBe(0)
    expect(clearHeader(res)).not.toBeNull()
  })
})

describe('pending cookie deletion is a real deletion', () => {
  it('uses the same name, Path=/, HttpOnly, Secure, SameSite=Lax, Max-Age=0 and an epoch expiry', async () => {
    const { token, pending } = await signPendingRequest(P)
    const header = clearHeader(await post({ token, csrf: pending.csrf, decision: 'deny' }))!
    expect(header).toMatch(new RegExp(`^${PENDING_COOKIE}=;`))
    expect(header).toMatch(/Path=\/(;|$)/)
    expect(header).toMatch(/Max-Age=0/)
    expect(header).toMatch(/Expires=Thu, 01 Jan 1970/)
    expect(header).toMatch(/HttpOnly/i)
    expect(header).toMatch(/Secure/)
    expect(header).toMatch(/SameSite=lax/i)
    expect(header).not.toMatch(/Domain=/i)
  })
})
