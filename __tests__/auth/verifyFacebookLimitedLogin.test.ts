/**
 * Facebook Limited Login (OIDC) verification.
 *
 * REAL CRYPTOGRAPHY AND A REAL DATABASE. Every token below is signed with an RSA
 * key generated in-process and verified through `jose` against the matching
 * public JWK — no signature check is stubbed. The nonce path hits the real
 * `mobile_auth_nonces` table, because single-use is a property of the row lock,
 * not of the code that calls it.
 *
 * ⚠️ THE TWO PROPERTIES THAT MATTER MOST are that a token nobody could sign is
 * rejected, and that a valid token cannot be replayed. Meta mints these with a
 * 90-day lifetime, so a regression in either is a three-month replay window.
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
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  SignJWT,
  createLocalJWKSet,
  createRemoteJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTVerifyGetKey,
  type KeyLike,
} from 'jose'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { issueLoginNonce } from '@/db/mobileAuthNonces'
import { verifyFacebookLimitedLoginToken } from '@/lib/auth/verifyFacebookLimitedLogin'

const APP_ID = '1576374570608325'
const ISSUER = 'https://www.facebook.com'
const IP = '203.0.113.99'
const KID = 'test-key-1'

let privateKey: KeyLike
let publicJwk: JWK
let jwks: JWTVerifyGetKey

/** A second, unrelated key — used to forge a signature the real key never made. */
let attackerKey: KeyLike

type Claims = Record<string, unknown>

async function sign(claims: Claims, opts: { key?: KeyLike; kid?: string; alg?: string } = {}) {
  const now = Math.floor(Date.now() / 1000)
  const jwt = new SignJWT({ ...claims })
    .setProtectedHeader({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? KID })
    .setIssuedAt(typeof claims.iat === 'number' ? (claims.iat as number) : now)
  if (!('exp' in claims)) jwt.setExpirationTime(now + 3600)
  return await jwt.sign(opts.key ?? privateKey)
}

/** A fresh, unspent nonce from the real table. */
async function freshNonce(): Promise<string> {
  return (await issueLoginNonce(IP)).nonce
}

async function baseClaims(overrides: Claims = {}): Promise<Claims> {
  return {
    iss: ISSUER,
    aud: APP_ID,
    sub: '27802810426038835',
    email: 'lead@example.test',
    name: 'Test Person',
    picture: 'https://example.test/p.jpg',
    nonce: await freshNonce(),
    ...overrides,
  }
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' }
  jwks = createLocalJWKSet({ keys: [publicJwk] })
  attackerKey = (await generateKeyPair('RS256')).privateKey
})

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('AUTH_FACEBOOK_APP_ID', APP_ID)
})

afterAll(async () => {
  await db('mobile_auth_nonces').where({ ip: IP }).del()
  await db.destroy()
})

describe('valid token', () => {
  it('returns the identity in the SAME shape as the classic verifier', async () => {
    const token = await sign(await baseClaims())
    const result = await verifyFacebookLimitedLoginToken(token, jwks)

    expect(result).toEqual({
      ok: true,
      identity: {
        sub: '27802810426038835',
        email: 'lead@example.test',
        name: 'Test Person',
        picture: 'https://example.test/p.jpg',
      },
    })
  })

  it('omits optional fields rather than inventing them', async () => {
    const claims = await baseClaims()
    delete claims.name
    delete claims.picture
    const result = await verifyFacebookLimitedLoginToken(await sign(claims), jwks)
    expect(result).toEqual({
      ok: true,
      identity: { sub: '27802810426038835', email: 'lead@example.test', name: undefined, picture: undefined },
    })
  })

  it('ignores a non-string picture instead of passing it through', async () => {
    const token = await sign(await baseClaims({ picture: { data: { url: 'x' } } }))
    const result = await verifyFacebookLimitedLoginToken(token, jwks)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.identity.picture).toBeUndefined()
  })
})

describe('signature', () => {
  it('rejects a token signed by a key that is not Facebook’s', async () => {
    const token = await sign(await baseClaims(), { key: attackerKey })
    expect(await verifyFacebookLimitedLoginToken(token, jwks)).toEqual({
      ok: false,
      reason: 'invalid_token',
    })
  })

  it('rejects a tampered payload', async () => {
    const token = await sign(await baseClaims())
    const [h, , s] = token.split('.')
    const forged = Buffer.from(
      JSON.stringify({ iss: ISSUER, aud: APP_ID, sub: 'attacker', email: 'a@b.test' }),
    ).toString('base64url')
    expect(await verifyFacebookLimitedLoginToken(`${h}.${forged}.${s}`, jwks)).toEqual({
      ok: false,
      reason: 'invalid_token',
    })
  })

  it('rejects an unsupported algorithm', async () => {
    // A key whose `alg` is not on the allow-list must not be evaluated at all.
    const ps = await generateKeyPair('PS256')
    const psJwks = createLocalJWKSet({
      keys: [{ ...(await exportJWK(ps.publicKey)), kid: KID, alg: 'PS256', use: 'sig' }],
    })
    const token = await sign(await baseClaims(), { key: ps.privateKey, alg: 'PS256' })
    expect(await verifyFacebookLimitedLoginToken(token, psJwks)).toEqual({
      ok: false,
      reason: 'invalid_token',
    })
  })

  it('rejects a malformed JWT', async () => {
    for (const bad of ['', 'not-a-jwt', 'a.b', 'a.b.c.d', '...']) {
      expect(await verifyFacebookLimitedLoginToken(bad, jwks)).toEqual({
        ok: false,
        reason: 'invalid_token',
      })
    }
  })

  it('rejects a non-string input', async () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(await verifyFacebookLimitedLoginToken(bad, jwks)).toEqual({
        ok: false,
        reason: 'invalid_token',
      })
    }
  })
})

