/**
 * D1 end to end at the three real post-login redirect points: Google
 * (checkUser), Facebook (checkFacebookUser) and the magic link (GET
 * /api/magic). Each must make the SAME decision through the shared helper,
 * leave the pending cookie untouched for the consent step, and behave exactly
 * as before when there is no valid pending authorization.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  redirect: vi.fn(),
  revalidateTag: vi.fn(),
  cookieStore: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
  createCookie: vi.fn(),
  revokeUserSessions: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserByFacebookSub: vi.fn(),
  fbVerify: vi.fn(),
  googleVerify: vi.fn(),
  userUpdate: vi.fn(),
  userFirst: vi.fn(),
  googleKey: Object.assign(() => undefined, { __google: true }),
}))

vi.mock('next/cache', () => ({ revalidateTag: h.revalidateTag, revalidatePath: vi.fn(), cacheTag: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: h.redirect }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => h.cookieStore),
  headers: vi.fn(async () => ({ get: () => null })),
}))
vi.mock('@/lib/email/sender', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/email/render', () => ({ renderEmail: vi.fn() }))
vi.mock('@/emails/templates/MagicLinkEmail', () => ({ default: vi.fn() }))
vi.mock('@/config/resend', () => ({ default: { emails: { send: vi.fn() }, events: { send: vi.fn() } } }))
vi.mock('@/lib/auth/verifyFacebookAccessToken', () => ({ verifyFacebookAccessToken: h.fbVerify }))
vi.mock('@/lib/auth/fbLoginProof', () => ({ setFacebookLoginProof: vi.fn(), clearFacebookLoginProof: vi.fn() }))
vi.mock('@/db/auth', async (importActual) => ({
  ...(await importActual<typeof import('@/db/auth')>()),
  getUserByEmail: h.getUserByEmail,
  getUserByFacebookSub: h.getUserByFacebookSub,
  createCookie: h.createCookie,
  revokeUserSessions: h.revokeUserSessions,
}))
vi.mock('@/config/db', () => {
  const qb = { where: () => qb, update: h.userUpdate, first: h.userFirst }
  return { db: Object.assign(() => qb, { raw: vi.fn() }) }
})
// Google's JWKS verification only: every other jose call (the pending cookie) is real.
vi.mock('jose', async (importActual) => {
  const actual = await importActual<typeof import('jose')>()
  return {
    ...actual,
    createRemoteJWKSet: () => h.googleKey,
    jwtVerify: (token: string, key: unknown, opts: unknown) =>
      key === h.googleKey ? h.googleVerify(token) : actual.jwtVerify(token, key as never, opts as never),
  }
})

import { checkUser, checkFacebookUser } from '@/actions/auth'
import { GET as magicGET } from '@/app/api/magic/route'
import { signPendingRequest, verifyPendingRequest, PENDING_COOKIE } from '@/lib/oauth/server/pendingRequest'

const P = {
  clientId: 'https://chatgpt.com/oauth/client.json',
  clientName: 'ChatGPT',
  redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect',
  codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  scopes: ['crm.leads.read' as const],
  resource: 'https://crm.test/api/mcp',
  state: 'abc',
}

type Login = (pending: string | undefined) => Promise<{ destination: string | null }>

/** Google: real checkUser, Google signature check stubbed. */
const google: Login = async (pending) => {
  h.cookieStore.get.mockImplementation((n: string) => (n === PENDING_COOKIE && pending ? { value: pending } : undefined))
  h.googleVerify.mockResolvedValue({ payload: { email: 'dana@example.com', email_verified: true, sub: 'g-1', name: 'Dana' } })
  h.getUserByEmail.mockResolvedValue({ id: 42, suspended: false })
  await expect(checkUser({ credential: 'google-id-token' })).rejects.toThrow('NEXT_REDIRECT')
  return { destination: h.redirect.mock.calls.at(-1)?.[0] ?? null }
}

/** Facebook: real checkFacebookUser, Graph verification stubbed. */
const facebook: Login = async (pending) => {
  h.cookieStore.get.mockImplementation((n: string) => (n === PENDING_COOKIE && pending ? { value: pending } : undefined))
  h.fbVerify.mockResolvedValue({ ok: true, identity: { sub: 'fb-1', email: 'dana@example.com', name: 'Dana' } })
  h.getUserByEmail.mockResolvedValue({ id: 42, suspended: false, facebookSub: 'fb-1', agencyId: 103 })
  await expect(checkFacebookUser({ accessToken: 'EAAG' })).rejects.toThrow('NEXT_REDIRECT')
  return { destination: h.redirect.mock.calls.at(-1)?.[0] ?? null }
}

