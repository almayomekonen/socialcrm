import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * processJob WEB_PUSH wiring — P3.2.
 *
 * DB and provider are mocked. Pins: flag off ⇒ no push; capability path uses
 * buildWorkerCapabilities; duplicate terminal delivery is not re-sent; in_app
 * still recorded as sent on insert.
 */

const h = vi.hoisted(() => ({
  transaction: vi.fn(),
  upsertCollapsedNotification: vi.fn(),
  updateNotificationCopy: vi.fn(),
  recordDelivery: vi.fn(),
  ensurePendingChannelDelivery: vi.fn(),
  findChannelDelivery: vi.fn(),
  markDeliverySent: vi.fn(),
  markDeliveryFailed: vi.fn(),
  markDeliverySuppressed: vi.fn(),
  deliverWebPush: vi.fn(),
  buildWorkerCapabilities: vi.fn(),
  isNotificationsPushEnabled: vi.fn(),
  planNotification: vi.fn(),
}))

vi.mock('@/config/db', () => ({
  db: {
    transaction: h.transaction,
  },
}))

vi.mock('@/db/notifications/notifications', () => ({
  upsertCollapsedNotification: h.upsertCollapsedNotification,
  updateNotificationCopy: h.updateNotificationCopy,
}))

vi.mock('@/db/notifications/deliveries', () => ({
  recordDelivery: h.recordDelivery,
  ensurePendingChannelDelivery: h.ensurePendingChannelDelivery,
  findChannelDelivery: h.findChannelDelivery,
  markDeliverySent: h.markDeliverySent,
  markDeliveryFailed: h.markDeliveryFailed,
  markDeliverySuppressed: h.markDeliverySuppressed,
}))

vi.mock('@/lib/notifications/webPush', async () => {
  const actual = await vi.importActual<typeof import('@/lib/notifications/webPush')>(
    '@/lib/notifications/webPush',
  )
  return {
    ...actual,
    deliverWebPush: h.deliverWebPush,
  }
})

vi.mock('@/lib/notifications/policy', async () => {
  const actual = await vi.importActual<typeof import('@/lib/notifications/policy')>(
    '@/lib/notifications/policy',
  )
  return {
    ...actual,
    buildWorkerCapabilities: h.buildWorkerCapabilities,
  }
})

vi.mock('@/lib/notifications/flags', () => ({
  isNotificationsPushEnabled: h.isNotificationsPushEnabled,
  isNotificationsEnabled: () => true,
  isNotificationsAgencyAllowlisted: () => true,
  isNotificationsEmailEnabled: () => false,
}))

vi.mock('@/lib/notifications/plan', async () => {
  const actual = await vi.importActual<typeof import('@/lib/notifications/plan')>(
    '@/lib/notifications/plan',
  )
  return {
    ...actual,
    planNotification: h.planNotification,
  }
})

const { processNotificationJob } = await import('@/lib/notifications/processJob')

const JOB = {
  id: 1,
  agencyId: 7,
  type: 'lead.created' as const,
  eventKey: 'lead.created:7:lead:42',
  actorUserId: null,
  entityType: 'lead' as const,
  entityId: 42,
  payload: { leadName: 'דניאל' },
  attempts: 1,
  maxAttempts: 5,
  createdAt: '2026-08-12T10:00:00.000Z',
}

const CONTEXT = {
  handlerByLead: new Map([['7:42', 55]]),
  adminsByAgency: new Map([[7, [1]]]),
}

beforeEach(() => {
  vi.clearAllMocks()
  h.transaction.mockImplementation(async (fn: (trx: unknown) => Promise<void>) => fn({}))
  h.buildWorkerCapabilities.mockReturnValue({
    in_app: true,
    toast: false,
    web_push: true,
    email: false,
  })
  h.isNotificationsPushEnabled.mockReturnValue(true)
  h.recordDelivery.mockResolvedValue(10)
  h.markDeliverySent.mockResolvedValue(1)
  h.markDeliveryFailed.mockResolvedValue(1)
  h.markDeliverySuppressed.mockResolvedValue(1)
  h.findChannelDelivery.mockResolvedValue(null)
  h.deliverWebPush.mockResolvedValue({ kind: 'sent', deviceCount: 1, removedDead: 0 })
})

describe('WEB_PUSH not selected → no push', () => {
  it('ONLINE recipient with only in_app does not call deliverWebPush', async () => {
    h.planNotification.mockReturnValue({
      plan: {
        type: 'lead.created',
        category: 'leads',
        priority: 'medium',
        collapseKey: 'lead:42:arrival',
        entityType: 'lead',
        entityId: 42,
        deepLink: '/clients/42/summary',
        metadata: {},
        recipients: [
          {
            userId: 55,
            channels: ['in_app'],
            title: 'ליד חדש',
            body: null,
            context: {},
          },
        ],
      },
    })
    h.upsertCollapsedNotification.mockResolvedValue({ id: 100, inserted: true, groupCount: 1 })

    await processNotificationJob(JOB, CONTEXT, () => 'online')

    expect(h.recordDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ channel: 'in_app', notificationId: 100 }),
    )
    expect(h.ensurePendingChannelDelivery).not.toHaveBeenCalled()
    expect(h.deliverWebPush).not.toHaveBeenCalled()
  })
})