describe('claims', () => {
  it('rejects a wrong issuer', async () => {
    const token = await sign(await baseClaims({ iss: 'https://evil.example' }))
    expect(await verifyFacebookLimitedLoginToken(token, jwks)).toEqual({
      ok: false,
      reason: 'invalid_token',
    })
  })

  it('rejects a wrong audience — a token for another Meta app', async () => {
    // This is the exact class of failure that put a Page/WhatsApp app id into
    // the mobile client once already.
    const token = await sign(await baseClaims({ aud: '962521689620138' }))
    expect(await verifyFacebookLimitedLoginToken(token, jwks)).toEqual({
      ok: false,
      reason: 'invalid_token',
    })
  })

  it('rejects an expired token', async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = await sign(await baseClaims({ exp: now - 3600, iat: now - 7200 }))
    expect(await verifyFacebookLimitedLoginToken(token, jwks)).toEqual({
      ok: false,
      reason: 'invalid_token',
    })
  })

  it('rejects a forward-dated iat beyond tolerance', async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = await sign(await baseClaims({ iat: now + 3600, exp: now + 7200 }))
    expect(await verifyFacebookLimitedLoginToken(token, jwks)).toEqual({
      ok: false,
      reason: 'invalid_token',
    })
  })

  it('rejects a token older than the age bound', async () => {
    const now = Math.floor(Date.now() / 1000)
    // Still unexpired, but far older than a legitimate sign-in could be.
    const token = await sign(await baseClaims({ iat: now - 3600, exp: now + 3600 }))
    expect(await verifyFacebookLimitedLoginToken(token, jwks)).toEqual({
      ok: false,
      reason: 'invalid_token',
    })
  })

  it('rejects a missing sub', async () => {
    const claims = await baseClaims()
    delete claims.sub
    expect(await verifyFacebookLimitedLoginToken(await sign(claims), jwks)).toEqual({
      ok: false,
      reason: 'invalid_token',
    })
  })

  it('returns no_email — not invalid_token — when email is absent', async () => {
    const claims = await baseClaims()
    delete claims.email
    expect(await verifyFacebookLimitedLoginToken(await sign(claims), jwks)).toEqual({
      ok: false,
      reason: 'no_email',
    })
  })

  it('treats a blank email as no_email', async () => {
    const token = await sign(await baseClaims({ email: '   ' }))
    expect(await verifyFacebookLimitedLoginToken(token, jwks)).toEqual({
      ok: false,
      reason: 'no_email',
    })
  })
})

describe('nonce', () => {
  it('rejects a token with no nonce claim', async () => {
    const claims = await baseClaims()
    delete claims.nonce
    expect(await verifyFacebookLimitedLoginToken(await sign(claims), jwks)).toEqual({
      ok: false,
      reason: 'invalid_token',
    })
  })

  it('rejects a nonce this server never issued', async () => {
    const token = await sign(await baseClaims({ nonce: 'a'.repeat(64) }))
    expect(await verifyFacebookLimitedLoginToken(token, jwks)).toEqual({
      ok: false,
      reason: 'invalid_token',
    })
  })

  it('CONSUMES the nonce — the same token cannot be replayed', async () => {
    const token = await sign(await baseClaims())
    expect((await verifyFacebookLimitedLoginToken(token, jwks)).ok).toBe(true)
    // Identical bytes, still perfectly signed and unexpired.
    expect(await verifyFacebookLimitedLoginToken(token, jwks)).toEqual({
      ok: false,
      reason: 'invalid_token',
    })
  })

  it('rejects an expired nonce even though the JWT is valid', async () => {
    const nonce = await freshNonce()
    await db('mobile_auth_nonces')
      .where({ nonce_hash: createHash('sha256').update(nonce).digest('hex') })
      .update({ expires_at: new Date(Date.now() - 1000) })

    const token = await sign(await baseClaims({ nonce }))
    expect(await verifyFacebookLimitedLoginToken(token, jwks)).toEqual({
      ok: false,
      reason: 'invalid_token',
    })
  })

  it('does NOT spend a nonce when the signature is bad', async () => {
    // Otherwise a forged token would be a denial of service against a real
    // user's pending sign-in.
    const nonce = await freshNonce()
    const token = await sign(await baseClaims({ nonce }), { key: attackerKey })
    expect((await verifyFacebookLimitedLoginToken(token, jwks)).ok).toBe(false)

    const row = await db('mobile_auth_nonces')
      .where({ nonce_hash: createHash('sha256').update(nonce).digest('hex') })
      .first()
    expect(row?.consumed_at).toBeNull()
  })

  it('does NOT spend a nonce when the audience is wrong', async () => {
    const nonce = await freshNonce()
    const token = await sign(await baseClaims({ nonce, aud: '962521689620138' }))
    expect((await verifyFacebookLimitedLoginToken(token, jwks)).ok).toBe(false)

    const row = await db('mobile_auth_nonces')
      .where({ nonce_hash: createHash('sha256').update(nonce).digest('hex') })
      .first()
    expect(row?.consumed_at).toBeNull()
  })
})

