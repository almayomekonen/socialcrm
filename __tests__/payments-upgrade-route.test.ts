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
import { GET } from '@/app/api/payments/upgrade/route'

const TOKEN_SECRET = 'test_token_secret_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const PAYMENT_LINK = 'https://pay.grow.link/test-link-id'

beforeAll(() => {
  process.env.GROW_TOKEN_SECRET = TOKEN_SECRET
  process.env.GROW_PAYMENT_LINK = PAYMENT_LINK
})

beforeEach(() => {
  vi.mocked(requireUser).mockReset()
  process.env.GROW_TOKEN_SECRET = TOKEN_SECRET
  process.env.GROW_PAYMENT_LINK = PAYMENT_LINK
})

function makeReq() {
  return new NextRequest('http://localhost:3000/api/payments/upgrade', { method: 'GET' })
}

describe('GET /api/payments/upgrade', () => {
  it('redirects authenticated user to Grow with a verifiable external_id', async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({ id: 1, agencyId: 42 } as any)

    const res = await GET(makeReq())

    expect(res.status).toBe(302)
    const location = res.headers.get('location')!
    expect(location).toContain(PAYMENT_LINK)
    const url = new URL(location)
    const token = url.searchParams.get('external_id')
    expect(token).toBeTruthy()

    // Token must decode to the EXACT agencyId server-side (no trust in the URL)
    const verified = verifyToken(token!)
    expect(verified.agencyId).toBe(42)
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

  it('does not leak the token in the response body', async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({ id: 1, agencyId: 42 } as any)
    const res = await GET(makeReq())
    const body = await res.text()
    // Body should be empty (302), token must only be in the Location header
    expect(body).toBe('')
  })
})
