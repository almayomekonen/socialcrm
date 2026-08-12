/**
 * P3.3 — lead.assigned emitter boundary (transferLeadToRep).
 *
 * HARNESS LIMITATION: `npm run test:notifications` is VITEST_NO_DB=1. This file
 * drives the REAL `transferLeadToRep` server action with `db.transaction`,
 * `requireProductAccess`, and `notifyEvent` mocked — enough to prove:
 *
 *   - emit only after a successful assignment persist
 *   - both userId and handlerId are written (recipient field alignment)
 *   - same-assignee retry is a no-op (no notifyEvent)
 *   - notifyEvent joins the caller's transaction (rollback absorbs the job)
 *   - event identity uses assignedUserId
 *   - actor===assignee is dropped by planNotification (§6.3)
 *   - previous handler is not a recipient after persist
 *   - cross-agency isolation of recipient resolution
 *
 * Runs without a database: `npm run test:notifications`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eventKeyForEvent, leadAssignedEventKey } from '@/lib/notifications/eventKey'
import { leadKey, resolveRecipients, type RecipientContext } from '@/db/notifications/recipients'
import { planNotification } from '@/lib/notifications/plan'
import { IN_APP_ONLY_CAPABILITIES } from '@/lib/notifications/policy'
import type { NotificationEvent, Presence } from '@/lib/notifications/types'

const AGENCY = 7
const ACTOR = 10
const REP_A = 55
const REP_B = 66
const ADMIN = 1
const LEAD = 42

const notifyEvent = vi.fn()
const revalidatePath = vi.fn()
const requireProductAccess = vi.fn()

vi.mock('@/lib/notifications/emit', () => ({
  notifyEvent: (...args: unknown[]) => notifyEvent(...args),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}))

vi.mock('@/lib/requireUser', () => ({
  requireProductAccess: (...args: unknown[]) => requireProductAccess(...args),
}))

type LeadRow = {
  id: number
  userId: number | null
  handlerId: number | null
  firstName: string | null
  lastName: string | null
}

let leadRow: LeadRow
let lastTrx: any
let updatePayload: Record<string, unknown> | null
let failOnUpdate = false

function makeTrx() {
  const trx: any = vi.fn(() => trx)
  trx.where = vi.fn(() => trx)
  trx.forUpdate = vi.fn(() => trx)
  trx.first = vi.fn(async () => ({ ...leadRow }))
  trx.update = vi.fn(async (payload: Record<string, unknown>) => {
    if (failOnUpdate) throw new Error('forced_rollback')
    updatePayload = payload
    if (payload.userId !== undefined) leadRow.userId = Number(payload.userId)
    if (payload.handlerId !== undefined) leadRow.handlerId = Number(payload.handlerId)
    return 1
  })
  lastTrx = trx
  return trx
}

vi.mock('@/config/db', () => ({
  db: {
    transaction: async (fn: (t: unknown) => Promise<unknown>) => {
      const trx = makeTrx()
      try {
        return await fn(trx)
      } catch (err) {
        // Simulate rollback: revert in-memory row if a test set rolledBack mid-flight
        // is not needed — tests that want rollback throw before mutate completes.
        throw err
      }
    },
  },
}))

const { transferLeadToRep } = await import('@/actions/clients')

beforeEach(() => {
  notifyEvent.mockReset()
  notifyEvent.mockResolvedValue({ enqueued: true, jobId: 1 })
  revalidatePath.mockReset()
  requireProductAccess.mockReset()
  requireProductAccess.mockResolvedValue({ id: ACTOR, agencyId: AGENCY, role: 'ADMIN' })
  leadRow = { id: LEAD, userId: REP_A, handlerId: REP_A, firstName: 'דניאל', lastName: 'כהן' }
  updatePayload = null
  failOnUpdate = false
  lastTrx = null
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('transferLeadToRep → notifyEvent(lead.assigned)', () => {
  it('persists userId AND handlerId to the new assignee, then emits once', async () => {
    await transferLeadToRep(LEAD, REP_B)

    expect(updatePayload).toEqual({ userId: REP_B, handlerId: REP_B })
    expect(notifyEvent).toHaveBeenCalledTimes(1)
    expect(notifyEvent.mock.calls[0][0]).toMatchObject({
      type: 'lead.assigned',
      agencyId: AGENCY,
      entityType: 'lead',
      entityId: LEAD,
      actorUserId: ACTOR,
      payload: { leadName: 'דניאל כהן', assignedUserId: REP_B },
    })
    expect(notifyEvent.mock.calls[0][1]).toMatchObject({ trx: lastTrx })
    expect(revalidatePath).toHaveBeenCalledWith('/leads')
  })

  it('Rep B → Rep B (no change) emits nothing', async () => {
    leadRow = { id: LEAD, userId: REP_B, handlerId: REP_B, firstName: 'דניאל', lastName: 'כהן' }
    await transferLeadToRep(LEAD, REP_B)
    expect(notifyEvent).not.toHaveBeenCalled()
    expect(updatePayload).toBeNull()
  })

  it('repeated transfer to the same assignee is absorbed by event identity', async () => {
    await transferLeadToRep(LEAD, REP_B)
    const firstKey = eventKeyForEvent(notifyEvent.mock.calls[0][0] as NotificationEvent)

    // Simulate a second call that still "changes" from a stale read is not needed —
    // identity of two emits to REP_B for the same lead must match.
    const retryEvent: NotificationEvent = {
      type: 'lead.assigned',
      agencyId: AGENCY,
      entityType: 'lead',
      entityId: LEAD,
      actorUserId: ACTOR,
      occurredAt: new Date(),
      payload: { assignedUserId: REP_B },
    }
    expect(eventKeyForEvent(retryEvent)).toBe(firstKey)
    expect(firstKey).toBe(`lead.assigned:${AGENCY}:lead:${LEAD}:to:${REP_B}`)
  })

  it('unassigned handler → Rep B persists and emits', async () => {
    leadRow = { id: LEAD, userId: null, handlerId: null, firstName: 'דנה', lastName: null }
    await transferLeadToRep(LEAD, REP_B)
    expect(updatePayload).toEqual({ userId: REP_B, handlerId: REP_B })
    expect(notifyEvent).toHaveBeenCalledTimes(1)
    expect(notifyEvent.mock.calls[0][0].payload.assignedUserId).toBe(REP_B)
  })

  it('rollback before notifyEvent does not emit', async () => {
    failOnUpdate = true
    await expect(transferLeadToRep(LEAD, REP_B)).rejects.toThrow('forced_rollback')
    expect(notifyEvent).not.toHaveBeenCalled()
  })
  it('joins notifyEvent to the transaction so a later throw rolls the job back with it', async () => {
    notifyEvent.mockImplementation(async () => {
      throw new Error('enqueue_boom')
    })
    await expect(transferLeadToRep(LEAD, REP_B)).rejects.toThrow('enqueue_boom')
    // Persist ran before notify in the same trx — product code order is update then notify.
    // The thrown error propagates out of the transaction callback (knex rolls back).
    expect(updatePayload).toEqual({ userId: REP_B, handlerId: REP_B })
    expect(notifyEvent).toHaveBeenCalledTimes(1)
    expect(notifyEvent.mock.calls[0][1]).toMatchObject({ trx: lastTrx })
  })
})

describe('lead.assigned event identity', () => {
  it('rejects a missing assignedUserId rather than inventing once-per-lead', () => {
    expect(() =>
      leadAssignedEventKey({
        type: 'lead.assigned',
        agencyId: AGENCY,
        entityType: 'lead',
        entityId: LEAD,
        occurredAt: new Date(),
        payload: {},
      }),
    ).toThrow(/assignedUserId/)
  })
})

describe('recipients after assignment — handler_or_admin on the NEW handlerId', () => {
  function context(handler: number | null, opts?: { agency?: number; leadPresent?: boolean }): RecipientContext {
    const agency = opts?.agency ?? AGENCY
    const handlerByLead = new Map<string, number | null>()
    if (opts?.leadPresent !== false) handlerByLead.set(leadKey(agency, LEAD), handler)
    return { handlerByLead, adminsByAgency: new Map([[agency, [ADMIN]]]) }
  }

  it('new handler receives the notification; previous handler does not', () => {
    // After persist, the batch context only knows the NEW handlerId.
    const recipients = resolveRecipients({
      rule: 'handler_or_admin',
      agencyId: AGENCY,
      leadId: LEAD,
      context: context(REP_B),
    })
    expect(recipients).toEqual([REP_B])
    expect(recipients).not.toContain(REP_A)
  })

  it('actor === new handler → plan skips (no self-notification)', () => {
    const result = planNotification({
      job: {
        agencyId: AGENCY,
        type: 'lead.assigned',
        actorUserId: REP_B,
        entityType: 'lead',
        entityId: LEAD,
        payload: { leadName: 'דניאל כהן', assignedUserId: REP_B },
        createdAt: '2026-08-12T10:00:00.000Z',
      },
      context: context(REP_B),
      presence: () => 'offline' as Presence,
      capabilities: IN_APP_ONLY_CAPABILITIES,
    })
    expect(result).toEqual({ skip: 'actor_only' })
  })

  it('admin transfers to Rep B → Rep B is notified, admin actor is dropped if also resolved', () => {
    // Unassigned fallback would include admins; after assignment only REP_B.
    const result = planNotification({
      job: {
        agencyId: AGENCY,
        type: 'lead.assigned',
        actorUserId: ACTOR,
        entityType: 'lead',
        entityId: LEAD,
        payload: { assignedUserId: REP_B, leadName: 'דניאל' },
        createdAt: '2026-08-12T10:00:00.000Z',
      },
      context: context(REP_B),
      presence: () => 'online' as Presence,
      capabilities: IN_APP_ONLY_CAPABILITIES,
    })
    expect('plan' in result).toBe(true)
    if (!('plan' in result)) return
    expect(result.plan.recipients.map((r) => r.userId)).toEqual([REP_B])
    expect(result.plan.recipients[0].title).toContain('שויך')
  })

  it('never crosses tenants', () => {
    expect(
      resolveRecipients({
        rule: 'handler_or_admin',
        agencyId: 999,
        leadId: LEAD,
        context: context(REP_B),
      }),
    ).toEqual([])
  })
})
