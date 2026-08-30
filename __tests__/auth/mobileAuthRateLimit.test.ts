/**
 * Rate limiting on the four previously-unprotected mobile auth routes.
 *
 * REAL DATABASE, REAL LIMITER. The throttle counts rows in `mobile_auth_attempts`
 * — mocking that away would test nothing, because the whole point of the
 * DB-backed design is that it works across processes where an in-memory counter
 * would not.
 *
 * ⚠️ EACH ROUTE'S EXISTING SEMANTICS ARE ASSERTED ALONGSIDE THE LIMIT. A throttle
 * that silently changed logout's idempotency, or turned a refresh failure into a
 * new status code, would be a regression even though the limit "works".
 */
import { vi } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  cacheTag: vi.fn(),
  unstable_cache: vi.fn((fn: unknown) => fn),
}))
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(() => null), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(() => ({ get: vi.fn(() => null) })),
}))

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'

const IP = '203.0.113.77'

async function post(path: string, body: unknown) {
  const { POST } = (await import(`@/app/api/mobile/v1/auth/${path}/route`)) as {
    POST: (r: Request) => Promise<Response>
  }
  const res = await POST(
    new Request(`https://example.test/api/mobile/v1/auth/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': IP },
      body: JSON.stringify(body),
    }),
  )
  return res.status
}

/** Pre-fills the window so the NEXT call is over the ceiling. */
async function fillWindow(kind: string, n: number) {
  const rows = Array.from({ length: n }, () => ({ kind, subject: `ip:${IP}` }))
  await db('mobile_auth_attempts').insert(rows)
}

beforeEach(async () => {
  await db('mobile_auth_attempts').where({ subject: `ip:${IP}` }).del()
})

afterAll(async () => {
  await db('mobile_auth_attempts').where({ subject: `ip:${IP}` }).del()
  await db.destroy()
})

describe('google', () => {
  it('answers 401 once the IP ceiling is reached, without changing the taxonomy', async () => {
    // Below the ceiling the token is still genuinely rejected — 401 either way,
    // which is exactly why the limit cannot be used to probe the endpoint.
    expect(await post('google', { idToken: 'not-a-real-token' })).toBe(401)

    await fillWindow('google', 60)
    expect(await post('google', { idToken: 'not-a-real-token' })).toBe(401)
  })

  it('still rejects a malformed body BEFORE consuming any budget', async () => {
    // Validation precedes throttling, so junk requests cannot exhaust the window
    // for a legitimate user behind the same NAT.
    expect(await post('google', { idToken: 42 })).toBe(400)
    const n = await db('mobile_auth_attempts')
      .where({ kind: 'google', subject: `ip:${IP}` })
      .count({ n: '*' })
      .first()
    expect(Number(n?.n)).toBe(0)
  })
})

describe('refresh', () => {
  it('rejects with 401 at the ceiling — the same shape as every refresh failure', async () => {
    await fillWindow('refresh', 200)
    expect(await post('refresh', { refreshToken: 'whatever' })).toBe(401)
  })

  it('has a ceiling generous enough for real devices', async () => {
    // ~4 refreshes/hour per device at a 15-minute access TTL; 200 leaves room for
    // dozens of users behind one carrier NAT. A tight limit here signs people OUT.
    await fillWindow('refresh', 100)
    expect(await post('refresh', { refreshToken: 'whatever' })).toBe(401)
    const attempts = await db('mobile_auth_attempts')
      .where({ kind: 'refresh', subject: `ip:${IP}` })
      .count({ n: '*' })
      .first()
    // 100 seeded + 1 recorded => the request was served, not throttled.
    expect(Number(attempts?.n)).toBe(101)
  })
})

describe('logout', () => {
  it('REMAINS 204 when throttled — idempotency is never sacrificed', async () => {
    await fillWindow('logout', 120)
    // The ceiling drops the work, not the response: a client must always be able
    // to complete sign-out.
    expect(await post('logout', { refreshToken: 'whatever' })).toBe(204)
  })

  it('is still 204 for a malformed body', async () => {
    expect(await post('logout', {})).toBe(204)
  })
})

describe('dev', () => {
  it('returns 404 at the ceiling, indistinguishable from the route not existing', async () => {
    await fillWindow('dev', 30)
    // The other four locks also answer 404; a throttled caller must not be able
    // to tell "rate limited" from "no such route".
    expect(await post('dev', {})).toBe(404)
  })
})

describe('throttle subjects never contain credentials', () => {
  it('records only ip: keys for these four routes', async () => {
    await post('google', { idToken: 'sensitive-token-value' })
    await post('refresh', { refreshToken: 'sensitive-refresh-value' })
    await post('logout', { refreshToken: 'sensitive-refresh-value' })

    const rows = await db('mobile_auth_attempts')
      .whereIn('kind', ['google', 'refresh', 'logout'])
      .select('subject')

    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.subject.startsWith('ip:')).toBe(true)
      expect(r.subject).not.toContain('sensitive')
    }
  })
})
