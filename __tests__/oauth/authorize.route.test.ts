import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ resolveClient: vi.fn(), connection: vi.fn(async () => undefined) }))
vi.mock('next/server', async (importActual) => ({
  ...(await importActual<typeof import('next/server')>()),
  connection: h.connection,
}))
vi.mock('@/lib/oauth/server/cimd', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/oauth/server/cimd')>()),
  resolveClient: h.resolveClient,
}))

import { GET } from '@/app/api/oauth/authorize/route'
import { readAuthorizationResponseIssuer } from '@/lib/oauth/server/authorizeResponse'
import { PENDING_COOKIE, verifyPendingRequest } from '@/lib/oauth/server/pendingRequest'

const CLIENT = 'https://chatgpt.com/oauth/client.json'
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect'
const OK: Record<string, string> = {
  response_type: 'code',
  client_id: CLIENT,
  redirect_uri: REDIRECT,
  code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  code_challenge_method: 'S256',
  resource: 'https://crm.test/api/mcp',
  scope: 'crm.leads.read crm.conversations.read',
  state: 'xyz',
}

function call(over: Record<string, string | null | string[]> = {}) {
  const u = new URL('https://crm.test/api/oauth/authorize')
  for (const [k, v] of Object.entries({ ...OK, ...over })) {
    if (v === null) continue
    for (const one of Array.isArray(v) ? v : [v]) u.searchParams.append(k, one)
  }
  return GET(new Request(u))
}
const pendingFrom = (res: Response) => {
  const set = res.headers.get('set-cookie') ?? ''
  const m = new RegExp(`${PENDING_COOKIE}=([^;]+)`).exec(set)
  return m ? m[1] : null
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('MCP_ENABLED', '1')
  h.resolveClient.mockImplementation(async (id: string) =>
    id === CLIENT
      ? { ok: true, client: { clientId: id, clientName: 'ChatGPT', redirectUris: [REDIRECT] } }
      : { ok: false, reason: 'client_id_not_allowed' },
  )
})
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/oauth/authorize — before the client is trusted', () => {
  it('opts into request-time rendering before any gate or lookup (never prerendered)', async () => {
    const order: string[] = []
    h.connection.mockImplementationOnce(async () => void order.push('connection'))
    h.resolveClient.mockImplementationOnce(async (id: string) => {
      order.push('resolveClient')
      return { ok: true, client: { clientId: id, clientName: 'ChatGPT', redirectUris: [REDIRECT] } }
    })
    await call()
    expect(order).toEqual(['connection', 'resolveClient'])
    vi.stubEnv('MCP_ENABLED', '')
    h.connection.mockClear()
    await call()
    expect(h.connection).toHaveBeenCalledTimes(1)
  })

  it('404 and no pending state while MCP is disabled (client never resolved)', async () => {
    vi.stubEnv('MCP_ENABLED', '')
    const res = await call()
    expect(res.status).toBe(404)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(h.resolveClient).not.toHaveBeenCalled()
  })

  it('unknown client_id → local 400 HTML, no redirect, no cookie', async () => {
    const res = await call({ client_id: 'https://evil.com/c.json' })
    expect(res.status).toBe(400)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(res.headers.get('content-type')).toMatch(/^text\/html/)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it.each([
    ['missing client_id', { client_id: null }],
    ['duplicate client_id', { client_id: [CLIENT, CLIENT] }],
  ])('%s → local 400, no redirect', async (_n, over) => {
    const res = await call(over)
    expect(res.status).toBe(400)
    expect(res.headers.get('location')).toBeNull()
  })

  it.each([
    ['unregistered redirect_uri', { redirect_uri: 'https://evil.com/cb' }],
    ['trailing-slash variant', { redirect_uri: REDIRECT + '/' }],
    ['case variant', { redirect_uri: REDIRECT.replace('chatgpt', 'ChatGPT') }],
    ['missing redirect_uri', { redirect_uri: null }],
    ['duplicate redirect_uri', { redirect_uri: [REDIRECT, 'https://evil.com/cb'] }],
  ])('valid client + %s → local 400, no redirect, no cookie', async (_n, over) => {
    const res = await call(over)
    expect(res.status).toBe(400)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('local error pages are generic and leak nothing', async () => {
    const body = await (await call({ client_id: 'https://evil.com/c.json' })).text()
    expect(body).toContain('dir="rtl"')
    for (const leak of ['evil.com', 'client_id_not_allowed', 'Error', 'stack', 'resolveClient']) expect(body).not.toContain(leak)
  })
})

describe('GET /api/oauth/authorize — after client + redirect_uri are trusted', () => {
  it.each([
    [{ response_type: 'token' }, 'unsupported_response_type'],
    [{ response_type: null }, 'unsupported_response_type'],
    [{ code_challenge: null }, 'invalid_request'],
    [{ code_challenge: 'short' }, 'invalid_request'],
    [{ code_challenge_method: 'plain' }, 'invalid_request'],
    [{ code_challenge_method: null }, 'invalid_request'],
    [{ resource: null }, 'invalid_target'],
    [{ resource: 'https://other.test/api/mcp' }, 'invalid_target'],
    [{ resource: 'https://crm.test/api/mcp?x=1' }, 'invalid_target'],
    [{ scope: 'crm.leads.read full_access' }, 'invalid_scope'],
    [{ scope: 'crm.leads.status.write' }, 'invalid_scope'],
    [{ scope: 'crm.leads.read  crm.conversations.read' }, 'invalid_scope'],
    [{ scope: ' crm.leads.read' }, 'invalid_scope'],
    [{ scope: 'crm.leads.read crm.leads.read' }, 'invalid_scope'],
    [{ state: 'x'.repeat(513) }, 'invalid_request'],
    [{ state: ['a', 'b'] }, 'invalid_request'],
    [{ scope: ['crm.leads.read', 'crm.conversations.read'] }, 'invalid_request'],
    [{ code_challenge: [OK.code_challenge, OK.code_challenge] }, 'invalid_request'],
  ])('%j → 302 to the trusted redirect_uri with %s, state and exact iss', async (over, error) => {
    const res = await call(over as Record<string, string | null | string[]>)
    expect(res.status).toBe(302)
    const loc = res.headers.get('location')!
    const u = new URL(loc)
    expect(u.origin + u.pathname).toBe(REDIRECT)
    expect(u.searchParams.get('error')).toBe(error)
    expect(readAuthorizationResponseIssuer(loc, 'https://crm.test')).toEqual({ ok: true })
    expect(res.headers.get('set-cookie')).toBeNull()
    if (!Array.isArray((over as Record<string, unknown>).state) && (over as Record<string, unknown>).state === undefined) {
      expect(u.searchParams.get('state')).toBe('xyz')
    }
  })

  it('error descriptions are short and non-sensitive', async () => {
    const u = new URL((await call({ resource: 'https://other.test/api/mcp' })).headers.get('location')!)
    const d = u.searchParams.get('error_description') ?? ''
    expect(d.length).toBeLessThanOrEqual(80)
    expect(d).not.toContain('other.test')
  })

  it('an error without a state carries no state parameter', async () => {
    const u = new URL((await call({ state: null, response_type: 'token' })).headers.get('location')!)
    expect(u.searchParams.has('state')).toBe(false)
  })
})

describe('GET /api/oauth/authorize — success', () => {
  it('sets the signed pending cookie and redirects ONLY to the fixed /oauth/consent', async () => {
    const res = await call()
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/oauth/consent')
    const set = res.headers.get('set-cookie')!
    expect(set).toMatch(new RegExp(`^${PENDING_COOKIE}=`))
    expect(set).toMatch(/Path=\//)
    expect(set).toMatch(/HttpOnly/i)
    expect(set).toMatch(/SameSite=lax/i)
    expect(set).toMatch(/Max-Age=600/)
    expect(set).toMatch(/Secure/)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('the pending request holds exactly the validated values and preserves state verbatim', async () => {
    const state = 'a b+c/=é&?#'
    const pending = await verifyPendingRequest(pendingFrom(await call({ state })))
    expect(pending).toMatchObject({
      clientId: CLIENT,
      clientName: 'ChatGPT',
      redirectUri: REDIRECT,
      codeChallenge: OK.code_challenge,
      scopes: ['crm.leads.read', 'crm.conversations.read'],
      resource: 'https://crm.test/api/mcp',
      state,
    })
    expect(pending!.jti).toMatch(/^[0-9a-f-]{36}$/)
    expect(pending!.csrf).toMatch(/^[A-Za-z0-9_-]{32}$/)
  })

  it('a trailing-slash resource is accepted and stored canonically', async () => {
    const pending = await verifyPendingRequest(pendingFrom(await call({ resource: 'https://crm.test/api/mcp/' })))
    expect(pending!.resource).toBe('https://crm.test/api/mcp')
  })

  it('omitted or empty scope means the Phase A read scopes', async () => {
    for (const scope of [null, '']) {
      const pending = await verifyPendingRequest(pendingFrom(await call({ scope })))
      expect(pending!.scopes).toEqual(['crm.leads.read', 'crm.conversations.read'])
    }
  })

  it('a subset of scopes is kept as requested', async () => {
    const pending = await verifyPendingRequest(pendingFrom(await call({ scope: 'crm.leads.read' })))
    expect(pending!.scopes).toEqual(['crm.leads.read'])
  })

  it('a missing state is stored as null', async () => {
    const pending = await verifyPendingRequest(pendingFrom(await call({ state: null })))
    expect(pending!.state).toBeNull()
  })

  it('each authorization request gets a fresh jti and csrf', async () => {
    const a = await verifyPendingRequest(pendingFrom(await call()))
    const b = await verifyPendingRequest(pendingFrom(await call()))
    expect(a!.jti).not.toBe(b!.jti)
    expect(a!.csrf).not.toBe(b!.csrf)
  })
})

describe('GET /api/oauth/authorize — Claude', () => {
  const CLAUDE_ID = 'https://claude.ai/oauth/mcp-oauth-client-metadata'
  const CLAUDE_CB = 'https://claude.ai/api/mcp/auth_callback'
  beforeEach(() => {
    h.resolveClient.mockImplementation(async (id: string) =>
      id === CLAUDE_ID
        ? { ok: true, client: { clientId: id, clientName: 'Claude', redirectUris: [CLAUDE_CB] } }
        : { ok: false, reason: 'client_id_not_allowed' },
    )
  })

  it('the exact request Claude sent at the checkpoint → pending cookie for Claude → /oauth/consent', async () => {
    const res = await call({ client_id: CLAUDE_ID, redirect_uri: CLAUDE_CB, state: 'claude-state' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/oauth/consent')
    expect(await verifyPendingRequest(pendingFrom(res))).toMatchObject({
      clientId: CLAUDE_ID,
      clientName: 'Claude',
      redirectUri: CLAUDE_CB,
      scopes: ['crm.leads.read', 'crm.conversations.read'],
      state: 'claude-state',
    })
  })

  it("Claude with ChatGPT's redirect_uri (or any other) → local 400, no redirect", async () => {
    const res = await call({ client_id: CLAUDE_ID, redirect_uri: REDIRECT })
    expect(res.status).toBe(400)
    expect(res.headers.get('location')).toBeNull()
  })

  it('errors after trust go to the Claude callback with iss', async () => {
    const loc = (await call({ client_id: CLAUDE_ID, redirect_uri: CLAUDE_CB, scope: 'full_access' })).headers.get('location')!
    expect(new URL(loc).origin + new URL(loc).pathname).toBe(CLAUDE_CB)
    expect(new URL(loc).searchParams.get('error')).toBe('invalid_scope')
    expect(readAuthorizationResponseIssuer(loc, 'https://crm.test')).toEqual({ ok: true })
  })
})
