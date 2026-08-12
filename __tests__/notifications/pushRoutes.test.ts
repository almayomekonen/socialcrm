import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Push subscription routes — P3.1 security. Spec §20.5.
 *
 * DB-free: upsert/delete are mocked. What these tests own is that agencyId and
 * userId always come from the session, never from the body, and that vapid
 * misconfiguration is reported instead of crashing.
 */

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  getAgencyProductAccess: vi.fn(),
  upsertPushSubscription: vi.fn(),
  deletePushSubscription: vi.fn(),
  countUserPushSubscriptions: vi.fn(),
  isNotificationsEnabled: vi.fn(),
  isNotificationsAgencyAllowlisted: vi.fn(),
  isNotificationsPushEnabled: vi.fn(),
  getVapidConfig: vi.fn(),
}))

vi.mock('@/db/auth', () => ({ getUser: h.getUser }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: h.getAgencyProductAccess }))
vi.mock('@/lib/notifications/flags', () => ({
  isNotificationsEnabled: h.isNotificationsEnabled,
  isNotificationsAgencyAllowlisted: h.isNotificationsAgencyAllowlisted,
  isNotificationsPushEnabled: h.isNotificationsPushEnabled,
}))
vi.mock('@/lib/notifications/vapid', () => ({ getVapidConfig: h.getVapidConfig }))
vi.mock('@/db/notifications/subscriptions', () => ({
  upsertPushSubscription: h.upsertPushSubscription,
  deletePushSubscription: h.deletePushSubscription,
  countUserPushSubscriptions: h.countUserPushSubscriptions,
}))

const { POST: subscribePOST } = await import('@/app/api/notifications/push/subscribe/route')
const { POST: unsubscribePOST } = await import('@/app/api/notifications/push/unsubscribe/route')
const { GET: pushGET } = await import('@/app/api/notifications/push/route')

const USER = { id: 55, agencyId: 7 }
const SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  keys: { p256dh: 'p256', auth: 'authkey' },
}

