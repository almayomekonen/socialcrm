import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  buildPushPayload,
  deliverWebPush,
  isPermanentPushFailure,
  pushPayloadJson,
  type PushPayload,
} from '@/lib/notifications/webPush'
import type { PushSubscriptionRow } from '@/db/notifications/subscriptions'
import { buildWorkerCapabilities, IN_APP_ONLY_CAPABILITIES, resolveChannels } from '@/lib/notifications/policy'
import { NOTIFICATION_REGISTRY } from '@/lib/notifications/registry'

/**
 * P3.2 Web Push delivery — payload, failure classification, adapter behaviour,
 * and capability gating. Provider I/O is injected; no network.
 */

const payload: PushPayload = buildPushPayload({
  notificationId: 42,
  title: 'ליד חדש — דניאל',
  body: null,
  deepLink: '/clients/42/summary',
})

const sub = (over: Partial<PushSubscriptionRow> = {}): PushSubscriptionRow => ({
  id: 1,
  agencyId: 7,
  userId: 55,
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  p256dh: 'p256',
  auth: 'auth',
  ...over,
})

describe('buildPushPayload — approved fields only (§15.4)', () => {
  it('contains only notificationId, title, body, deepLink', () => {
    expect(Object.keys(payload).sort()).toEqual(['body', 'deepLink', 'notificationId', 'title'])
    const json = JSON.parse(pushPayloadJson(payload))
    expect(Object.keys(json).sort()).toEqual(['body', 'deepLink', 'notificationId', 'title'])
    expect(json).not.toHaveProperty('phone')
    expect(json).not.toHaveProperty('email')
    expect(json).not.toHaveProperty('idNum')
    expect(json).not.toHaveProperty('metadata')
    expect(json).not.toHaveProperty('lead')
  })
})

describe('isPermanentPushFailure', () => {
  it('treats 404 and 410 as permanent (subscription gone)', () => {
    expect(isPermanentPushFailure({ statusCode: 404 })).toBe(true)
    expect(isPermanentPushFailure({ statusCode: 410 })).toBe(true)
  })

  it('treats other errors as transient', () => {
    expect(isPermanentPushFailure({ statusCode: 500 })).toBe(false)
    expect(isPermanentPushFailure({ statusCode: 429 })).toBe(false)
    expect(isPermanentPushFailure(new Error('network'))).toBe(false)
  })
})

describe('buildWorkerCapabilities', () => {
  it('defaults to in-app only when push is off — IN_APP behaviour unchanged', () => {
    expect(buildWorkerCapabilities({ pushEnabled: false, vapidConfigured: true })).toEqual(
      IN_APP_ONLY_CAPABILITIES,
    )
  })

  it('enables web_push only when flag AND vapid are both true', () => {
    expect(buildWorkerCapabilities({ pushEnabled: true, vapidConfigured: false }).web_push).toBe(false)
    expect(buildWorkerCapabilities({ pushEnabled: false, vapidConfigured: true }).web_push).toBe(false)
    expect(buildWorkerCapabilities({ pushEnabled: true, vapidConfigured: true }).web_push).toBe(true)
  })

  it('ONLINE lead.created never selects web_push even when capability is on', () => {
    const channels = resolveChannels({
      policy: NOTIFICATION_REGISTRY['lead.created'].channels,
      presence: 'online',
      capabilities: buildWorkerCapabilities({ pushEnabled: true, vapidConfigured: true }),
      priority: 'medium',
    })
    expect(channels).toEqual(['in_app'])
    expect(channels).not.toContain('web_push')
  })

  it('OFFLINE lead.created selects web_push when capability is on', () => {
    const channels = resolveChannels({
      policy: NOTIFICATION_REGISTRY['lead.created'].channels,
      presence: 'offline',
      capabilities: buildWorkerCapabilities({ pushEnabled: true, vapidConfigured: true }),
      priority: 'medium',
    })
    expect(channels).toEqual(['in_app', 'web_push'])
  })

  it('quiet types never select web_push', () => {
    const channels = resolveChannels({
      policy: NOTIFICATION_REGISTRY['lead.activity'].channels,
      presence: 'offline',
      capabilities: buildWorkerCapabilities({ pushEnabled: true, vapidConfigured: true }),
      priority: 'info',
    })
    expect(channels).toEqual(['in_app'])
  })
})

