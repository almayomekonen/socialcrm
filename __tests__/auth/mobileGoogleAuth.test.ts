/**
 * Production mobile Google sign-in — `POST /api/mobile/v1/auth/google`.
 *
 * REAL TOKENS, REAL VERIFIER, REAL DATABASE.
 *
 * The ID tokens below are genuinely signed with a locally generated RSA key, and
 * only Google's *key discovery* is mocked — `jwtVerify` itself runs for real.
 * That is the whole point: stubbing the verifier would leave the signature,
 * issuer and audience checks — the entire security boundary — untested, and a
 * test that mocks the thing it is meant to prove is worse than no test, because
 * it reports success either way.
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

/**
 * Only `createRemoteJWKSet` is replaced — with a resolver that returns our local
 * public key instead of fetching Google's. Everything else in `jose`, including
 * the verification that decides these tests, is the real implementation.
 */
vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>()
  return {
    ...actual,
    createRemoteJWKSet: () => async () => (await keyPairPromise).publicKey,
  }
})

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SignJWT, generateKeyPair, jwtVerify } from 'jose'
import { db } from '@/config/db'

const keyPairPromise = generateKeyPair('RS256')
/** A second, unrelated key — used to forge a signature Google never made. */
const attackerKeyPromise = generateKeyPair('RS256')

const IOS_CLIENT_ID = 'ios-test.apps.googleusercontent.com'
const GOOGLE_ISSUER = 'https://accounts.google.com'

const AGENCY = 950_001
const USER_OK = 951_001
const USER_UNVERIFIED = 951_002
const USER_SUSPENDED = 951_003

const EMAIL_OK = 'mobile.ok@example.test'
const EMAIL_UNVERIFIED = 'mobile.unverified@example.test'
const EMAIL_SUSPENDED = 'mobile.suspended@example.test'
const EMAIL_STRANGER = 'not.a.socialcrm.user@example.test'

type TokenOverrides = {
  email?: string
  audience?: string
  issuer?: string
  emailVerified?: boolean | string
  signWithAttackerKey?: boolean
}

