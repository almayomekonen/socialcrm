/**
 * Task 1 — lead.created shared emit door (emitLeadCreated).
 *
 * Proves silence policy + notifyEvent fan-in before callers are switched.
 * Runs under VITEST_NO_DB=1 (`npm run test:notifications`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const notifyEvent = vi.fn()

vi.mock('@/lib/notifications/emit', () => ({
  notifyEvent: (...args: unknown[]) => notifyEvent(...args),
}))

const { shouldEmitLeadCreated, emitLeadCreated } = await import('@/lib/notifications/emitLeadCreated')

beforeEach(() => {
  notifyEvent.mockReset()
  notifyEvent.mockResolvedValue({ enqueued: true, jobId: 99 })
})

describe('shouldEmitLeadCreated', () => {
  it('silences import origin', () => {
    expect(shouldEmitLeadCreated('import')).toBe(false)
  })

  it('emits for webhook / manual / reconcile / provider webhooks', () => {
    expect(shouldEmitLeadCreated('webhook')).toBe(true)
    expect(shouldEmitLeadCreated('manual')).toBe(true)
    expect(shouldEmitLeadCreated('webhook_facebook')).toBe(true)
    expect(shouldEmitLeadCreated('webhook_whatsapp')).toBe(true)
    expect(shouldEmitLeadCreated('reconcile')).toBe(true)
  })
})

describe('emitLeadCreated', () => {
  const base = {
    agencyId: 7,
    leadId: 42,
    leadName: 'דניאל כהן',
    actorUserId: 10 as number | null,
    occurredAt: new Date('2026-08-12T12:00:00.000Z'),
  }

  it('does not call notifyEvent for import (silent_origin)', async () => {
    const res = await emitLeadCreated({ ...base, origin: 'import' })
    expect(notifyEvent).not.toHaveBeenCalled()
    expect(res).toEqual({ enqueued: false, skipped: 'silent_origin' })
  })

  it('calls notifyEvent with lead.created shape and passes trx', async () => {
    const trx = { __trx: true } as any
    const res = await emitLeadCreated(
      { ...base, origin: 'manual', actorUserId: 10 },
      { trx },
    )

    expect(notifyEvent).toHaveBeenCalledTimes(1)
    expect(notifyEvent.mock.calls[0][0]).toEqual({
      type: 'lead.created',
      agencyId: 7,
      entityType: 'lead',
      entityId: 42,
      actorUserId: 10,
      occurredAt: base.occurredAt,
      payload: { leadName: 'דניאל כהן' },
    })
    expect(notifyEvent.mock.calls[0][1]).toEqual({ trx })
    expect(res).toEqual({ enqueued: true, skipped: null })
  })

  it('maps notifyEvent duplicate / kill_switch / allowlist / type_disabled', async () => {
    notifyEvent.mockResolvedValueOnce({ enqueued: false, reason: 'duplicate' })
    expect(await emitLeadCreated({ ...base, origin: 'webhook_facebook', actorUserId: null })).toEqual({
      enqueued: false,
      skipped: 'duplicate',
    })

    notifyEvent.mockResolvedValueOnce({ enqueued: false, reason: 'kill_switch' })
    expect(await emitLeadCreated({ ...base, origin: 'webhook_whatsapp', actorUserId: null })).toEqual({
      enqueued: false,
      skipped: 'kill_switch',
    })

    notifyEvent.mockResolvedValueOnce({ enqueued: false, reason: 'agency_not_allowlisted' })
    expect(await emitLeadCreated({ ...base, origin: 'webhook', actorUserId: null })).toEqual({
      enqueued: false,
      skipped: 'not_allowlisted',
    })

    notifyEvent.mockResolvedValueOnce({ enqueued: false, reason: 'type_disabled' })
    expect(await emitLeadCreated({ ...base, origin: 'reconcile', actorUserId: null })).toEqual({
      enqueued: false,
      skipped: 'type_disabled',
    })
  })
})
