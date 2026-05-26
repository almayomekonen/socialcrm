/**
 * /api/payments/upgrade — route handler tests.
 *
 * Strategy: mock requireUser (matches existing __tests__ pattern).
 * Token logic, link builder, and env-reading are REAL — never mocked.
 */
import { vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), cacheTag: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(() => null), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(() => ({ get: vi.fn(() => null) })),
}))
vi.mock('@/lib/requireUser', async () => {
  const actual = await vi.importActual<typeof import('@/lib/requireUser')>('@/lib/requireUser')
  return { ...actual, requireUser: vi.fn() }
})

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { requireUser, AuthError } from '@/lib/requireUser'
import { verifyToken } from '@/lib/payments/token'
import { getUpgradeLink } from '@/lib/payments/link'
import { GET } from '@/app/api/payments/upgrade/route'

const TOKEN_SECRET = 'test_token_secret_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const PAYMENT_LINK = 'https://pay.grow.link/test-link-id'
const APP_HOST = 'localhost:3000'

beforeAll(() => {
  process.env.APP_ENV = 'production'
  process.env.GROW_MODE = 'production'
  process.env.APP_HOST = APP_HOST
  process.env.GROW_TOKEN_SECRET = TOKEN_SECRET
  process.env.GROW_PAYMENT_LINK = PAYMENT_LINK
})

beforeEach(() => {
  vi.mocked(requireUser).mockReset()
  process.env.APP_ENV = 'production'
  process.env.GROW_MODE = 'production'
  process.env.APP_HOST = APP_HOST
  process.env.GROW_TOKEN_SECRET = TOKEN_SECRET
  process.env.GROW_PAYMENT_LINK = PAYMENT_LINK
})

function makeReq(host = APP_HOST) {
  return new NextRequest(`http://${host}/api/payments/upgrade`, { method: 'GET', headers: { host } })
}