async function googleIdToken(overrides: TokenOverrides = {}): Promise<string> {
  const { privateKey } = overrides.signWithAttackerKey
    ? await attackerKeyPromise
    : await keyPairPromise

  return await new SignJWT({
    email: overrides.email ?? EMAIL_OK,
    email_verified: overrides.emailVerified ?? true,
    name: 'Mobile Tester',
    picture: 'https://lh3.googleusercontent.com/test-photo',
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('google-sub-12345')
    .setIssuer(overrides.issuer ?? GOOGLE_ISSUER)
    .setAudience(overrides.audience ?? IOS_CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
}

/** Invokes the route exactly as Next would, with a JSON body. */
async function postGoogle(body: unknown, headers: Record<string, string> = {}) {
  const { POST } = await import('@/app/api/mobile/v1/auth/google/route')
  const res = await POST(
    new Request('https://example.test/api/mobile/v1/auth/google', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  )
  const text = await res.text()
  return { status: res.status, body: text.length > 0 ? JSON.parse(text) : null }
}

beforeAll(async () => {
  process.env.MOBILE_GOOGLE_IOS_CLIENT_ID = IOS_CLIENT_ID

  await db('agencies').insert({ id: AGENCY, name: '__test_mobile_google__' }).onConflict('id').ignore()

  // `users.name` is GENERATED ALWAYS — it is derived from firstName/lastName and
  // cannot be written directly.
  const base = { agencyId: AGENCY, role: 'AGNT' as const, sessionVersion: 0, lastName: 'Tester' }
  await db('users')
    .insert([
      { id: USER_OK, firstName: 'OK', email: EMAIL_OK, emailVerifiedAt: new Date(), ...base },
      { id: USER_UNVERIFIED, firstName: 'Unverified', email: EMAIL_UNVERIFIED, emailVerifiedAt: null, ...base },
      { id: USER_SUSPENDED, firstName: 'Suspended', email: EMAIL_SUSPENDED, emailVerifiedAt: new Date(), suspended: true, ...base },
    ])
    .onConflict('id')
    .ignore()
})

beforeEach(async () => {
  await db('mobile_refresh_tokens').whereIn('user_id', [USER_OK, USER_UNVERIFIED]).del()
  await db('users').where({ id: USER_UNVERIFIED }).update({ emailVerifiedAt: null, sessionVersion: 0 })
})

afterAll(async () => {
  await db('mobile_refresh_tokens')
    .whereIn('user_id', [USER_OK, USER_UNVERIFIED, USER_SUSPENDED])
    .del()
  await db('users').whereIn('id', [USER_OK, USER_UNVERIFIED, USER_SUSPENDED]).del()
  await db('agencies').where({ id: AGENCY }).del()
  await db.destroy()
})

describe('mobile Google sign-in — the happy path', () => {
  it('exchanges a verified Google identity for a real mobile session', async () => {
    const { status, body } = await postGoogle({ idToken: await googleIdToken() })

    expect(status).toBe(200)
    expect(typeof body.accessToken).toBe('string')
    expect(typeof body.refreshToken).toBe('string')

    // The access token is the SAME credential the rest of the API accepts:
    // signed with the mobile key, carrying a mandatory `typ` and `sv`.
    const { payload } = await jwtVerify(
      body.accessToken,
      new TextEncoder().encode(process.env.MOBILE_JWT_SECRET!),
      { algorithms: ['HS256'] },
    )
    expect(payload.id).toBe(USER_OK)
    expect(payload.typ).toBe('mobile_access')
    expect(payload.sv).toBe(0)
  })

  it('opens a NEW refresh family so this device can be revoked alone', async () => {
    await postGoogle({ idToken: await googleIdToken() }, { 'x-device-id': 'device-a' })
    await postGoogle({ idToken: await googleIdToken() }, { 'x-device-id': 'device-b' })

    const rows = await db('mobile_refresh_tokens').where({ user_id: USER_OK }).select('family_id', 'device_id')
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.family_id)).size).toBe(2)
  })

  it('leaks no internal field — only the two credentials', async () => {
    const { body } = await postGoogle({ idToken: await googleIdToken() })

    expect(Object.keys(body).sort()).toEqual(['accessToken', 'refreshToken'])
    const serialized = JSON.stringify(body)
    for (const forbidden of ['agencyId', 'idNum', 'sessionVersion', 'token_hash', 'gglSub', EMAIL_OK]) {
      expect(serialized).not.toContain(forbidden)
    }
  })
})

describe('mobile Google sign-in — rejected credentials', () => {
  it('rejects a forged signature', async () => {
    const { status } = await postGoogle({ idToken: await googleIdToken({ signWithAttackerKey: true }) })
    expect(status).toBe(401)
  })

  it('rejects a token from the wrong issuer', async () => {
    const { status } = await postGoogle({ idToken: await googleIdToken({ issuer: 'https://evil.test' }) })
    expect(status).toBe(401)
  })

  it('rejects a token minted for another audience', async () => {
    const { status } = await postGoogle({
      idToken: await googleIdToken({ audience: 'someone-elses-client.apps.googleusercontent.com' }),
    })
    expect(status).toBe(401)
  })

  it('rejects an unverified Google email', async () => {
    const { status } = await postGoogle({ idToken: await googleIdToken({ emailVerified: false }) })
    expect(status).toBe(401)
  })

  it('rejects a verified Google user who is not a SocialCRM user, and never creates one', async () => {
    const before = await db('users').count({ n: '*' }).first()
    const { status } = await postGoogle({ idToken: await googleIdToken({ email: EMAIL_STRANGER }) })
    const after = await db('users').count({ n: '*' }).first()

    // Indistinguishable from a bad token: not an account-existence oracle.
    expect(status).toBe(401)
    expect(Number(after?.n)).toBe(Number(before?.n))
  })

  /**
   * `no_agency` is deliberately NOT tested: `users.agencyId` is NOT NULL in the
   * schema, so a user without a tenant cannot be created to test against. The
   * branch is kept in the route as defence in depth (and to mirror
   * `requireMobileUser`'s taxonomy exactly), not because it is reachable today.
   */
  it('reports suspension with the existing taxonomy', async () => {
    const suspended = await postGoogle({ idToken: await googleIdToken({ email: EMAIL_SUSPENDED }) })
    expect(suspended.status).toBe(403)
    expect(suspended.body.error.code).toBe('suspended')
  })

  it('refuses any body field other than the token', async () => {
    // The guard that stops a future `email` field being honoured as identity.
    const { status } = await postGoogle({
      idToken: await googleIdToken(),
      email: 'attacker@example.test',
    })
    expect(status).toBe(400)
  })

  it('refuses a missing or non-string token', async () => {
    expect((await postGoogle({})).status).toBe(400)
    expect((await postGoogle({ idToken: 42 })).status).toBe(400)
  })
})

describe('first proof of email ownership', () => {
  it('revokes prior web sessions AND mobile refresh families before issuing', async () => {
    // A session that existed before anyone proved they own the address.
    const stale = await db('mobile_refresh_tokens')
      .insert({
        user_id: USER_UNVERIFIED,
        family_id: '00000000-0000-4000-8000-000000000001',
        token_hash: 'stale-hash-for-first-verification-test',
        expires_at: new Date(Date.now() + 86_400_000),
      })
      .returning('id')

    const { status } = await postGoogle({ idToken: await googleIdToken({ email: EMAIL_UNVERIFIED }) })
    expect(status).toBe(200)

    const revoked = await db('mobile_refresh_tokens').where({ id: stale[0].id ?? stale[0] }).first()
    expect(revoked.revoked_at).not.toBeNull()

    const user = await db('users').where({ id: USER_UNVERIFIED }).first('sessionVersion', 'emailVerifiedAt')
    expect(Number(user.sessionVersion)).toBe(1)
    expect(user.emailVerifiedAt).not.toBeNull()
  })

  it('issues a token that SURVIVES the revocation it just performed', async () => {
    const { body } = await postGoogle({ idToken: await googleIdToken({ email: EMAIL_UNVERIFIED }) })

    // Minted after the bump, so its `sv` matches the user's current version —
    // otherwise the very first request would 401.
    const { payload } = await jwtVerify(
      body.accessToken,
      new TextEncoder().encode(process.env.MOBILE_JWT_SECRET!),
      { algorithms: ['HS256'] },
    )
    const user = await db('users').where({ id: USER_UNVERIFIED }).first('sessionVersion')
    expect(payload.sv).toBe(Number(user.sessionVersion))
  })
})

describe('the lifecycle Google sign-in feeds into is unchanged', () => {
  /** Drives the real refresh route, so rotation produces a real successor. */
  async function postRefresh(refreshToken: string) {
    const { POST } = await import('@/app/api/mobile/v1/auth/refresh/route')
    const res = await POST(
      new Request('https://example.test/api/mobile/v1/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }),
    )
    const text = await res.text()
    return { status: res.status, body: text.length > 0 ? JSON.parse(text) : null }
  }

  it('rotates a Google-issued credential exactly once', async () => {
    const { body } = await postGoogle({ idToken: await googleIdToken() })

    const rotated = await postRefresh(body.refreshToken)
    expect(rotated.status).toBe(200)
    expect(rotated.body.refreshToken).not.toBe(body.refreshToken)

    // The original is spent. Rotation means valid exactly once.
    expect((await postRefresh(body.refreshToken)).status).toBe(401)
  })

  it('kills the SUCCESSOR token when the original is replayed', async () => {
    /**
     * The property that matters. Revoking only the replayed credential would
     * leave whoever rotated it — potentially the attacker — holding a live
     * token. The whole family must die, including the newer generation.
     */
    const { body } = await postGoogle({ idToken: await googleIdToken() })
    const rotated = await postRefresh(body.refreshToken)
    const successor = rotated.body.refreshToken

    // Replay the already-spent original.
    expect((await postRefresh(body.refreshToken)).status).toBe(401)

    // The successor, which was live a moment ago, is now dead too.
    expect((await postRefresh(successor)).status).toBe(401)

    const family = await db('mobile_refresh_tokens')
      .where({ user_id: USER_OK })
      .select('revoked_at', 'revoked_reason')
    expect(family.every((r) => r.revoked_at !== null)).toBe(true)
    expect(family.some((r) => r.revoked_reason === 'reuse_detected')).toBe(true)
  })

  it('logs out one device without touching the other', async () => {
    const { POST: LOGOUT } = await import('@/app/api/mobile/v1/auth/logout/route')

    const deviceA = await postGoogle({ idToken: await googleIdToken() }, { 'x-device-id': 'a' })
    const deviceB = await postGoogle({ idToken: await googleIdToken() }, { 'x-device-id': 'b' })

    const res = await LOGOUT(
      new Request('https://example.test/api/mobile/v1/auth/logout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: deviceA.body.refreshToken }),
      }),
    )
    expect(res.status).toBe(204)

    // A is gone; B is untouched — that separation is why families exist.
    expect((await postRefresh(deviceA.body.refreshToken)).status).toBe(401)
    expect((await postRefresh(deviceB.body.refreshToken)).status).toBe(200)
  })
})