describe('push flag / capability off → no push side effect', () => {
  it('when plan has no web_push channel, provider is never called', async () => {
    h.buildWorkerCapabilities.mockReturnValue({
      in_app: true,
      toast: false,
      web_push: false,
      email: false,
    })
    h.planNotification.mockReturnValue({
      plan: {
        type: 'lead.created',
        category: 'leads',
        priority: 'medium',
        collapseKey: 'k',
        entityType: 'lead',
        entityId: 42,
        deepLink: '/clients/42/summary',
        metadata: {},
        recipients: [{ userId: 55, channels: ['in_app'], title: 't', body: null, context: {} }],
      },
    })
    h.upsertCollapsedNotification.mockResolvedValue({ id: 100, inserted: true, groupCount: 1 })
    await processNotificationJob(JOB, CONTEXT, () => 'offline')
    expect(h.deliverWebPush).not.toHaveBeenCalled()
  })
})

describe('WEB_PUSH selected + insert → pending then deliver', () => {
  it('records pending, calls deliverWebPush, marks sent', async () => {
    h.planNotification.mockReturnValue({
      plan: {
        type: 'lead.created',
        category: 'leads',
        priority: 'medium',
        collapseKey: 'k',
        entityType: 'lead',
        entityId: 42,
        deepLink: '/clients/42/summary',
        metadata: {},
        recipients: [
          { userId: 55, channels: ['in_app', 'web_push'], title: 't', body: null, context: {} },
        ],
      },
    })
    h.upsertCollapsedNotification.mockResolvedValue({ id: 100, inserted: true, groupCount: 1 })
    h.ensurePendingChannelDelivery.mockResolvedValue({
      id: 200,
      notificationId: 100,
      agencyId: 7,
      userId: 55,
      channel: 'web_push',
      status: 'pending',
      attempts: 0,
    })

    await processNotificationJob(JOB, CONTEXT, () => 'offline')

    expect(h.ensurePendingChannelDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ channel: 'web_push', userId: 55, agencyId: 7 }),
    )
    expect(h.deliverWebPush).toHaveBeenCalledWith(
      expect.objectContaining({
        agencyId: 7,
        userId: 55,
        pushEnabled: true,
        payload: expect.objectContaining({
          notificationId: 100,
          title: 't',
          deepLink: '/clients/42/summary',
        }),
      }),
    )
    expect(h.markDeliverySent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 200, agencyId: 7, userId: 55 }),
    )
  })
})

describe('duplicate processing cannot send the same channel twice', () => {
  it('skips provider when delivery is already sent', async () => {
    h.upsertCollapsedNotification.mockResolvedValue({ id: 100, inserted: false, groupCount: 2 })
    h.findChannelDelivery.mockResolvedValue({
      id: 200,
      notificationId: 100,
      agencyId: 7,
      userId: 55,
      channel: 'web_push',
      status: 'sent',
      attempts: 1,
    })
    h.planNotification.mockReturnValue({
      plan: {
        type: 'lead.created',
        category: 'leads',
        priority: 'medium',
        collapseKey: 'k',
        entityType: 'lead',
        entityId: 42,
        deepLink: '/clients/42/summary',
        metadata: { leadName: 'דניאל' },
        recipients: [
          {
            userId: 55,
            channels: ['in_app', 'web_push'],
            title: 't',
            body: null,
            context: {
              type: 'lead.created',
              agencyId: 7,
              entityType: 'lead',
              entityId: 42,
              actorUserId: null,
              occurredAt: new Date(JOB.createdAt),
              payload: { leadName: 'דניאל' },
              groupCount: 1,
            },
          },
        ],
      },
    })

    await processNotificationJob(JOB, CONTEXT, () => 'offline')
    expect(h.deliverWebPush).not.toHaveBeenCalled()
  })
})

describe('existing IN_APP behaviour remains unchanged', () => {
  it('still records in_app as sent on insert', async () => {
    h.planNotification.mockReturnValue({
      plan: {
        type: 'lead.created',
        category: 'leads',
        priority: 'medium',
        collapseKey: 'k',
        entityType: 'lead',
        entityId: 42,
        deepLink: '/clients/42/summary',
        metadata: {},
        recipients: [{ userId: 55, channels: ['in_app'], title: 't', body: null, context: {} }],
      },
    })
    h.upsertCollapsedNotification.mockResolvedValue({ id: 100, inserted: true, groupCount: 1 })
    const outcome = await processNotificationJob(JOB, CONTEXT, () => 'online')
    expect(outcome).toEqual({ kind: 'done', created: 1 })
    expect(h.recordDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ channel: 'in_app' }),
    )
  })
})
