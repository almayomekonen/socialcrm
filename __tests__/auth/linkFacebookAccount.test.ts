import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthError } from '@/lib/requireUser'

const h = vi.hoisted(() => ({
  requireUser: vi.fn(),
  verify: vi.fn(),
  getUserByFacebookSub: vi.fn(),
  getUserByEmail: vi.fn(),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  userWhere: vi.fn(),
  userUpdate: vi.fn(),
  userFirst: vi.fn(),
  createCookie: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidateTag: h.revalidateTag,
  revalidatePath: h.revalidatePath,
  cacheTag: vi.fn(),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(async () => ({ get: () => null })),
}))
vi.mock('@/lib/requireUser', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/requireUser')>()
  return { ...actual, requireUser: h.requireUser }
})
vi.mock('@/lib/auth/verifyFacebookAccessToken', () => ({
  verifyFacebookAccessToken: h.verify,
}))
vi.mock('@/db/auth', async (importActual) => {
  const actual = await importActual<typeof import('@/db/auth')>()
  return {
    ...actual,
    getUserByFacebookSub: h.getUserByFacebookSub,
    getUserByEmail: h.getUserByEmail,
    createCookie: h.createCookie,
  }
})
vi.mock('@/config/db', () => {
  const qb = {
    where: (arg: unknown) => {
      h.userWhere(arg)
      return qb
    },
    update: h.userUpdate,
    first: h.userFirst,
  }
  return { db: Object.assign(() => qb, { raw: vi.fn() }) }
})

import { linkFacebookAccount } from '@/actions/linkFacebookAccount'

const SUB = '27802810426038835'
const SESSION = { id: 332, agencyId: 103, suspended: false, email: 'alamayo274@gmail.com' }
const identity = { sub: SUB, email: 'alamayo12@walla.com', name: 'Dana' }

