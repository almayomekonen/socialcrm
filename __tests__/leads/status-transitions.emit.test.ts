/**
 * A2 — the shared status emitter records durable transition history.
 *
 * `emitLeadStatusChanged` is the ONE place every status-writing surface routes
 * through, so it is where history is captured. These pin the behaviour that
 * makes the log trustworthy: a real move is recorded with both ends, a no-op
 * re-save records nothing, the caller's transaction is joined when present, and
 * a logging failure can never break the user's status change.
 *
 * Runs under VITEST_NO_DB=1 — the DB layer is mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const recordStatusTransition = vi.fn()
const emitAutomationEvent = vi.fn()
const notifyEvent = vi.fn()

vi.mock('@/db/leadStatusTransitions', async (importOriginal) => {
  // Keep the REAL pure helpers — only the executor is mocked, so these tests
  // exercise the actual recordable/no-op decision rather than a stub of it.
  const actual = await importOriginal<typeof import('@/db/leadStatusTransitions')>()
  return { ...actual, recordStatusTransition: (...a: unknown[]) => recordStatusTransition(...a) }
})

vi.mock('@/lib/automations/emit', () => ({
  emitAutomationEvent: (...a: unknown[]) => emitAutomationEvent(...a),
}))

vi.mock('@/lib/notifications/emit', () => ({
  notifyEvent: (...a: unknown[]) => notifyEvent(...a),
}))

import { emitLeadStatusChanged } from '@/lib/automations/statusChanged'

const AGENCY = 7
const LEAD = 15015
const ACTOR = 42
const OCCURRED_AT = new Date('2026-08-24T09:00:00.000Z')

const emit = (over: Record<string, unknown> = {}) =>
  emitLeadStatusChanged({
    agencyId: AGENCY,
    leadId: LEAD,
    newStatus: 'contacted',
    previousStatus: 'new',
    source: 'manual',
    occurredAt: OCCURRED_AT,
    actorUserId: ACTOR,
    leadName: 'דנה',
    ...over,
  } as Parameters<typeof emitLeadStatusChanged>[0])

describe('emitLeadStatusChanged — transition history', () => {
  beforeEach(() => {
    recordStatusTransition.mockReset().mockResolvedValue(undefined)
    emitAutomationEvent.mockReset().mockResolvedValue(undefined)
    notifyEvent.mockReset().mockResolvedValue(undefined)
  })

  it('records a real move with both ends, the actor and the source', async () => {
    await emit()
    expect(recordStatusTransition).toHaveBeenCalledTimes(1)
    expect(recordStatusTransition.mock.calls[0][0]).toEqual({
      agencyId: AGENCY,
      leadId: LEAD,
      fromStatus: 'new',
      toStatus: 'contacted',
      occurredAt: OCCURRED_AT,
      actorUserId: ACTOR,
      source: 'manual',
    })
  })

  it('records NOTHING when the status did not actually change', async () => {
    await emit({ previousStatus: 'contacted', newStatus: 'contacted' })
    expect(recordStatusTransition).not.toHaveBeenCalled()
  })

  it('still emits to both engines on a no-op status write (behaviour unchanged)', async () => {
    await emit({ previousStatus: 'contacted', newStatus: 'contacted' })
    expect(emitAutomationEvent).toHaveBeenCalledTimes(1)
    expect(notifyEvent).toHaveBeenCalledTimes(1)
  })

  it('records a null origin when the previous status is unknown', async () => {
    await emit({ previousStatus: undefined })
    expect(recordStatusTransition.mock.calls[0][0]).toMatchObject({ fromStatus: null, toStatus: 'contacted' })
  })

  it('defaults source to manual when the caller omits it', async () => {
    await emit({ source: undefined })
    expect(recordStatusTransition.mock.calls[0][0]).toMatchObject({ source: 'manual' })
  })

  it('treats an absent actor as a system actor', async () => {
    await emit({ actorUserId: undefined })
    expect(recordStatusTransition.mock.calls[0][0]).toMatchObject({ actorUserId: null })
  })

  it("joins the caller's transaction when one is supplied", async () => {
    const trx = { __isTrx: true } as never
    await emit({ trx })
    expect(recordStatusTransition.mock.calls[0][1]).toBe(trx)
  })

  it('passes no executor when the caller has no transaction (data layer defaults to db)', async () => {
    await emit()
    expect(recordStatusTransition.mock.calls[0][1]).toBeUndefined()
  })

  it('writes history BEFORE the two engines, so a future change to either cannot cost the record', async () => {
    const order: string[] = []
    recordStatusTransition.mockImplementation(async () => void order.push('transition'))
    emitAutomationEvent.mockImplementation(async () => void order.push('automation'))
    notifyEvent.mockImplementation(async () => void order.push('notify'))
    await emit()
    expect(order).toEqual(['transition', 'automation', 'notify'])
  })

  it('never breaks the status change when logging fails', async () => {
    recordStatusTransition.mockRejectedValue(new Error('table missing'))
    await expect(emit()).resolves.toBeUndefined()
    // Both engines still ran — the user's status change is unaffected.
    expect(emitAutomationEvent).toHaveBeenCalledTimes(1)
    expect(notifyEvent).toHaveBeenCalledTimes(1)
  })

  it('records nothing for a non-positive leadId rather than writing an orphan row', async () => {
    await emit({ leadId: 0 })
    expect(recordStatusTransition).not.toHaveBeenCalled()
  })
})
