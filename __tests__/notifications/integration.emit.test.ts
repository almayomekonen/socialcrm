/**
 * P3.3 — integration.disconnected + integration.ingestion_failed emitters.
 *
 * HARNESS LIMITATION: `npm run test:notifications` is VITEST_NO_DB=1. This file
 * drives the REAL Facebook/WhatsApp integration notification helpers with `db`
 * and `notifyEvent` mocked — enough to prove:
 *
 *   - real disconnect transition → one notification
 *   - already-expired / repeated detection → no duplicate
 *   - real ingestion failure → notification
 *   - same external lead retry → same eventKey (no duplicate job identity)
 *   - recovery writes healthy without inventing isResolved / resolve emit
 *   - admin_only recipients + agency isolation
 *   - system actor (null) — no self-notification path
 *
 * Runs without a database: `npm run test:notifications`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  eventKeyForEvent,
  integrationDisconnectedEventKey,
  integrationIngestionFailedEventKey,
} from '@/lib/notifications/eventKey'
import { resolveRecipients, type RecipientContext } from '@/db/notifications/recipients'
import { planNotification } from '@/lib/notifications/plan'
import { IN_APP_ONLY_CAPABILITIES } from '@/lib/notifications/policy'
import { NOTIFICATION_REGISTRY } from '@/lib/notifications/registry'
import type { NotificationEvent, Presence } from '@/lib/notifications/types'

const AGENCY = 7
const OTHER_AGENCY = 99
const PAGE_ROW = 31
const WA_ROW = 44
const ADMIN = 1
const REP = 55
const META_LEAD = 'leadgen_abc'
const WA_MSG = 'wamid.XYZ'

const notifyEvent = vi.fn()

vi.mock('@/lib/notifications/emit', () => ({
  notifyEvent: (...args: unknown[]) => notifyEvent(...args),
}))

type PageState = {
  id: number
  agency_id: number
  page_id: string
  health_status: string
  health_checked_at: Date | null
}

let page: PageState
let updateCount: number

function makeQuery() {
  const q: any = {
    where: vi.fn(() => q),
    whereNot: vi.fn(() => q),
    update: vi.fn(async (payload: Record<string, unknown>) => {
      if (page.health_status === 'token_expired') return 0
      page.health_status = String(payload.health_status)
      page.health_checked_at = payload.health_checked_at as Date
      updateCount += 1
      return 1
    }),
  }
  return q
}

vi.mock('@/config/db', () => ({
  db: vi.fn(() => makeQuery()),
}))

const {
  markFacebookDisconnectedAndNotify,
  notifyFacebookIngestionFailed,
} = await import('@/lib/facebook/integrationNotifications')
const { notifyWhatsappIngestionFailed } = await import('@/lib/whatsapp/integrationNotifications')

beforeEach(() => {
  notifyEvent.mockReset()
  notifyEvent.mockResolvedValue({ enqueued: true, jobId: 1 })
  updateCount = 0
  page = {
    id: PAGE_ROW,
    agency_id: AGENCY,
    page_id: 'page_1',
    health_status: 'healthy',
    health_checked_at: null,
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('markFacebookDisconnectedAndNotify', () => {
  it('real disconnect transition → one integration.disconnected event', async () => {
    const result = await markFacebookDisconnectedAndNotify(page)

    expect(result).toBe('emitted')
    expect(updateCount).toBe(1)
    expect(page.health_status).toBe('token_expired')
    expect(notifyEvent).toHaveBeenCalledTimes(1)
    const ev = notifyEvent.mock.calls[0][0] as NotificationEvent
    expect(ev).toMatchObject({
      type: 'integration.disconnected',
      agencyId: AGENCY,
      entityType: 'integration',
      entityId: PAGE_ROW,
      actorUserId: null,
      payload: { provider: 'facebook' },
    })
    expect(typeof ev.payload.disconnectedAt).toBe('number')
    expect(ev.payload.disconnectedAt).toBe(page.health_checked_at!.getTime())
  })

  it('repeated detection while already expired → no duplicate', async () => {
    await markFacebookDisconnectedAndNotify(page)
    notifyEvent.mockClear()
    updateCount = 0

    const again = await markFacebookDisconnectedAndNotify(page)
    expect(again).toBe('already_disconnected')
    expect(updateCount).toBe(0)
    expect(notifyEvent).not.toHaveBeenCalled()
  })

  it('recovery to healthy does not invent resolve; next disconnect is a new episode', async () => {
    expect(NOTIFICATION_REGISTRY['integration.disconnected'].isResolved).toBeUndefined()
    expect(NOTIFICATION_REGISTRY['integration.ingestion_failed'].isResolved).toBeUndefined()

    await markFacebookDisconnectedAndNotify(page)
    const firstKey = eventKeyForEvent(notifyEvent.mock.calls[0][0] as NotificationEvent)

    // Product recovery path today: successful webhook sets health_status healthy.
    // No notification resolve API is invoked (registry has no isResolved).
    page.health_status = 'healthy'
    page.health_checked_at = new Date()
    notifyEvent.mockClear()

    const second = await markFacebookDisconnectedAndNotify(page)
    expect(second).toBe('emitted')
    expect(notifyEvent).toHaveBeenCalledTimes(1)
    const secondKey = eventKeyForEvent(notifyEvent.mock.calls[0][0] as NotificationEvent)
    expect(secondKey).not.toBe(firstKey)
  })
})

describe('notifyFacebookIngestionFailed / notifyWhatsappIngestionFailed', () => {
  it('real Facebook ingestion failure → notification', async () => {
    await notifyFacebookIngestionFailed(page, META_LEAD)
    expect(notifyEvent).toHaveBeenCalledTimes(1)
    expect(notifyEvent.mock.calls[0][0]).toMatchObject({
      type: 'integration.ingestion_failed',
      agencyId: AGENCY,
      entityType: 'integration',
      entityId: PAGE_ROW,
      actorUserId: null,
      payload: { provider: 'facebook', externalLeadId: META_LEAD },
    })
  })

  it('real WhatsApp create-null path → notification', async () => {
    await notifyWhatsappIngestionFailed({ id: WA_ROW, agency_id: AGENCY }, WA_MSG)
    expect(notifyEvent).toHaveBeenCalledTimes(1)
    expect(notifyEvent.mock.calls[0][0]).toMatchObject({
      type: 'integration.ingestion_failed',
      agencyId: AGENCY,
      entityId: WA_ROW,
      actorUserId: null,
      payload: { provider: 'whatsapp', externalLeadId: WA_MSG },
    })
  })

  it('repeated detection of the same external lead → identical eventKey', async () => {
    await notifyFacebookIngestionFailed(page, META_LEAD)
    await notifyFacebookIngestionFailed(page, META_LEAD)
    expect(notifyEvent).toHaveBeenCalledTimes(2)
    const a = eventKeyForEvent(notifyEvent.mock.calls[0][0] as NotificationEvent)
    const b = eventKeyForEvent(notifyEvent.mock.calls[1][0] as NotificationEvent)
    expect(a).toBe(b)
    expect(a).toBe(
      `integration.ingestion_failed:${AGENCY}:integration:${PAGE_ROW}:ext:${META_LEAD}`,
    )
  })

  it('blank external id emits nothing', async () => {
    await notifyFacebookIngestionFailed(page, '  ')
    await notifyWhatsappIngestionFailed({ id: WA_ROW, agency_id: AGENCY }, '')
    expect(notifyEvent).not.toHaveBeenCalled()
  })
})

describe('integration event identity', () => {
  it('disconnected requires disconnectedAt', () => {
    expect(() =>
      integrationDisconnectedEventKey({
        type: 'integration.disconnected',
        agencyId: AGENCY,
        entityType: 'integration',
        entityId: PAGE_ROW,
        actorUserId: null,
        occurredAt: new Date(),
        payload: { provider: 'facebook' },
      }),
    ).toThrow(/disconnectedAt/)
  })

  it('ingestion_failed requires externalLeadId', () => {
    expect(() =>
      integrationIngestionFailedEventKey({
        type: 'integration.ingestion_failed',
        agencyId: AGENCY,
        entityType: 'integration',
        entityId: PAGE_ROW,
        actorUserId: null,
        occurredAt: new Date(),
        payload: { provider: 'facebook' },
      }),
    ).toThrow(/externalLeadId/)
  })
})

describe('recipients: admin_only + agency isolation + system actor', () => {
  function context(agencyId: number, admins: number[]): RecipientContext {
    return {
      handlerByLead: new Map(),
      adminsByAgency: new Map([
        [agencyId, admins],
        [OTHER_AGENCY, [9001]],
      ]),
    }
  }

  it('integration.disconnected recipients are agency admins only', () => {
    const def = NOTIFICATION_REGISTRY['integration.disconnected']
    expect(def.recipients).toBe('admin_only')
    const recipients = resolveRecipients({
      rule: 'admin_only',
      agencyId: AGENCY,
      leadId: null,
      context: context(AGENCY, [ADMIN]),
    })
    expect(recipients).toEqual([ADMIN])
    expect(recipients).not.toContain(REP)
  })

  it('agency isolation: other agency admins are not recipients', () => {
    const recipients = resolveRecipients({
      rule: 'admin_only',
      agencyId: AGENCY,
      leadId: null,
      context: context(AGENCY, [ADMIN]),
    })
    expect(recipients).toEqual([ADMIN])
    expect(recipients).not.toContain(9001)
  })

  it('system actor (null) — plan does not self-drop; admin still planned', () => {
    const result = planNotification({
      job: {
        agencyId: AGENCY,
        type: 'integration.disconnected',
        actorUserId: null,
        entityType: 'integration',
        entityId: PAGE_ROW,
        payload: { provider: 'facebook', disconnectedAt: 1 },
        createdAt: '2026-08-12T10:00:00.000Z',
      },
      context: context(AGENCY, [ADMIN]),
      presence: () => 'online' as Presence,
      capabilities: IN_APP_ONLY_CAPABILITIES,
    })
    expect('plan' in result).toBe(true)
    if (!('plan' in result)) return
    expect(result.plan.recipients.map((r) => r.userId)).toEqual([ADMIN])
  })

  it('ingestion_failed is also admin_only', () => {
    expect(NOTIFICATION_REGISTRY['integration.ingestion_failed'].recipients).toBe('admin_only')
  })
})