describe('deliverWebPush', () => {
  const send = vi.fn()
  const deleteSubscription = vi.fn()
  const touchUsed = vi.fn()
  const listSubscriptions = vi.fn()
  const getAuth = vi.fn()

  const deps = {
    send,
    deleteSubscription,
    touchUsed,
    listSubscriptions,
    getAuth,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    getAuth.mockReturnValue({
      publicKey: 'pub',
      privateKey: 'priv',
      subject: 'mailto:ops@example.com',
    })
    touchUsed.mockResolvedValue(undefined)
    deleteSubscription.mockResolvedValue(1)
  })

  it('WEB_PUSH selected + valid subscription → delivery succeeds', async () => {
    listSubscriptions.mockResolvedValue([sub()])
    send.mockResolvedValue(undefined)
    const result = await deliverWebPush(
      { agencyId: 7, userId: 55, payload, pushEnabled: true },
      deps,
    )
    expect(result).toEqual({ kind: 'sent', deviceCount: 1, removedDead: 0 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(JSON.parse(send.mock.calls[0][1])).toMatchObject({
      notificationId: 42,
      title: payload.title,
      deepLink: '/clients/42/summary',
    })
  })

  it('push flag disabled → no provider call, suppressed', async () => {
    const result = await deliverWebPush(
      { agencyId: 7, userId: 55, payload, pushEnabled: false },
      deps,
    )
    expect(result).toEqual({ kind: 'suppressed', reason: 'push_disabled' })
    expect(send).not.toHaveBeenCalled()
    expect(listSubscriptions).not.toHaveBeenCalled()
  })

  it('missing VAPID → no crash, suppressed not_configured', async () => {
    getAuth.mockReturnValue(null)
    const result = await deliverWebPush(
      { agencyId: 7, userId: 55, payload, pushEnabled: true },
      deps,
    )
    expect(result).toEqual({ kind: 'suppressed', reason: 'not_configured' })
    expect(send).not.toHaveBeenCalled()
  })

  it('recipient has no subscription → suppressed no_subscription', async () => {
    listSubscriptions.mockResolvedValue([])
    const result = await deliverWebPush(
      { agencyId: 7, userId: 55, payload, pushEnabled: true },
      deps,
    )
    expect(result).toEqual({ kind: 'suppressed', reason: 'no_subscription' })
    expect(send).not.toHaveBeenCalled()
  })

  it('multiple subscriptions → all valid devices receive push', async () => {
    listSubscriptions.mockResolvedValue([
      sub({ id: 1, endpoint: 'https://fcm.googleapis.com/fcm/send/a' }),
      sub({ id: 2, endpoint: 'https://fcm.googleapis.com/fcm/send/b' }),
    ])
    send.mockResolvedValue(undefined)
    const result = await deliverWebPush(
      { agencyId: 7, userId: 55, payload, pushEnabled: true },
      deps,
    )
    expect(result).toEqual({ kind: 'sent', deviceCount: 2, removedDead: 0 })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('subscription belonging to another user/agency is never used', async () => {
    // list is already scoped; defence-in-depth still skips mismatched rows.
    listSubscriptions.mockResolvedValue([
      sub({ id: 1, userId: 999, agencyId: 7 }),
      sub({ id: 2, userId: 55, agencyId: 999 }),
      sub({ id: 3, userId: 55, agencyId: 7 }),
    ])
    send.mockResolvedValue(undefined)
    const result = await deliverWebPush(
      { agencyId: 7, userId: 55, payload, pushEnabled: true },
      deps,
    )
    expect(result).toEqual({ kind: 'sent', deviceCount: 1, removedDead: 0 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].id).toBe(3)
  })

  it('permanent invalid subscription → cleaned up, recorded as failure', async () => {
    listSubscriptions.mockResolvedValue([sub({ id: 9 })])
    send.mockRejectedValue({ statusCode: 410, message: 'Gone' })
    const result = await deliverWebPush(
      { agencyId: 7, userId: 55, payload, pushEnabled: true },
      deps,
    )
    expect(result).toEqual({
      kind: 'failed',
      reason: 'subscription_gone',
      transient: false,
      removedDead: 1,
    })
    expect(deleteSubscription).toHaveBeenCalledWith({ id: 9, agencyId: 7, userId: 55 })
  })

  it('transient provider failure → failure, subscription retained', async () => {
    listSubscriptions.mockResolvedValue([sub({ id: 9 })])
    send.mockRejectedValue({ statusCode: 503, message: 'Unavailable' })
    const result = await deliverWebPush(
      { agencyId: 7, userId: 55, payload, pushEnabled: true },
      deps,
    )
    expect(result.kind).toBe('failed')
    if (result.kind !== 'failed') return
    expect(result.transient).toBe(true)
    expect(deleteSubscription).not.toHaveBeenCalled()
  })

  it('listSubscriptions is always called with agencyId AND userId', async () => {
    listSubscriptions.mockResolvedValue([])
    await deliverWebPush({ agencyId: 7, userId: 55, payload, pushEnabled: true }, deps)
    expect(listSubscriptions).toHaveBeenCalledWith({ agencyId: 7, userId: 55 })
  })
})
