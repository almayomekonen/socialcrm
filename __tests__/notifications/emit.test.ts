import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eventKeyFor, eventKeyForEvent, statusChangedEventKey } from '@/lib/notifications/eventKey'
import type { NotificationEvent } from '@/lib/notifications/types'

/**
 * notifyEvent gates and the never-throw contract — spec §14, §23.1, §22.1.
 *
 * The queue module is mocked, so this file proves the GATES: what reaches the
 * database and what does not. That the kill switch performs no query at all is
 * the single most important assertion here — this function runs inside the
 * Facebook webhook.
 */

const enqueue = vi.fn<(...args: unknown[]) => Promise<number | null>>()

vi.mock('@/db/notifications/jobs', () => ({
  enqueueNotificationJob: (...args: unknown[]) => enqueue(...args),
}))

// config/db is imported for the default query builder; nothing may execute on it.
vi.mock('@/config/db', () => ({ db: { __marker: 'root-db' } }))

const { notifyEvent } = await import('@/lib/notifications/emit')

const event = (over: Partial<NotificationEvent> = {}): NotificationEvent => ({
  type: 'lead.created',
  agencyId: 7,
  entityType: 'lead',
  entityId: 42,
  actorUserId: null,
  occurredAt: new Date('2026-08-11T09:00:00.000Z'),
  payload: { leadName: 'דניאל כהן' },
  ...over,
})

const ENV = { ...process.env }

beforeEach(() => {
  enqueue.mockReset()
  enqueue.mockResolvedValue(1)
  process.env.NOTIFICATIONS_ENABLED = '1'
  process.env.NOTIFICATIONS_AGENCY_ALLOWLIST = 'all'
})

afterEach(() => {
  process.env = { ...ENV }
  vi.restoreAllMocks()
})

describe('the kill switch is genuinely off, not merely quiet (§23.1)', () => {
  it('absence of the flag blocks — the default state of every environment', () => {
    delete process.env.NOTIFICATIONS_ENABLED
    return notifyEvent(event()).then((result) => {
      expect(result).toEqual({ enqueued: false, reason: 'kill_switch' })
      expect(enqueue).not.toHaveBeenCalled()
    })
  })

  it('any value other than the literal 1 blocks', async () => {
    for (const value of ['0', 'true', 'yes', '']) {
      process.env.NOTIFICATIONS_ENABLED = value
      const result = await notifyEvent(event())
      expect(result, `NOTIFICATIONS_ENABLED=${value} should block`).toEqual({
        enqueued: false,
        reason: 'kill_switch',
      })
    }
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('touches NO database when disabled — the shadow metric is console-only', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.env.NOTIFICATIONS_ENABLED = '0'
    await notifyEvent(event())
    expect(enqueue).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('shadow'), expect.objectContaining({ type: 'lead.created' }))
  })
})

describe('the agency allowlist is a second, independent step (§23.1)', () => {
  it('an empty allowlist admits nobody even with the master switch on', async () => {
    process.env.NOTIFICATIONS_AGENCY_ALLOWLIST = ''
    expect(await notifyEvent(event())).toEqual({ enqueued: false, reason: 'agency_not_allowlisted' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('admits only the named agency', async () => {
    process.env.NOTIFICATIONS_AGENCY_ALLOWLIST = '7,9'
    expect(await notifyEvent(event({ agencyId: 7 }))).toMatchObject({ enqueued: true })
    expect(await notifyEvent(event({ agencyId: 8 }))).toEqual({ enqueued: false, reason: 'agency_not_allowlisted' })
  })

  it("'all' admits every agency", async () => {
    expect(await notifyEvent(event({ agencyId: 12345 }))).toMatchObject({ enqueued: true })
  })
})

describe('registry gating', () => {
  it('an unknown type enqueues nothing rather than guessing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await notifyEvent(event({ type: 'lead.exploded' as NotificationEvent['type'] }))).toEqual({
      enqueued: false,
      reason: 'unknown_type',
    })
    expect(enqueue).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })

  it('a disabled type enqueues nothing', async () => {
    expect(await notifyEvent(event({ type: 'sla.breached' }))).toEqual({ enqueued: false, reason: 'type_disabled' })
    expect(enqueue).not.toHaveBeenCalled()
  })
})

describe('the enqueue itself', () => {
  it('passes the event through with a deterministic key', async () => {
    await notifyEvent(event())
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue.mock.calls[0][1]).toEqual({
      agencyId: 7,
      type: 'lead.created',
      eventKey: 'lead.created:7:lead:42',
      actorUserId: null,
      entityType: 'lead',
      entityId: 42,
      payload: { leadName: 'דניאל כהן' },
    })
  })

  it('uses the caller\'s transaction when given one, so it rolls back with its cause', async () => {
    const trx = { __marker: 'caller-trx' } as never
    await notifyEvent(event(), { trx })
    expect(enqueue.mock.calls[0][0]).toBe(trx)
  })

  it('uses the root connection when there is no transaction', async () => {
    await notifyEvent(event())
    expect(enqueue.mock.calls[0][0]).toMatchObject({ __marker: 'root-db' })
  })

  it('reports a duplicate as a no-op, not an error', async () => {
    enqueue.mockResolvedValue(null)
    expect(await notifyEvent(event())).toEqual({ enqueued: false, reason: 'duplicate' })
  })
})

describe('the never-throw contract', () => {
  it('swallows a database failure — a notification must never break lead ingestion', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    enqueue.mockRejectedValue(new Error('connection terminated'))
    await expect(notifyEvent(event())).resolves.toEqual({ enqueued: false, reason: 'error' })
    expect(error).toHaveBeenCalled()
  })

  it('swallows a malformed event rather than propagating', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    // occurredAt is read to build the key for a status change.
    const broken = { ...event({ type: 'lead.status_changed' }), occurredAt: null as unknown as Date }
    await expect(notifyEvent(broken)).resolves.toEqual({ enqueued: false, reason: 'error' })
    expect(error).toHaveBeenCalled()
  })
})