const post = (path: string, body: unknown, headers?: Record<string, string>) =>
  new Request(`https://app.test/api/notifications/push/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as never

beforeEach(() => {
  vi.clearAllMocks()
  h.getUser.mockResolvedValue(USER)
  h.getAgencyProductAccess.mockResolvedValue({ hasAccess: true })
  h.isNotificationsEnabled.mockReturnValue(true)
  h.isNotificationsAgencyAllowlisted.mockReturnValue(true)
  h.isNotificationsPushEnabled.mockReturnValue(false)
  h.getVapidConfig.mockReturnValue({
    status: 'configured',
    missing: [],
    publicKey: 'BPub',
    subject: 'mailto:ops@example.com',
  })
  h.upsertPushSubscription.mockResolvedValue({
    id: 1,
    agencyId: 7,
    userId: 55,
    endpoint: SUB.endpoint,
  })
  h.deletePushSubscription.mockResolvedValue(1)
  h.countUserPushSubscriptions.mockResolvedValue(0)
})

describe('authorization', () => {
  it('rejects unauthenticated subscribe and unsubscribe', async () => {
    h.getUser.mockResolvedValue(null)
    expect((await subscribePOST(post('subscribe', SUB))).status).toBe(401)
    expect((await unsubscribePOST(post('unsubscribe', { endpoint: SUB.endpoint }))).status).toBe(401)
    expect(h.upsertPushSubscription).not.toHaveBeenCalled()
    expect(h.deletePushSubscription).not.toHaveBeenCalled()
  })

  it('rejects product-access failure', async () => {
    h.getAgencyProductAccess.mockResolvedValue({ hasAccess: false })
    expect((await subscribePOST(post('subscribe', SUB))).status).toBe(403)
  })
})

describe('cannot bind subscription to another agency or user', () => {
  it('subscribe passes ONLY the session agencyId and userId to the write', async () => {
    const res = await subscribePOST(
      post('subscribe', {
        ...SUB,
        agencyId: 999,
        userId: 999,
        phone: '050-1111111',
        email: 'attacker@evil.com',
      }),
    )
    expect(res.status).toBe(200)
    expect(h.upsertPushSubscription).toHaveBeenCalledTimes(1)
    const arg = h.upsertPushSubscription.mock.calls[0][0]
    expect(arg.agencyId).toBe(7)
    expect(arg.userId).toBe(55)
    expect(arg.endpoint).toBe(SUB.endpoint)
    expect(arg.p256dh).toBe('p256')
    expect(arg.auth).toBe('authkey')
    expect(arg).not.toHaveProperty('phone')
    expect(arg).not.toHaveProperty('email')
    // Body's attempt to name a victim must not appear.
    expect(arg.agencyId).not.toBe(999)
    expect(arg.userId).not.toBe(999)
  })

  it('response echoes the session binding, not the body', async () => {
    const res = await subscribePOST(post('subscribe', { ...SUB, agencyId: 1, userId: 2 }))
    const json = await res.json()
    expect(json.agencyId).toBe(7)
    expect(json.userId).toBe(55)
  })
})

describe('unsubscribe cannot remove another user\'s endpoint', () => {
  it('scopes delete to the session', async () => {
    await unsubscribePOST(post('unsubscribe', { endpoint: SUB.endpoint, userId: 999, agencyId: 999 }))
    expect(h.deletePushSubscription).toHaveBeenCalledWith({
      agencyId: 7,
      userId: 55,
      endpoint: SUB.endpoint,
    })
  })

  it('reports removed:0 when the row belonged to someone else (mocked)', async () => {
    h.deletePushSubscription.mockResolvedValue(0)
    const res = await unsubscribePOST(post('unsubscribe', { endpoint: SUB.endpoint }))
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.removed).toBe(0)
  })
})

describe('malformed subscription rejected', () => {
  it('rejects missing keys', async () => {
    const res = await subscribePOST(post('subscribe', { endpoint: SUB.endpoint }))
    expect(res.status).toBe(400)
    expect(h.upsertPushSubscription).not.toHaveBeenCalled()
  })

  it('rejects http endpoint', async () => {
    const res = await subscribePOST(
      post('subscribe', { endpoint: 'http://example.com/push', keys: SUB.keys }),
    )
    expect(res.status).toBe(400)
    expect(h.upsertPushSubscription).not.toHaveBeenCalled()
  })
})

describe('vapid not_configured does not crash', () => {
  it('returns 503 with explicit missing list', async () => {
    h.getVapidConfig.mockReturnValue({
      status: 'not_configured',
      missing: ['VAPID_PRIVATE_KEY'],
      publicKey: null,
      subject: null,
    })
    const res = await subscribePOST(post('subscribe', SUB))
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error).toBe('not_configured')
    expect(json.missing).toContain('VAPID_PRIVATE_KEY')
    expect(h.upsertPushSubscription).not.toHaveBeenCalled()
  })
})

describe('GET /api/notifications/push reports configuration state', () => {
  it('exposes vapidStatus and that the push channel is still disabled', async () => {
    h.countUserPushSubscriptions.mockResolvedValue(2)
    const res = await pushGET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.vapidStatus).toBe('configured')
    expect(json.pushChannelEnabled).toBe(false)
    expect(json.subscriptionCount).toBe(2)
    expect(json.serviceWorkerUrl).toBe('/sw.js')
    expect(json.publicKey).toBe('BPub')
  })
})

describe('userAgent comes from the header, not the body', () => {
  it('forwards the request User-Agent into the write', async () => {
    await subscribePOST(post('subscribe', { ...SUB, userAgent: 'FROM_BODY' }, { 'user-agent': 'FROM_HEADER' }))
    expect(h.upsertPushSubscription.mock.calls[0][0].userAgent).toBe('FROM_HEADER')
  })
})
