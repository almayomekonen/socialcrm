/**
 * Server-minted login nonces for mobile Facebook Limited Login.
 *
 * REAL DATABASE. The properties under test — single-use consumption under a row
 * lock, hash-only persistence, uniqueness — are properties of the storage layer.
 * Mocking the database away would assert only that the code calls the functions
 * it calls, which is exactly the class of test that passes while replay works.
 *
 * ⚠️ THE CENTRAL PROPERTY IS SINGLE USE. Meta mints Limited Login tokens with a
 * 90-day lifetime, so a nonce that can be spent twice means a captured OIDC token
 * is replayable for three months. Two tests below attack that directly: sequential
 * reuse and concurrent reuse.
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

import { createHash } from 'crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { consumeLoginNonce, issueLoginNonce, NONCE_TTL_MINUTES } from '@/db/mobileAuthNonces'

const IP = '203.0.113.91'

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

async function post(body: unknown, opts: { enabled?: boolean } = {}) {
  vi.stubEnv('FACEBOOK_USER_AUTH_ENABLED', opts.enabled === false ? '0' : '1')
  const { POST } = (await import('@/app/api/mobile/v1/auth/facebook/nonce/route')) as {
    POST: (r: Request) => Promise<Response>
  }
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': IP },
  }
  if (body !== undefined) init.body = JSON.stringify(body)
  return await POST(new Request('https://example.test/api/mobile/v1/auth/facebook/nonce', init))
}

async function fillWindow(n: number) {
  await db('mobile_auth_attempts').insert(
    Array.from({ length: n }, () => ({ kind: 'facebook_nonce', subject: `ip:${IP}` })),
  )
}

beforeEach(async () => {
  vi.unstubAllEnvs()
  await db('mobile_auth_attempts').where({ subject: `ip:${IP}` }).del()
  await db('mobile_auth_nonces').where({ ip: IP }).del()
})

afterAll(async () => {
  await db('mobile_auth_attempts').where({ subject: `ip:${IP}` }).del()
  await db('mobile_auth_nonces').where({ ip: IP }).del()
  await db.destroy()
})

describe('generation', () => {
  it('mints 256 bits of CSPRNG output as hex', async () => {
    const { nonce } = await issueLoginNonce(IP)
    expect(nonce).toMatch(/^[0-9a-f]{64}$/)
  })

  it('expires five minutes out', async () => {
    const before = Date.now()
    const { expiresAt } = await issueLoginNonce(IP)
    const delta = expiresAt.getTime() - before
    expect(NONCE_TTL_MINUTES).toBe(5)
    // Generous bounds: this asserts the TTL constant is wired through, not clock precision.
    expect(delta).toBeGreaterThan(4 * 60 * 1000)
    expect(delta).toBeLessThanOrEqual(5 * 60 * 1000 + 5_000)
  })

  it('never repeats', async () => {
    const seen = new Set<string>()
    for (let i = 0; i < 25; i++) seen.add((await issueLoginNonce(IP)).nonce)
    expect(seen.size).toBe(25)
  })
})

describe('hash-only persistence', () => {
  it('stores the digest and NEVER the nonce itself', async () => {
    const { nonce } = await issueLoginNonce(IP)

    const row = await db('mobile_auth_nonces').where({ nonce_hash: sha256(nonce) }).first()
    expect(row).toBeTruthy()

    // The raw value must not appear in ANY column of the row.
    for (const value of Object.values(row as Record<string, unknown>)) {
      expect(String(value)).not.toContain(nonce)
    }
  })

  it('a database reader cannot find the nonce by scanning the table', async () => {
    const { nonce } = await issueLoginNonce(IP)
    const hit = await db('mobile_auth_nonces').where({ nonce_hash: nonce }).first()
    // Searching for the raw value where the digest lives finds nothing.
    expect(hit).toBeUndefined()
  })
})

describe('single-use consumption', () => {
  it('accepts a nonce exactly once', async () => {
    const { nonce } = await issueLoginNonce(IP)
    expect(await consumeLoginNonce(nonce)).toEqual({ ok: true })
    expect(await consumeLoginNonce(nonce)).toEqual({ ok: false, reason: 'already_used' })
  })

  it('CONCURRENT replays cannot both win', async () => {
    // Without `forUpdate` both transactions read consumed_at = null and both
    // succeed — this is the test that would fail if the row lock were dropped.
    const { nonce } = await issueLoginNonce(IP)
    const results = await Promise.all([consumeLoginNonce(nonce), consumeLoginNonce(nonce)])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
  })

  it('rejects a nonce it never issued', async () => {
    expect(await consumeLoginNonce('f'.repeat(64))).toEqual({ ok: false, reason: 'unknown' })
  })
})

describe('expiry', () => {
  it('refuses an expired nonce and burns the row', async () => {
    const { nonce } = await issueLoginNonce(IP)
    await db('mobile_auth_nonces')
      .where({ nonce_hash: sha256(nonce) })
      .update({ expires_at: new Date(Date.now() - 1000) })

    expect(await consumeLoginNonce(nonce)).toEqual({ ok: false, reason: 'expired' })

    const row = await db('mobile_auth_nonces').where({ nonce_hash: sha256(nonce) }).first()
    expect(row?.consumed_at).not.toBeNull()
  })
})

describe('route', () => {
  it('returns a nonce and persists only its digest', async () => {
    const res = await post({})
    expect(res.status).toBe(200)
    const body = (await res.json()) as { nonce?: string }
    expect(body.nonce).toMatch(/^[0-9a-f]{64}$/)

    const row = await db('mobile_auth_nonces')
      .where({ nonce_hash: sha256(body.nonce as string) })
      .first()
    expect(row).toBeTruthy()
  })

  it('accepts a request with no body at all', async () => {
    expect((await post(undefined)).status).toBe(200)
  })

  it('rejects any body key — a caller must never choose its own nonce', async () => {
    expect((await post({ nonce: 'attacker-chosen' })).status).toBe(400)
    expect((await post({ anything: 1 })).status).toBe(400)
  })

  it('rejects a non-object body', async () => {
    expect((await post([])).status).toBe(400)
  })

  it('is 404 when the rollout flag is off, admitting nothing', async () => {
    const res = await post({}, { enabled: false })
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('')
  })

  it('answers 429 at the IP ceiling', async () => {
    await fillWindow(120)
    expect((await post({})).status).toBe(429)
  })

  it('does not consume budget when the body is malformed', async () => {
    await post({ nonce: 'x' })
    const n = await db('mobile_auth_attempts')
      .where({ kind: 'facebook_nonce', subject: `ip:${IP}` })
      .count({ n: '*' })
      .first()
    expect(Number(n?.n)).toBe(0)
  })

  it('records exactly one attempt per issued nonce', async () => {
    await post({})
    await post({})
    const n = await db('mobile_auth_attempts')
      .where({ kind: 'facebook_nonce', subject: `ip:${IP}` })
      .count({ n: '*' })
      .first()
    expect(Number(n?.n)).toBe(2)
  })

  it('never keys the throttle on the nonce itself', async () => {
    const res = await post({})
    const { nonce } = (await res.json()) as { nonce: string }
    const rows = await db('mobile_auth_attempts')
      .where({ kind: 'facebook_nonce' })
      .select('subject')
    for (const r of rows) {
      expect(r.subject.startsWith('ip:')).toBe(true)
      expect(r.subject).not.toContain(nonce)
    }
  })
})