describe('configuration', () => {
  it('fails closed with `config` when no app id is set — never "any audience"', async () => {
    vi.stubEnv('AUTH_FACEBOOK_APP_ID', '')
    const token = await sign(await baseClaims())
    expect(await verifyFacebookLimitedLoginToken(token, jwks)).toEqual({
      ok: false,
      reason: 'config',
    })
  })
})

/**
 * A REAL HTTP server, not a stubbed `fetch`.
 *
 * jose's Node runtime fetches a remote JWKS over `node:https`/`node:http`, so a
 * `globalThis.fetch` stub is never consulted — a test built on one would pass
 * while proving nothing about rotation. Serving the key set over a real socket
 * exercises the actual refetch path.
 */
describe('JWKS rotation', () => {
  let server: Server
  let baseUrl: string
  let served: JWK[] = []
  let fetches = 0
  let status = 200

  beforeAll(async () => {
    server = createServer((_req, res) => {
      fetches += 1
      if (status !== 200) {
        res.writeHead(status)
        res.end('nope')
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ keys: served }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${addr.port}/jwks`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  beforeEach(() => {
    fetches = 0
    status = 200
    served = [publicJwk]
  })

  const remote = () =>
    createRemoteJWKSet(new URL(baseUrl), {
      cacheMaxAge: 10 * 60 * 1000,
      cooldownDuration: 0,
      timeoutDuration: 5 * 1000,
    })

  it('fetches the key set and verifies against it', async () => {
    const result = await verifyFacebookLimitedLoginToken(await sign(await baseClaims()), remote())
    expect(result.ok).toBe(true)
    expect(fetches).toBe(1)
  })

  it('caches — a second verification does not refetch', async () => {
    const jwksInstance = remote()
    await verifyFacebookLimitedLoginToken(await sign(await baseClaims()), jwksInstance)
    await verifyFacebookLimitedLoginToken(await sign(await baseClaims()), jwksInstance)
    expect(fetches).toBe(1)
  })

  it('REFETCHES on an unknown kid, then still rejects if the key never appears', async () => {
    const jwksInstance = remote()
    await verifyFacebookLimitedLoginToken(await sign(await baseClaims()), jwksInstance)
    expect(fetches).toBe(1)

    // A kid the served JWKS does not contain: jose refetches to allow for
    // rotation, finds nothing, and the token is rejected. An unresolved kid must
    // never mean "skip the signature check".
    const token = await sign(await baseClaims(), { kid: 'rotated-away' })
    expect(await verifyFacebookLimitedLoginToken(token, jwksInstance)).toEqual({
      ok: false,
      reason: 'invalid_token',
    })
    expect(fetches).toBeGreaterThan(1)
  })

  it('accepts a token signed by a key rotated in AFTER the cache was primed', async () => {
    const jwksInstance = remote()
    // Prime the cache while only the original key is published.
    await verifyFacebookLimitedLoginToken(await sign(await baseClaims()), jwksInstance)
    expect(fetches).toBe(1)

    // Facebook rotates: a new key appears at the endpoint.
    const rotated = await generateKeyPair('RS256')
    served = [
      publicJwk,
      { ...(await exportJWK(rotated.publicKey)), kid: 'rotated-in', alg: 'RS256', use: 'sig' },
    ]

    const token = await sign(await baseClaims(), { key: rotated.privateKey, kid: 'rotated-in' })
    expect((await verifyFacebookLimitedLoginToken(token, jwksInstance)).ok).toBe(true)
    // Success required going back to the endpoint — the key was not in the cache.
    expect(fetches).toBeGreaterThan(1)
  })

  it('rejects when the JWKS endpoint fails, rather than falling open', async () => {
    status = 500
    expect(
      await verifyFacebookLimitedLoginToken(await sign(await baseClaims()), remote()),
    ).toEqual({ ok: false, reason: 'invalid_token' })
  })
})
