import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  verify: vi.fn(),
  getUserByFacebookSub: vi.fn(),
  getUserByEmail: vi.fn(),
  createCookie: vi.fn(),
  revokeUserSessions: vi.fn(),
  setProof: vi.fn(),
  clearProof: vi.fn(),
  redirect: vi.fn(),
  revalidateTag: vi.fn(),
  userUpdate: vi.fn(),
  userFirst: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidateTag: h.revalidateTag, revalidatePath: vi.fn(), cacheTag: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: h.redirect }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(async () => ({ get: () => null })),
}))
vi.mock('@/lib/email/sender', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/email/render', () => ({ renderEmail: vi.fn() }))
vi.mock('@/emails/templates/MagicLinkEmail', () => ({ default: vi.fn() }))
vi.mock('@/config/resend', () => ({
  default: { emails: { send: vi.fn() }, events: { send: vi.fn() } },
}))
vi.mock('@/lib/auth/verifyFacebookAccessToken', () => ({
  verifyFacebookAccessToken: h.verify,
}))
vi.mock('@/lib/auth/fbLoginProof', () => ({
  setFacebookLoginProof: h.setProof,
  clearFacebookLoginProof: h.clearProof,
}))
vi.mock('@/db/auth', async (importActual) => {
  const actual = await importActual<typeof import('@/db/auth')>()
  return {
    ...actual,
    getUserByFacebookSub: h.getUserByFacebookSub,
    getUserByEmail: h.getUserByEmail,
    createCookie: h.createCookie,
    revokeUserSessions: h.revokeUserSessions,
  }
})
vi.mock('@/config/db', () => {
  const qb = {
    where: () => qb,
    update: h.userUpdate,
    first: h.userFirst,
  }
  return { db: Object.assign(() => qb, { raw: vi.fn() }) }
})

import { checkFacebookUser } from '@/actions/auth'

const SUB = '27802810426038835'
const EMAIL = 'dana@example.com'
const identity = { sub: SUB, email: EMAIL, name: 'Dana', picture: 'https://example.com/p.jpg' }

describe('checkFacebookUser', () => {
  const prevEnabled = process.env.FACEBOOK_USER_AUTH_ENABLED
  const prevList = process.env.FACEBOOK_USER_AUTH_AGENCY_ALLOWLIST

  beforeEach(() => {
    process.env.FACEBOOK_USER_AUTH_ENABLED = '1'
    process.env.FACEBOOK_USER_AUTH_AGENCY_ALLOWLIST = '103'
    vi.clearAllMocks()
    h.redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT')
    })
    h.userUpdate.mockResolvedValue(1)
    h.userFirst.mockResolvedValue({ emailVerifiedAt: new Date(), facebookSub: null })
    h.createCookie.mockResolvedValue(undefined)
    h.setProof.mockResolvedValue(undefined)
    h.clearProof.mockResolvedValue(undefined)
    h.revokeUserSessions.mockResolvedValue(undefined)
    h.getUserByFacebookSub.mockResolvedValue(null)
    h.getUserByEmail.mockResolvedValue(null)
  })

  afterEach(() => {
    if (prevEnabled === undefined) delete process.env.FACEBOOK_USER_AUTH_ENABLED
    else process.env.FACEBOOK_USER_AUTH_ENABLED = prevEnabled
    if (prevList === undefined) delete process.env.FACEBOOK_USER_AUTH_AGENCY_ALLOWLIST
    else process.env.FACEBOOK_USER_AUTH_AGENCY_ALLOWLIST = prevList
  })

  it('logs an existing email into the SocialCRM user session and attaches facebookSub when null', async () => {
    h.verify.mockResolvedValue({ ok: true, identity })
    h.getUserByEmail.mockResolvedValue({ id: 42, suspended: false, facebookSub: null, agencyId: 103 })

    await expect(checkFacebookUser({ accessToken: 'EAAG' })).rejects.toThrow('NEXT_REDIRECT')

    expect(h.createCookie).toHaveBeenCalledWith(42)
    expect(h.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ facebookSub: SUB }))
    expect(h.clearProof).toHaveBeenCalled()
    expect(h.redirect).toHaveBeenCalledWith('/dashboard')
    expect(h.setProof).not.toHaveBeenCalled()
  })

  it('logs a returning facebookSub user into the same SocialCRM session', async () => {
    h.verify.mockResolvedValue({ ok: true, identity })
    h.getUserByFacebookSub.mockResolvedValue({ id: 42, facebookSub: SUB, agencyId: 103 })
    h.getUserByEmail.mockResolvedValue({ id: 42, facebookSub: SUB, agencyId: 103 })
    h.userFirst.mockResolvedValue({ emailVerifiedAt: new Date(), facebookSub: SUB })

    await expect(checkFacebookUser({ accessToken: 'EAAG' })).rejects.toThrow('NEXT_REDIRECT')

    expect(h.createCookie).toHaveBeenCalledWith(42)
    const updateArg = h.userUpdate.mock.calls[0]?.[0] ?? {}
    expect(updateArg).not.toHaveProperty('facebookSub')
  })

  it('ignores a client-supplied email and uses only Meta /me email', async () => {
    h.verify.mockResolvedValue({ ok: true, identity })
    h.getUserByEmail.mockResolvedValue(null)

    await checkFacebookUser({ accessToken: 'EAAG', email: 'attacker@evil.com' } as { accessToken?: string })

    expect(h.getUserByEmail).toHaveBeenCalledWith(EMAIL)
    expect(h.getUserByEmail).not.toHaveBeenCalledWith('attacker@evil.com')
  })

  it('rejects when the email account is already linked to a different facebookSub', async () => {
    h.verify.mockResolvedValue({ ok: true, identity })
    h.getUserByEmail.mockResolvedValue({ id: 42, facebookSub: 'other-facebook-id', agencyId: 103 })

    await expect(checkFacebookUser({ accessToken: 'EAAG' })).resolves.toEqual({
      fail: true,
      msg: 'חשבון פייסבוק זה כבר מחובר למערכת. התחבר באמצעות Facebook.',
    })
    expect(h.createCookie).not.toHaveBeenCalled()
    expect(h.userUpdate).not.toHaveBeenCalled()
  })

  it('rejects an unknown Facebook user during the agency canary and does not create an agency', async () => {
    h.verify.mockResolvedValue({ ok: true, identity })

    const res = await checkFacebookUser({ accessToken: 'EAAG' })

    expect(res).toEqual({ fail: true, msg: 'התחברות עם Facebook אינה זמינה לחשבון זה' })
    expect(h.setProof).not.toHaveBeenCalled()
    expect(h.createCookie).not.toHaveBeenCalled()
    expect(h.redirect).not.toHaveBeenCalled()
  })

  it('rejects an existing user whose agency is not on the allowlist', async () => {
    h.verify.mockResolvedValue({ ok: true, identity })
    h.getUserByEmail.mockResolvedValue({ id: 42, suspended: false, facebookSub: null, agencyId: 99 })

    await expect(checkFacebookUser({ accessToken: 'EAAG' })).resolves.toEqual({
      fail: true,
      msg: 'התחברות עם Facebook אינה זמינה לחשבון זה',
    })
    expect(h.createCookie).not.toHaveBeenCalled()
    expect(h.setProof).not.toHaveBeenCalled()
    expect(h.userUpdate).not.toHaveBeenCalled()
  })

  it('does not write gglSub', async () => {
    h.verify.mockResolvedValue({ ok: true, identity })
    h.getUserByEmail.mockResolvedValue({ id: 42, facebookSub: null, agencyId: 103 })
    h.userFirst.mockResolvedValue({ emailVerifiedAt: new Date(), facebookSub: null })

    await expect(checkFacebookUser({ accessToken: 'EAAG' })).rejects.toThrow('NEXT_REDIRECT')

    const updateArg = h.userUpdate.mock.calls[0]?.[0]
    expect(updateArg).not.toHaveProperty('gglSub')
    expect(updateArg).not.toHaveProperty('email')
  })

  it('rejects a failed token without setting a proof or session', async () => {
    h.verify.mockResolvedValue({ ok: false, reason: 'invalid_token' })

    await expect(checkFacebookUser({ accessToken: 'page-token' })).resolves.toEqual({
      fail: true,
      msg: 'ההתחברות נכשלה, נסה שוב',
    })
    expect(h.getUserByFacebookSub).not.toHaveBeenCalled()
    expect(h.setProof).not.toHaveBeenCalled()
    expect(h.createCookie).not.toHaveBeenCalled()
  })

  it('blocks a suspended SocialCRM user', async () => {
    h.verify.mockResolvedValue({ ok: true, identity })
    h.getUserByEmail.mockResolvedValue({ id: 42, suspended: true, facebookSub: null })

    await expect(checkFacebookUser({ accessToken: 'EAAG' })).resolves.toEqual({
      fail: true,
      msg: 'המשתמש מושהה',
    })
    expect(h.createCookie).not.toHaveBeenCalled()
    expect(h.setProof).not.toHaveBeenCalled()
  })
})
