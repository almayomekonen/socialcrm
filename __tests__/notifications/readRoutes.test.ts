import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * POST /api/notifications/seen and /api/notifications/read.
 *
 * DB-free (spec §22.1): the data functions are mocked, so what these tests observe
 * is the part the routes actually own — auth, the feature gate, input validation,
 * and above all THE SCOPE THEY PASS DOWN. The security property is that agencyId
 * and userId always come from the session and can never come from the body, and
 * that is only checkable at this layer.
 */

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  getAgencyProductAccess: vi.fn(),
  markNotificationsSeen: vi.fn(),
  markNotificationsRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  isNotificationsEnabled: vi.fn(),
  isNotificationsAgencyAllowlisted: vi.fn(),
}))

vi.mock('@/db/auth', () => ({ getUser: h.getUser }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: h.getAgencyProductAccess }))
vi.mock('@/lib/notifications/flags', () => ({
  isNotificationsEnabled: h.isNotificationsEnabled,
  isNotificationsAgencyAllowlisted: h.isNotificationsAgencyAllowlisted,
}))

// parseIds stays REAL — validation is part of what these routes are being tested for.
vi.mock('@/db/notifications/reads', async () => {
  const actual = await vi.importActual<typeof import('@/db/notifications/reads')>('@/db/notifications/reads')
  return {
    ...actual,
    markNotificationsSeen: h.markNotificationsSeen,
    markNotificationsRead: h.markNotificationsRead,
    markAllNotificationsRead: h.markAllNotificationsRead,
  }
})

const { POST: seenPOST } = await import('@/app/api/notifications/seen/route')
const { POST: readPOST } = await import('@/app/api/notifications/read/route')

const USER = { id: 55, agencyId: 7 }