describe('GET /api/payments/upgrade', () => {
  it('redirects authenticated user to Grow with a verifiable identifyParam', async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({ id: 1, agencyId: 42 } as any)

    const res = await GET(makeReq())

    expect(res.status).toBe(302)
    const location = res.headers.get('location')!
    expect(location).toContain(PAYMENT_LINK)
    const url = new URL(location)
    const token = url.searchParams.get('identifyParam')
    expect(token).toBeTruthy()
    expect(url.searchParams.get('return_url')).toBe(`https://${APP_HOST}/billing/success`)

    // Token must decode to the EXACT agencyId server-side (no trust in the URL)
    const verified = verifyToken(token!)
    expect(verified.agencyId).toBe(42)
  })

  // TEST A — generated URL contains identifyParam
  it('generated URL contains identifyParam with a non-empty HMAC token', () => {
    const raw = getUpgradeLink(42)
    const url = new URL(raw)

    expect(url.searchParams.has('identifyParam')).toBe(true)
    expect(url.searchParams.get('identifyParam')).toBeTruthy()
    expect(url.searchParams.get('identifyParam')!.length).toBeGreaterThan(20)
  })

  // TEST B — generated URL does NOT contain external_id (the old, broken param name)
  it('generated URL does NOT contain external_id', () => {
    const raw = getUpgradeLink(42)
    const url = new URL(raw)

    expect(url.searchParams.has('external_id')).toBe(false)
    // Also confirm the literal substring is absent from the URL string entirely
    expect(raw).not.toContain('external_id=')
  })

  // TEST C — token value is preserved exactly between sign and URL placement
  it('token value placed in identifyParam is identical to the signToken output', async () => {
    const { signToken } = await import('@/lib/payments/token')
    // Re-sign in the same window so the embedded timestamp is comparable.
    // We compare the URL's token via verifyToken: the embedded value must
    // round-trip back to the same agencyId without mutation.
    const raw = getUpgradeLink(42)
    const url = new URL(raw)
    const tokenFromUrl = url.searchParams.get('identifyParam')!

    // Token format: "<base64url-payload>.<base64url-hmac>" — verifyToken
    // re-derives the HMAC from the payload and timing-safely compares it.
    // Any character mutation (URL-encode of '.', truncation, doubled '=',
    // etc.) would cause verifyToken to throw.
    const verified = verifyToken(tokenFromUrl)
    expect(verified.agencyId).toBe(42)

    // Cross-sanity: signToken(42) produces a different timestamp every call
    // but always the same format/structure, so just confirm shape:
    const freshlySigned = signToken(42)
    const [urlPayload, urlSig] = tokenFromUrl.split('.')
    const [freshPayload, freshSig] = freshlySigned.split('.')
    expect(urlPayload).toBeTruthy()
    expect(urlSig).toBeTruthy()
    expect(freshPayload).toBeTruthy()
    expect(freshSig).toBeTruthy()
    expect(urlSig.length).toBe(freshSig.length) // signature size is constant for the same algorithm
  })

  it('redirects to /login when no session (AuthError no_session)', async () => {
    vi.mocked(requireUser).mockRejectedValueOnce(new AuthError('no_session'))

    const res = await GET(makeReq())

    expect(res.status).toBe(302)
    const location = res.headers.get('location')!
    expect(location).toContain('/login')
    expect(location).toContain('next=%2Fapi%2Fpayments%2Fupgrade')
    // Critical: NEVER bare-401 a user-facing redirect endpoint
    expect(res.status).not.toBe(401)
  })

  it('redirects to /login when user is suspended', async () => {
    vi.mocked(requireUser).mockRejectedValueOnce(new AuthError('suspended'))
    const res = await GET(makeReq())
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/login')
  })

  it('returns 500 (not redirect) on unexpected auth errors', async () => {
    vi.mocked(requireUser).mockRejectedValueOnce(new Error('boom'))
    const res = await GET(makeReq())
    expect(res.status).toBe(500)
  })

  it('returns 500 when GROW_PAYMENT_LINK is missing', async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({ id: 1, agencyId: 42 } as any)
    delete process.env.GROW_PAYMENT_LINK

    const res = await GET(makeReq())

    expect(res.status).toBe(500)
  })

  it('redirects non-production payment attempts back to local settings', async () => {
    process.env.APP_ENV = 'local'
    process.env.GROW_MODE = 'sandbox'
    vi.mocked(requireUser).mockResolvedValueOnce({ id: 1, agencyId: 42 } as any)

    const res = await GET(makeReq())

    expect(res.status).toBe(302)
    const location = res.headers.get('location')!
    expect(location).toContain('/settings/update_payment')
    expect(location).toContain('mode=local')
  })

  it('returns 500 when local is configured with production payments', async () => {
    process.env.APP_ENV = 'local'
    process.env.GROW_MODE = 'production'
    vi.mocked(requireUser).mockResolvedValueOnce({ id: 1, agencyId: 42 } as any)

    const res = await GET(makeReq())

    expect(res.status).toBe(500)
  })

  it('returns 500 when production host does not match APP_HOST', async () => {
    process.env.APP_HOST = 'socialcrm.example'
    vi.mocked(requireUser).mockResolvedValueOnce({ id: 1, agencyId: 42 } as any)

    const res = await GET(makeReq())

    expect(res.status).toBe(500)
  })

  it('generates localhost return_url outside production', () => {
    process.env.APP_ENV = 'local'
    process.env.APP_HOST = 'socialcrm.example'

    const growUrl = new URL(getUpgradeLink(42))

    expect(growUrl.searchParams.get('return_url')).toBe('http://localhost:3000/billing/success')
  })

  it('throws when APP_HOST is missing in production link generation', () => {
    delete process.env.APP_HOST

    expect(() => getUpgradeLink(42)).toThrow('Missing APP_HOST in production')
  })

  it('does not leak the token in the response body', async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({ id: 1, agencyId: 42 } as any)
    const res = await GET(makeReq())
    const body = await res.text()
    // Body should be empty (302), token must only be in the Location header
    expect(body).toBe('')
  })
})