describe('linkFacebookAccount', () => {
  const prevEnabled = process.env.FACEBOOK_USER_AUTH_ENABLED
  const prevList = process.env.FACEBOOK_USER_AUTH_AGENCY_ALLOWLIST

  beforeEach(() => {
    process.env.FACEBOOK_USER_AUTH_ENABLED = '1'
    process.env.FACEBOOK_USER_AUTH_AGENCY_ALLOWLIST = '103'
    vi.clearAllMocks()
    h.requireUser.mockResolvedValue(SESSION)
    h.verify.mockResolvedValue({ ok: true, identity })
    h.getUserByFacebookSub.mockResolvedValue(null)
    h.getUserByEmail.mockResolvedValue(null)
    h.userFirst.mockResolvedValue({ facebookSub: null })
    h.userUpdate.mockResolvedValue(1)
  })

  afterEach(() => {
    if (prevEnabled === undefined) delete process.env.FACEBOOK_USER_AUTH_ENABLED
    else process.env.FACEBOOK_USER_AUTH_ENABLED = prevEnabled
    if (prevList === undefined) delete process.env.FACEBOOK_USER_AUTH_AGENCY_ALLOWLIST
    else process.env.FACEBOOK_USER_AUTH_AGENCY_ALLOWLIST = prevList
  })

  it('attaches the Meta-verified Facebook id to the authenticated SocialCRM user', async () => {
    await expect(linkFacebookAccount({ accessToken: 'EAAG' })).resolves.toEqual({ ok: true })

    expect(h.userUpdate).toHaveBeenCalledWith({ facebookSub: SUB })
    expect(h.getUserByEmail).not.toHaveBeenCalled()
    expect(h.createCookie).not.toHaveBeenCalled()
    expect(h.revalidatePath).toHaveBeenCalledWith('/settings/update_security')
  })

  it('succeeds without writing when the same Facebook id is already on this user', async () => {
    h.userFirst.mockResolvedValue({ facebookSub: SUB })
    h.getUserByFacebookSub.mockResolvedValue({ id: 332, facebookSub: SUB })

    await expect(linkFacebookAccount({ accessToken: 'EAAG' })).resolves.toEqual({ ok: true })
    expect(h.userUpdate).not.toHaveBeenCalled()
  })

  it('rejects when the Facebook id is already attached to another user', async () => {
    h.getUserByFacebookSub.mockResolvedValue({ id: 99, facebookSub: SUB, agencyId: 103 })

    await expect(linkFacebookAccount({ accessToken: 'EAAG' })).resolves.toEqual({
      fail: true,
      msg: 'חשבון פייסבוק זה כבר מחובר למערכת. התחבר באמצעות Facebook.',
    })
    expect(h.userUpdate).not.toHaveBeenCalled()
  })

  it('rejects when the current user already has a different Facebook id', async () => {
    h.userFirst.mockResolvedValue({ facebookSub: 'other-facebook-id' })

    await expect(linkFacebookAccount({ accessToken: 'EAAG' })).resolves.toEqual({
      fail: true,
      msg: 'החשבון כבר מחובר לפייסבוק אחר',
    })
    expect(h.userUpdate).not.toHaveBeenCalled()
  })

  it('ignores a client-supplied facebookSub and uses only the Meta-verified id', async () => {
    await linkFacebookAccount({
      accessToken: 'EAAG',
      facebookSub: 'injected-facebook-id',
    } as { accessToken?: string })

    expect(h.verify).toHaveBeenCalledWith('EAAG')
    expect(h.getUserByFacebookSub).toHaveBeenCalledWith(SUB)
    expect(h.getUserByFacebookSub).not.toHaveBeenCalledWith('injected-facebook-id')
    expect(h.userUpdate).toHaveBeenCalledWith({ facebookSub: SUB })
  })

  it('ignores a client-supplied userId and attaches to the session user', async () => {
    await linkFacebookAccount({
      accessToken: 'EAAG',
      userId: 999,
    } as { accessToken?: string })

    expect(h.requireUser).toHaveBeenCalled()
    expect(h.userWhere).toHaveBeenCalledWith({ id: 332 })
    expect(h.userWhere).not.toHaveBeenCalledWith({ id: 999 })
    expect(h.userUpdate).toHaveBeenCalledWith({ facebookSub: SUB })
    expect(h.userUpdate).toHaveBeenCalledTimes(1)
  })

  it('rejects an invalid Facebook token without writing facebookSub', async () => {
    h.verify.mockResolvedValue({ ok: false, reason: 'invalid_token' })

    await expect(linkFacebookAccount({ accessToken: 'bad' })).resolves.toEqual({
      fail: true,
      msg: 'ההתחברות נכשלה, נסה שוב',
    })
    expect(h.getUserByFacebookSub).not.toHaveBeenCalled()
    expect(h.userUpdate).not.toHaveBeenCalled()
  })

  it('rejects a token for the wrong Meta App ID without writing facebookSub', async () => {
    h.verify.mockResolvedValue({ ok: false, reason: 'invalid_token' })

    await expect(linkFacebookAccount({ accessToken: 'EAAG-other-app' })).resolves.toEqual({
      fail: true,
      msg: 'ההתחברות נכשלה, נסה שוב',
    })
    expect(h.userUpdate).not.toHaveBeenCalled()
  })

  it('rejects a Page token without writing facebookSub', async () => {
    h.verify.mockResolvedValue({ ok: false, reason: 'invalid_token' })

    await expect(linkFacebookAccount({ accessToken: 'page-token' })).resolves.toEqual({
      fail: true,
      msg: 'ההתחברות נכשלה, נסה שוב',
    })
    expect(h.userUpdate).not.toHaveBeenCalled()
  })

  it('does not link without an authenticated SocialCRM session', async () => {
    h.requireUser.mockRejectedValue(new AuthError('no_session'))

    await expect(linkFacebookAccount({ accessToken: 'EAAG', userId: 332 } as { accessToken?: string })).resolves.toEqual(
      {
        fail: true,
        msg: 'ההתחברות נכשלה, נסה שוב',
      },
    )
    expect(h.verify).not.toHaveBeenCalled()
    expect(h.userUpdate).not.toHaveBeenCalled()
  })
})