describe('event keys are deterministic identities (§14.3)', () => {
  it('the same business fact always produces the same key', () => {
    expect(eventKeyFor(event())).toBe(eventKeyFor(event()))
  })

  it('namespaces by type, so two types about one lead cannot collide', () => {
    // The unique index is on eventKey ALONE — a bare entity id would make the
    // second type silently vanish.
    expect(eventKeyForEvent(event({ type: 'lead.created' }))).not.toBe(eventKeyForEvent(event({ type: 'lead.hot' })))
  })

  it('namespaces by agency and entity', () => {
    expect(eventKeyFor(event({ agencyId: 7 }))).not.toBe(eventKeyFor(event({ agencyId: 8 })))
    expect(eventKeyFor(event({ entityId: 42 }))).not.toBe(eventKeyFor(event({ entityId: 43 })))
  })

  it('a status change anchors on the business moment, so a retry is idempotent', () => {
    const at = new Date('2026-08-11T09:00:00.000Z')
    const first = statusChangedEventKey(event({ type: 'lead.status_changed', occurredAt: at, payload: { status: 'contacted' } }))
    const retry = statusChangedEventKey(event({ type: 'lead.status_changed', occurredAt: at, payload: { status: 'contacted' } }))
    expect(first).toBe(retry)
    expect(first).toContain('contacted')
  })

  it('the same lead reaching the same status LATER is a different event', () => {
    const a = statusChangedEventKey(
      event({ type: 'lead.status_changed', occurredAt: new Date(1000), payload: { status: 'contacted' } }),
    )
    const b = statusChangedEventKey(
      event({ type: 'lead.status_changed', occurredAt: new Date(2000), payload: { status: 'contacted' } }),
    )
    expect(a).not.toBe(b)
  })

  it('everything else is once-ever per entity — the analyzer changing its mind is not news', () => {
    const first = eventKeyForEvent(event({ type: 'lead.hot', occurredAt: new Date(1000) }))
    const later = eventKeyForEvent(event({ type: 'lead.hot', occurredAt: new Date(9_999_999) }))
    expect(first).toBe(later)
  })

  it('message.inbound anchors on the persisted message id, so a second message is news', () => {
    const a = eventKeyForEvent(
      event({
        type: 'message.inbound',
        entityType: 'conversation',
        entityId: 900,
        payload: { leadId: 42, messageId: 11 },
      }),
    )
    const b = eventKeyForEvent(
      event({
        type: 'message.inbound',
        entityType: 'conversation',
        entityId: 900,
        payload: { leadId: 42, messageId: 12 },
      }),
    )
    expect(a).toBe('message.inbound:7:conversation:900:msg:11')
    expect(b).toBe('message.inbound:7:conversation:900:msg:12')
    expect(a).not.toBe(b)
  })

  it('message.inbound identity is stable across a retry of the same message id', () => {
    const shape = {
      type: 'message.inbound' as const,
      entityType: 'conversation' as const,
      entityId: 900,
      payload: { leadId: 42, messageId: 11 },
    }
    expect(eventKeyForEvent(event(shape))).toBe(eventKeyForEvent(event(shape)))
  })

  it('lead.assigned anchors on the assignee, so a later transfer to someone else is news', () => {
    const a = eventKeyForEvent(
      event({ type: 'lead.assigned', entityId: 42, payload: { assignedUserId: 55 } }),
    )
    const b = eventKeyForEvent(
      event({ type: 'lead.assigned', entityId: 42, payload: { assignedUserId: 66 } }),
    )
    expect(a).toBe('lead.assigned:7:lead:42:to:55')
    expect(b).toBe('lead.assigned:7:lead:42:to:66')
    expect(a).not.toBe(b)
  })

  it('lead.assigned identity is stable across a retry of the same assignee', () => {
    const shape = { type: 'lead.assigned' as const, entityId: 42, payload: { assignedUserId: 55 } }
    expect(eventKeyForEvent(event(shape))).toBe(eventKeyForEvent(event(shape)))
  })

  it('integration.disconnected anchors on the transition moment', () => {
    const a = eventKeyForEvent(
      event({
        type: 'integration.disconnected',
        entityType: 'integration',
        entityId: 31,
        payload: { provider: 'facebook', disconnectedAt: 1_700_000_000_000 },
      }),
    )
    const b = eventKeyForEvent(
      event({
        type: 'integration.disconnected',
        entityType: 'integration',
        entityId: 31,
        payload: { provider: 'facebook', disconnectedAt: 1_700_000_000_999 },
      }),
    )
    expect(a).toBe('integration.disconnected:7:integration:31:at:1700000000000')
    expect(a).not.toBe(b)
  })

  it('integration.ingestion_failed anchors on the external lead id', () => {
    const a = eventKeyForEvent(
      event({
        type: 'integration.ingestion_failed',
        entityType: 'integration',
        entityId: 31,
        payload: { provider: 'facebook', externalLeadId: 'leadgen_a' },
      }),
    )
    const b = eventKeyForEvent(
      event({
        type: 'integration.ingestion_failed',
        entityType: 'integration',
        entityId: 31,
        payload: { provider: 'facebook', externalLeadId: 'leadgen_b' },
      }),
    )
    expect(a).toBe('integration.ingestion_failed:7:integration:31:ext:leadgen_a')
    expect(a).not.toBe(b)
  })
})
