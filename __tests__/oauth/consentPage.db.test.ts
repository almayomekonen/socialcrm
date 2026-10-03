import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import type { ReactElement } from 'react'

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  productAccess: vi.fn(),
  cookieValue: { current: undefined as string | undefined },
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  connection: vi.fn(async () => undefined),
}))
vi.mock('next/navigation', () => ({ redirect: h.redirect, notFound: h.notFound }))
vi.mock('next/server', async (importActual) => ({
  ...(await importActual<typeof import('next/server')>()),
  connection: h.connection,
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (n: string) => (n === 'scrm_oauth_pending' && h.cookieValue.current ? { value: h.cookieValue.current } : undefined),
  })),
}))
vi.mock('@/db/auth', async (importActual) => ({ ...(await importActual<typeof import('@/db/auth')>()), getUser: h.getUser }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: h.productAccess }))

import { db } from '@/config/db'
import ConsentPage from '@/app/oauth/consent/page'
import ConsentCard from '@/components/oauth/ConsentCard'
import ConsentMessage from '@/components/oauth/ConsentMessage'
import { signPendingRequest } from '@/lib/oauth/server/pendingRequest'
import { upsertActiveGrant } from '@/lib/oauth/server/grants'
import { issueAuthorizationCode } from '@/lib/oauth/server/authorizationCodes'

const P = {
  clientId: 'https://chatgpt.com/oauth/client.json',
  clientName: 'ChatGPT',
  redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect',
  codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  scopes: ['crm.leads.read' as const],
  resource: 'https://crm.test/api/mcp',
  state: 's',
}
let agencyId: number
let userId: number
const render = () => ConsentPage() as Promise<ReactElement<Record<string, unknown>>>

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: 'סוכנות דנה' }).returning('id')
  agencyId = a.id
  const [u] = await db('users').insert({ firstName: 'דנה', role: 'AGNT', agencyId }).returning('id')
  userId = u.id
})
beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubEnv('MCP_ENABLED', '1')
  vi.stubEnv('MCP_AGENCY_ALLOWLIST', String(agencyId))
  await db('users').where({ id: userId }).update({ suspended: false })
  h.getUser.mockResolvedValue({ id: userId, agencyId })
  h.productAccess.mockResolvedValue({ status: 'PAID', hasAccess: true })
  h.cookieValue.current = (await signPendingRequest(P)).token
})
afterAll(async () => {
  await db.destroy()
})

describe('/oauth/consent page', () => {
  it('opts into request-time rendering before the MCP gate (never prerendered)', async () => {
    vi.stubEnv('MCP_ENABLED', '')
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.connection).toHaveBeenCalledTimes(1)
  })

  it('404 while MCP is disabled', async () => {
    vi.stubEnv('MCP_ENABLED', '')
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('not signed in → the existing login page (no returnTo of its own)', async () => {
    h.getUser.mockResolvedValue(null)
    await expect(render()).rejects.toThrow('NEXT_REDIRECT:/auth')
  })

  it('eligible → the consent card with validated client, session identity and a csrf token', async () => {
    const el = await render()
    expect(el.type).toBe(ConsentCard)
    expect(el.props).toMatchObject({
      clientName: 'ChatGPT',
      redirectHost: 'chatgpt.com',
      userName: 'דנה',
      agencyName: 'סוכנות דנה',
      scopes: ['crm.leads.read'],
    })
    expect(el.props.csrf).toMatch(/^[A-Za-z0-9_-]{32}$/)
    // Exactly these props: never the raw redirect URI, the PKCE challenge or internal ids.
    expect(Object.keys(el.props).sort()).toEqual(['agencyName', 'clientName', 'csrf', 'redirectHost', 'scopes', 'userName'])
    const json = JSON.stringify(el.props)
    for (const leak of ['connector_platform_oauth_redirect', P.codeChallenge]) expect(json).not.toContain(leak)
    // Id check by VALUE, not substring: a random csrf may legitimately contain "1".
    for (const v of Object.values(el.props)) {
      expect([userId, agencyId, String(userId), String(agencyId)]).not.toContain(v)
    }
  })

  it.each([
    ['no pending cookie', async () => void (h.cookieValue.current = undefined)],
    ['tampered pending cookie', async () => void (h.cookieValue.current = h.cookieValue.current!.slice(0, -3) + 'xyz')],
  ])('%s → generic expired message, no card', async (_n, setup) => {
    await setup()
    const el = await render()
    expect(el.type).toBe(ConsentMessage)
    expect(String(el.props.message)).toContain('פגה')
  })

  it('a pending request that already produced a code → message, no card', async () => {
    const { token, pending } = await signPendingRequest(P)
    h.cookieValue.current = token
    const g = await upsertActiveGrant({
      userId,
      agencyId,
      clientId: P.clientId,
      clientName: 'ChatGPT',
      resource: P.resource,
      scopes: ['crm.leads.read'],
      sessionVersion: 0,
    })
    await issueAuthorizationCode({
      grantId: g.id,
      requestJti: pending.jti,
      clientId: P.clientId,
      redirectUri: P.redirectUri,
      codeChallenge: P.codeChallenge,
      scopes: ['crm.leads.read'],
      resource: P.resource,
    })
    expect((await render()).type).toBe(ConsentMessage)
  })

  it.each([
    ['not allowlisted', async () => vi.stubEnv('MCP_AGENCY_ALLOWLIST', '999999'), false],
    ['suspended', async () => void (await db('users').where({ id: userId }).update({ suspended: true })), false],
    ['trial expired', async () => void h.productAccess.mockResolvedValue({ status: 'TRIAL_EXPIRED', hasAccess: false }), true],
    [
      'trial not started',
      async () => void h.productAccess.mockResolvedValue({ status: 'NEVER_STARTED', hasAccess: false }),
      true,
    ],
  ])('ineligible (%s) → message with no internals, no card', async (_n, setup, billing) => {
    await setup()
    const el = await render()
    expect(el.type).toBe(ConsentMessage)
    expect(Boolean(el.props.showBilling)).toBe(billing)
    const msg = String(el.props.message)
    for (const leak of ['suspend', 'allowlist', String(agencyId), String(userId)]) expect(msg.toLowerCase()).not.toContain(leak)
  })
})
