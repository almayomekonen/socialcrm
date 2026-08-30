/**
 * Credential-shape validation and verifier dispatch on POST /auth/facebook.
 *
 * ⚠️ THE POINT OF THESE TESTS IS THAT THE ROUTE NOW ACCEPTS TWO CREDENTIALS AND
 * MUST NOT CONFUSE THEM. Sending an iOS Limited Login OIDC token to the classic
 * Graph verifier is not a degraded path — it is a guaranteed 401, and it is
 * exactly the failure this whole change exists to fix. Dispatch is therefore
 * asserted directly, by observing WHICH verifier ran.
 *
 * The verifiers themselves are mocked here on purpose: their internals are
 * covered by `verifyFacebookAccessToken.test.ts` and
 * `verifyFacebookLimitedLogin.test.ts`. What is under test is the routing and
 * the strictness of the body contract.
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

const classicVerify = vi.fn()
const limitedVerify = vi.fn()

vi.mock('@/lib/auth/verifyFacebookAccessToken', () => ({
  verifyFacebookAccessToken: (t: unknown) => classicVerify(t),
}))
vi.mock('@/lib/auth/verifyFacebookLimitedLogin', () => ({
  verifyFacebookLimitedLoginToken: (t: unknown) => limitedVerify(t),
}))

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'

const IP = '203.0.113.120'

async function post(body: unknown) {
  const { POST } = (await import('@/app/api/mobile/v1/auth/facebook/route')) as {
    POST: (r: Request) => Promise<Response>
  }
  return await POST(
    new Request('https://example.test/api/mobile/v1/auth/facebook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': IP },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(async () => {
  vi.unstubAllEnvs()
  vi.stubEnv('FACEBOOK_USER_AUTH_ENABLED', '1')
  vi.stubEnv('FACEBOOK_USER_AUTH_AGENCY_ALLOWLIST', 'all')
  classicVerify.mockReset()
  limitedVerify.mockReset()
  // Default: a verifier that refuses, so shape tests never reach the database.
  classicVerify.mockResolvedValue({ ok: false, reason: 'invalid_token' })
  limitedVerify.mockResolvedValue({ ok: false, reason: 'invalid_token' })
  await db('mobile_auth_attempts').where({ subject: `ip:${IP}` }).del()
})

afterAll(async () => {
  await db('mobile_auth_attempts').where({ subject: `ip:${IP}` }).del()
  await db.destroy()
})

describe('dispatch', () => {
  it('routes { accessToken } to the CLASSIC verifier only', async () => {
    await post({ accessToken: 'classic-token' })
    expect(classicVerify).toHaveBeenCalledTimes(1)
    expect(classicVerify).toHaveBeenCalledWith('classic-token')
    expect(limitedVerify).not.toHaveBeenCalled()
  })

  it('routes { authenticationToken, nonce } to the LIMITED verifier only', async () => {
    await post({ authenticationToken: 'oidc-jwt', nonce: 'n'.repeat(64) })
    expect(limitedVerify).toHaveBeenCalledTimes(1)
    expect(limitedVerify).toHaveBeenCalledWith('oidc-jwt')
    expect(classicVerify).not.toHaveBeenCalled()
  })

  it('does not pass the body nonce to the verifier — the signed claim is authoritative', async () => {
    await post({ authenticationToken: 'oidc-jwt', nonce: 'attacker-supplied' })
    expect(limitedVerify).toHaveBeenCalledWith('oidc-jwt')
    expect(limitedVerify.mock.calls[0]).toHaveLength(1)
  })
})

describe('strict shape', () => {
  const rejected = async (body: unknown) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(classicVerify).not.toHaveBeenCalled()
    expect(limitedVerify).not.toHaveBeenCalled()
  }

  it('rejects a MIXED credential body outright', async () => {
    await rejected({ accessToken: 'a', authenticationToken: 'b', nonce: 'c' })
  })

  it('rejects a classic token paired with only a nonce', async () => {
    await rejected({ accessToken: 'a', nonce: 'c' })
  })

  it('rejects extra keys alongside a classic token', async () => {
    await rejected({ accessToken: 'a', userId: 7 })
  })

  it('rejects extra keys alongside a Limited Login credential', async () => {
    await rejected({ authenticationToken: 'a', nonce: 'b', email: 'x@y.test' })
  })

  it('rejects a missing authenticationToken', async () => {
    await rejected({ nonce: 'b' })
  })

  it('rejects a missing nonce', async () => {
    await rejected({ authenticationToken: 'a' })
  })

  it('rejects empty strings in either shape', async () => {
    await rejected({ accessToken: '' })
    await rejected({ authenticationToken: '', nonce: 'b' })
    await rejected({ authenticationToken: 'a', nonce: '' })
  })

  it('rejects wrong types', async () => {
    await rejected({ accessToken: 42 })
    await rejected({ authenticationToken: { a: 1 }, nonce: 'b' })
    await rejected({ authenticationToken: 'a', nonce: ['b'] })
  })

  it('rejects an empty body and a non-object body', async () => {
    await rejected({})
    await rejected([])
  })
})

describe('downstream is unchanged', () => {
  it('a verified identity with no SocialCRM user is still refused — mobile never registers', async () => {
    limitedVerify.mockResolvedValue({
      ok: true,
      identity: {
        sub: 'fb-no-such-user',
        email: `nobody.${Date.now()}@example.test`,
        name: 'Nobody',
      },
    })
    const res = await post({ authenticationToken: 'oidc-jwt', nonce: 'n'.repeat(64) })
    // resolveFacebookLogin answers `register`; the route collapses that to 401.
    expect(res.status).toBe(401)
  })

  it('both credential types share one failure taxonomy', async () => {
    const a = await post({ accessToken: 'bad' })
    const b = await post({ authenticationToken: 'bad', nonce: 'n'.repeat(64) })
    expect(a.status).toBe(401)
    expect(b.status).toBe(401)
    expect(await a.json()).toEqual(await b.json())
  })

  it('is still 404 when the rollout flag is off, for BOTH shapes', async () => {
    vi.stubEnv('FACEBOOK_USER_AUTH_ENABLED', '0')
    expect((await post({ accessToken: 'a' })).status).toBe(404)
    expect((await post({ authenticationToken: 'a', nonce: 'b' })).status).toBe(404)
    expect(classicVerify).not.toHaveBeenCalled()
    expect(limitedVerify).not.toHaveBeenCalled()
  })

  it('records a throttle attempt for both shapes, keyed by IP only', async () => {
    await post({ accessToken: 'a' })
    await post({ authenticationToken: 'a', nonce: 'b' })
    const rows = await db('mobile_auth_attempts')
      .where({ kind: 'facebook', subject: `ip:${IP}` })
      .select('subject')
    expect(rows).toHaveLength(2)
    for (const r of rows) expect(r.subject.startsWith('ip:')).toBe(true)
  })

  it('malformed bodies consume no throttle budget', async () => {
    await post({ accessToken: 'a', authenticationToken: 'b', nonce: 'c' })
    const n = await db('mobile_auth_attempts')
      .where({ kind: 'facebook', subject: `ip:${IP}` })
      .count({ n: '*' })
      .first()
    expect(Number(n?.n)).toBe(0)
  })
})