const post = (path: string, body: unknown) =>
  new Request(`https://app.test/api/notifications/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never

beforeEach(() => {
  vi.clearAllMocks()
  h.getUser.mockResolvedValue(USER)
  h.getAgencyProductAccess.mockResolvedValue({ hasAccess: true })
  h.isNotificationsEnabled.mockReturnValue(true)
  h.isNotificationsAgencyAllowlisted.mockReturnValue(true)
  h.markNotificationsSeen.mockResolvedValue(1)
  h.markNotificationsRead.mockResolvedValue(1)
  h.markAllNotificationsRead.mockResolvedValue(3)
})

describe('authorization', () => {
  it('rejects an unauthenticated caller on both routes', async () => {
    h.getUser.mockResolvedValue(null)
    expect((await seenPOST(post('seen', { ids: [1] }))).status).toBe(401)
    expect((await readPOST(post('read', { ids: [1] }))).status).toBe(401)
    expect(h.markNotificationsSeen).not.toHaveBeenCalled()
    expect(h.markNotificationsRead).not.toHaveBeenCalled()
  })

  it('rejects a user with no agency', async () => {
    h.getUser.mockResolvedValue({ id: 55, agencyId: null })
    expect((await seenPOST(post('seen', { ids: [1] }))).status).toBe(401)
  })

  it('rejects an agency without product access', async () => {
    h.getAgencyProductAccess.mockResolvedValue({ hasAccess: false })
    expect((await seenPOST(post('seen', { ids: [1] }))).status).toBe(403)
    expect((await readPOST(post('read', { all: true }))).status).toBe(403)
    expect(h.markAllNotificationsRead).not.toHaveBeenCalled()
  })
})

describe('feature gate', () => {
  it('writes nothing when the flag is off', async () => {
    h.isNotificationsEnabled.mockReturnValue(false)
    expect((await seenPOST(post('seen', { ids: [1] }))).status).toBe(404)
    expect((await readPOST(post('read', { ids: [1] }))).status).toBe(404)
    expect(h.markNotificationsSeen).not.toHaveBeenCalled()
    expect(h.markNotificationsRead).not.toHaveBeenCalled()
  })

  it('writes nothing for an agency outside the allowlist', async () => {
    h.isNotificationsAgencyAllowlisted.mockReturnValue(false)
    expect((await seenPOST(post('seen', { ids: [1] }))).status).toBe(404)
    expect(h.markNotificationsSeen).not.toHaveBeenCalled()
  })
})

describe('scope comes from the session, never from the body', () => {
  it('mark-seen passes the session agencyId and userId', async () => {
    await seenPOST(post('seen', { ids: [10, 11] }))
    expect(h.markNotificationsSeen).toHaveBeenCalledWith({ agencyId: 7, userId: 55, ids: [10, 11] })
  })

  it('mark-read passes the session agencyId and userId', async () => {
    await readPOST(post('read', { ids: [10] }))
    expect(h.markNotificationsRead).toHaveBeenCalledWith({ agencyId: 7, userId: 55, ids: [10] })
  })

  it('IGNORES userId and agencyId supplied in the body', async () => {
    // The whole cross-tenant attack in one request. The body's values must not
    // appear anywhere in the call the route makes.
    await seenPOST(post('seen', { ids: [1], userId: 999, agencyId: 999 }))
    await readPOST(post('read', { ids: [1], userId: 999, agencyId: 999 }))

    expect(h.markNotificationsSeen).toHaveBeenCalledWith({ agencyId: 7, userId: 55, ids: [1] })
    expect(h.markNotificationsRead).toHaveBeenCalledWith({ agencyId: 7, userId: 55, ids: [1] })
  })

  it('an id belonging to another user is still scoped, so it updates nothing', async () => {
    // An id is an object identifier, not a capability (spec §20.2): the route
    // forwards it unchanged and the WHERE clause makes it a no-op.
    h.markNotificationsRead.mockResolvedValue(0)
    const res = await readPOST(post('read', { ids: [123456] }))
    expect(await res.json()).toEqual({ ok: true, updated: 0 })
    expect(h.markNotificationsRead).toHaveBeenCalledWith({ agencyId: 7, userId: 55, ids: [123456] })
  })
})

describe('input validation', () => {
  it('rejects a malformed or empty id list', async () => {
    for (const body of [{}, { ids: [] }, { ids: 'all' }, { ids: [0] }, { ids: [-1] }, { ids: [1.5] }]) {
      expect((await seenPOST(post('seen', body))).status).toBe(400)
    }
    expect(h.markNotificationsSeen).not.toHaveBeenCalled()
  })

  it('rejects a body that is not JSON at all', async () => {
    const bad = new Request('https://app.test/api/notifications/seen', { method: 'POST', body: 'not json' }) as never
    expect((await seenPOST(bad)).status).toBe(400)
  })

  it('rejects an oversized batch', async () => {
    const ids = Array.from({ length: 500 }, (_, i) => i + 1)
    expect((await seenPOST(post('seen', { ids }))).status).toBe(400)
    expect(h.markNotificationsSeen).not.toHaveBeenCalled()
  })
})

describe('mark all read', () => {
  it('takes the all flag and no id list', async () => {
    const res = await readPOST(post('read', { all: true }))
    expect(await res.json()).toEqual({ ok: true, updated: 3 })
    expect(h.markAllNotificationsRead).toHaveBeenCalledWith({ agencyId: 7, userId: 55 })
    expect(h.markNotificationsRead).not.toHaveBeenCalled()
  })

  it('does not accept all as a truthy string', async () => {
    // Strict equality, so `all: 'false'` cannot mark a whole account read.
    expect((await readPOST(post('read', { all: 'true' }))).status).toBe(400)
    expect(h.markAllNotificationsRead).not.toHaveBeenCalled()
  })
})

describe('response headers', () => {
  it('every response is no-store, including the error paths', async () => {
    const ok = await seenPOST(post('seen', { ids: [1] }))
    expect(ok.headers.get('cache-control')).toBe('no-store')

    h.getUser.mockResolvedValue(null)
    const unauthorized = await seenPOST(post('seen', { ids: [1] }))
    expect(unauthorized.headers.get('cache-control')).toBe('no-store')
  })
})

describe('seen and read stay independent', () => {
  it('marking seen never calls the read writer, and vice versa', async () => {
    await seenPOST(post('seen', { ids: [1] }))
    expect(h.markNotificationsRead).not.toHaveBeenCalled()
    expect(h.markAllNotificationsRead).not.toHaveBeenCalled()

    vi.clearAllMocks()
    h.getUser.mockResolvedValue(USER)
    h.getAgencyProductAccess.mockResolvedValue({ hasAccess: true })
    h.isNotificationsEnabled.mockReturnValue(true)
    h.isNotificationsAgencyAllowlisted.mockReturnValue(true)

    await readPOST(post('read', { ids: [1] }))
    expect(h.markNotificationsSeen).not.toHaveBeenCalled()
  })
})
