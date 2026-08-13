import { SignJWT } from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = store.get(name)
      return value ? { value } : undefined
    },
    set: (name: string, value: string) => {
      store.set(name, value)
    },
    delete: (name: string) => {
      store.delete(name)
    },
  })),
  headers: vi.fn(async () => ({ get: () => null })),
}))

import {
  FB_LOGIN_COOKIE,
  FB_LOGIN_PROOF_TYPE,
  clearFacebookLoginProof,
  facebookSubFromProof,
  isFacebookSubUniqueViolation,
  readFacebookLoginProof,
  setFacebookLoginProof,
} from '@/lib/auth/fbLoginProof'
import { getUser } from '@/db/auth'

function key() {
  return new TextEncoder().encode(process.env.JWT_SECRET)
}

describe('fb_login proof cookie', () => {
  beforeEach(() => {
    store.clear()
  })

  it('round-trips a verified Facebook user id and never stores it as session id', async () => {
    await setFacebookLoginProof({ facebookSub: '1000444', name: 'Dana' })
    const proof = await readFacebookLoginProof()
    expect(proof).toEqual({ facebookSub: '1000444', name: 'Dana', picture: undefined })
    expect(store.has(FB_LOGIN_COOKIE)).toBe(true)
    expect(store.has('user')).toBe(false)
  })

  it('rejects a token that is not typ fb_login', async () => {
    const token = await new SignJWT({ facebookSub: '1000444', typ: 'session', id: 7 })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('10m')
      .sign(key())
    store.set(FB_LOGIN_COOKIE, token)
    await expect(readFacebookLoginProof()).resolves.toBeNull()
  })

  it('rejects a proof that carries an `id` claim so it cannot be confused with a session', async () => {
    const token = await new SignJWT({
      typ: FB_LOGIN_PROOF_TYPE,
      facebookSub: '1000444',
      id: 7,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('10m')
      .sign(key())
    store.set(FB_LOGIN_COOKIE, token)
    await expect(readFacebookLoginProof()).resolves.toBeNull()
  })

  it('getUser rejects an fb_login token presented as the session cookie', async () => {
    await setFacebookLoginProof({ facebookSub: '1000444' })
    store.set('user', store.get(FB_LOGIN_COOKIE)!)
    await expect(getUser()).resolves.toBeNull()
  })

  it('clears the proof cookie', async () => {
    await setFacebookLoginProof({ facebookSub: '1000444' })
    await clearFacebookLoginProof()
    await expect(readFacebookLoginProof()).resolves.toBeNull()
  })
})

describe('facebookSubFromProof', () => {
  it('never reads facebookSub from client input', () => {
    expect(facebookSubFromProof({ facebookSub: '1000444' })).toBe('1000444')
    expect(facebookSubFromProof(null)).toBeUndefined()
    expect(facebookSubFromProof({ facebookSub: '  ' })).toBeUndefined()
  })
})

describe('isFacebookSubUniqueViolation', () => {
  it('detects facebookSub unique conflicts without treating email unique as the same', () => {
    expect(
      isFacebookSubUniqueViolation({ code: '23505', constraint: 'users_facebookSub_unique' }),
    ).toBe(true)
    expect(
      isFacebookSubUniqueViolation({ code: '23505', constraint: 'users_facebooksub_unique' }),
    ).toBe(true)
    expect(isFacebookSubUniqueViolation({ code: '23505', constraint: 'users_email_unique' })).toBe(false)
    expect(isFacebookSubUniqueViolation({ code: '23505', constraint: 'Agnt_email_key' })).toBe(false)
    expect(
      isFacebookSubUniqueViolation({
        code: '23505',
        detail: 'Key ("facebookSub")=(1000444) already exists.',
      }),
    ).toBe(true)
  })
})