/** Magic link: real route handler; the cookie arrives on the request. */
const magic: Login = async (pending) => {
  h.getUserByEmail.mockResolvedValue({
    id: 42,
    suspended: false,
    emailVerifiedAt: new Date(),
    otp: { token: 'tok', tokenExpiry: new Date(Date.now() + 60_000).toISOString() },
  })
  const req = new NextRequest('https://crm.test/api/magic?email=dana%40example.com&token=tok', {
    headers: pending ? { cookie: `${PENDING_COOKIE}=${pending}` } : {},
  })
  const res = await magicGET(req)
  expect(res.status).toBe(302)
  expect(res.headers.get('set-cookie') ?? '').not.toContain(PENDING_COOKIE)
  return { destination: res.headers.get('location') }
}

const ROUTES: [string, Login][] = [
  ['google', google],
  ['facebook', facebook],
  ['magic link', magic],
]

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FACEBOOK_USER_AUTH_ENABLED = '1'
  process.env.FACEBOOK_USER_AUTH_AGENCY_ALLOWLIST = '103'
  process.env.NEXT_PUBLIC_GGLID = 'test-google-client-id'
  vi.stubEnv('MCP_ENABLED', '1')
  h.redirect.mockImplementation(() => {
    throw new Error('NEXT_REDIRECT')
  })
  h.userUpdate.mockResolvedValue(1)
  h.userFirst.mockResolvedValue({ emailVerifiedAt: new Date(), facebookSub: 'fb-1' })
  h.createCookie.mockResolvedValue(undefined)
  h.getUserByFacebookSub.mockResolvedValue({
    id: 42,
    suspended: false,
    facebookSub: 'fb-1',
    agencyId: 103,
    email: 'dana@example.com',
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe.each(ROUTES)('%s login', (_name, login) => {
  it('no pending request → /dashboard (unchanged), session issued exactly once', async () => {
    expect((await login(undefined)).destination).toBe('/dashboard')
    expect(h.createCookie).toHaveBeenCalledTimes(1)
    expect(h.createCookie).toHaveBeenCalledWith(42)
  })

  it('valid pending request → /oauth/consent, same session issuance', async () => {
    const { token } = await signPendingRequest(P)
    expect((await login(token)).destination).toBe('/oauth/consent')
    expect(h.createCookie).toHaveBeenCalledTimes(1)
    expect(h.createCookie).toHaveBeenCalledWith(42)
  })

  it('the pending request survives login: never cleared or rewritten, still verifiable for consent', async () => {
    const { token, pending } = await signPendingRequest(P)
    await login(token)
    for (const call of [...h.cookieStore.set.mock.calls, ...h.cookieStore.delete.mock.calls]) {
      expect(JSON.stringify(call)).not.toContain(PENDING_COOKIE)
    }
    expect(await verifyPendingRequest(token)).toEqual(pending)
  })

  it('expired pending request → /dashboard', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-03T12:00:00Z'))
    const { token } = await signPendingRequest(P)
    vi.setSystemTime(new Date('2026-10-03T12:11:00Z'))
    expect((await login(token)).destination).toBe('/dashboard')
  })

  it('invalid signature / malformed pending value → /dashboard', async () => {
    const { token } = await signPendingRequest(P)
    expect((await login(token.slice(0, -3) + 'xyz')).destination).toBe('/dashboard')
    expect((await login('not-a-jwt')).destination).toBe('/dashboard')
  })

  it('MCP disabled → /dashboard even with a valid pending request', async () => {
    const { token } = await signPendingRequest(P)
    vi.stubEnv('MCP_ENABLED', '')
    expect((await login(token)).destination).toBe('/dashboard')
  })

  it('an unusable MCP key never breaks login: /dashboard', async () => {
    const { token } = await signPendingRequest(P)
    vi.stubEnv('MCP_JWT_SECRET', '')
    expect((await login(token)).destination).toBe('/dashboard')
    expect(h.createCookie).toHaveBeenCalledWith(42)
  })
})

describe('failed logins are unaffected by a pending request', () => {
  it('a bad magic token still goes to /auth?error=failed', async () => {
    const { token } = await signPendingRequest(P)
    h.getUserByEmail.mockResolvedValue({
      id: 42,
      suspended: false,
      otp: { token: 'other', tokenExpiry: new Date(Date.now() + 60_000).toISOString() },
    })
    const res = await magicGET(
      new NextRequest('https://crm.test/api/magic?email=dana%40example.com&token=tok', {
        headers: { cookie: `${PENDING_COOKIE}=${token}` },
      }),
    )
    expect(res.headers.get('location')).toBe('/auth?error=failed')
    expect(h.createCookie).not.toHaveBeenCalled()
  })

  it('an invalid Google credential still returns the failure without redirecting', async () => {
    const { token } = await signPendingRequest(P)
    h.cookieStore.get.mockImplementation(() => ({ value: token }))
    h.googleVerify.mockRejectedValue(new Error('bad signature'))
    expect(await checkUser({ credential: 'forged' })).toEqual({ fail: true, msg: 'ההתחברות נכשלה, נסה שוב' })
    expect(h.redirect).not.toHaveBeenCalled()
    expect(h.createCookie).not.toHaveBeenCalled()
  })
})
