import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  proof: null as { facebookSub: string } | null,
  capturedUserInsert: null as Record<string, unknown> | null,
  createCookie: vi.fn(),
  redirect: vi.fn(),
  transactionError: null as { code?: string; constraint?: string } | null,
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), cacheTag: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: h.redirect }))
vi.mock('next/server', () => ({
  after: vi.fn((cb: () => unknown) => {
    try {
      const r = cb()
      if (r && typeof (r as Promise<unknown>).then === 'function') (r as Promise<unknown>).catch(() => {})
    } catch {
      /* swallowed */
    }
  }),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(async () => ({ get: () => null })),
}))
vi.mock('@/db/auth', () => ({
  createCookie: h.createCookie,
  getUser: vi.fn(),
}))
vi.mock('@/lib/auth/fbLoginProof', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/auth/fbLoginProof')>()
  return {
    ...actual,
    readFacebookLoginProof: vi.fn(async () => h.proof),
    clearFacebookLoginProof: vi.fn(async () => {
      h.proof = null
    }),
  }
})
vi.mock('@/lib/device', () => ({ isMobileRequest: vi.fn(async () => false) }))
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn() }))
vi.mock('@/lib/emailAutomations/live', () => ({ dispatchLifecycleEvent: vi.fn() }))
vi.mock('@/lib/events/emit', () => ({ emitLifecycleEvent: vi.fn() }))
vi.mock('@/lib/requireUser', () => ({ requireProductAccess: vi.fn() }))
vi.mock('@/config/db', () => {
  function makeTrx() {
    const trx: any = (table: string) => ({
      insert: (row: Record<string, unknown>) => ({
        returning: async () => {
          if (table === 'agencies') return [{ id: 10 }]
          if (table === 'users') {
            h.capturedUserInsert = row
            return [{ id: 20, email: row.email, firstName: row.firstName }]
          }
          return [{}]
        },
        onConflict: () => ({ merge: async () => undefined }),
      }),
    })
    trx.fn = { now: () => new Date() }
    return trx
  }
  return {
    db: {
      transaction: async (fn: (trx: unknown) => Promise<void>) => {
        if (h.transactionError) throw h.transactionError
        await fn(makeTrx())
      },
    },
  }
})

import { addAgency } from '@/actions/agencies'
import { emitLifecycleEvent } from '@/lib/events/emit'

const FORM = {
  agency: { name: 'Studio' },
  user: { firstName: 'Dana', lastName: 'Cohen', email: 'dana@example.com', facebookSub: 'injected-from-client' },
  provider: 'email',
}

describe('addAgency facebookSub attachment', () => {
  const prevEnabled = process.env.FACEBOOK_USER_AUTH_ENABLED
  const prevList = process.env.FACEBOOK_USER_AUTH_AGENCY_ALLOWLIST

  beforeEach(() => {
    process.env.FACEBOOK_USER_AUTH_ENABLED = '1'
    process.env.FACEBOOK_USER_AUTH_AGENCY_ALLOWLIST = 'all'
    h.proof = null
    h.capturedUserInsert = null
    h.transactionError = null
    vi.clearAllMocks()
    h.redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT')
    })
    h.createCookie.mockResolvedValue(undefined)
  })

  afterEach(() => {
    if (prevEnabled === undefined) delete process.env.FACEBOOK_USER_AUTH_ENABLED
    else process.env.FACEBOOK_USER_AUTH_ENABLED = prevEnabled
    if (prevList === undefined) delete process.env.FACEBOOK_USER_AUTH_AGENCY_ALLOWLIST
    else process.env.FACEBOOK_USER_AUTH_AGENCY_ALLOWLIST = prevList
  })

  it('attaches facebookSub from the server-verified proof and ignores client input', async () => {
    h.proof = { facebookSub: '1000444' }

    await expect(addAgency(FORM)).rejects.toThrow('NEXT_REDIRECT')

    expect(h.capturedUserInsert).toMatchObject({
      email: 'dana@example.com',
      firstName: 'Dana',
      role: 'ADMIN',
      facebookSub: '1000444',
    })
    expect(h.capturedUserInsert).not.toHaveProperty('gglSub')
    expect(h.createCookie).toHaveBeenCalledWith(20)
    expect(emitLifecycleEvent).toHaveBeenCalledWith(expect.objectContaining({ provider: 'facebook' }))
  })

  it('does not write facebookSub when there is no proof, even if the client sends one', async () => {
    h.proof = null

    await expect(addAgency(FORM)).rejects.toThrow('NEXT_REDIRECT')

    expect(h.capturedUserInsert).not.toHaveProperty('facebookSub')
    expect(h.createCookie).toHaveBeenCalledWith(20)
  })

  it('returns the existing email conflict and does not create a session', async () => {
    h.proof = { facebookSub: '1000444' }
    h.transactionError = { code: '23505', constraint: 'users_email_unique' }

    const res = await addAgency(FORM)

    expect(res).toEqual({ error: 'כתובת האימייל הזו כבר רשומה במערכת' })
    expect(h.createCookie).not.toHaveBeenCalled()
    expect(h.proof).toEqual({ facebookSub: '1000444' })
  })

  it('returns a distinct error when facebookSub is already taken', async () => {
    h.proof = { facebookSub: '1000444' }
    h.transactionError = { code: '23505', constraint: 'users_facebookSub_unique' }

    const res = await addAgency(FORM)

    expect(res).toEqual({ error: 'חשבון פייסבוק זה כבר מחובר למערכת. התחבר באמצעות Facebook.' })
    expect(h.createCookie).not.toHaveBeenCalled()
  })

  it('does not attach facebookSub from a leftover proof during the numbered-id canary', async () => {
    process.env.FACEBOOK_USER_AUTH_AGENCY_ALLOWLIST = '103'
    h.proof = { facebookSub: '1000444' }

    await expect(addAgency(FORM)).rejects.toThrow('NEXT_REDIRECT')

    expect(h.capturedUserInsert).not.toHaveProperty('facebookSub')
    expect(h.createCookie).toHaveBeenCalledWith(20)
  })
})
