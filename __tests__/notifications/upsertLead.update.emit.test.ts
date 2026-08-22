/**
 * Task 4 — upsertLead UPDATE closes status/assignment notification bypass.
 *
 * ClientFormPop edits route through upsertLead(clientId), which previously
 * persisted status/handlerId with no emit. Status control uses updateLead;
 * transfer uses transferLeadToRep — those paths stay untouched.
 *
 * Runs under VITEST_NO_DB=1.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eventKeyForEvent } from '@/lib/notifications/eventKey'
import type { NotificationEvent } from '@/lib/notifications/types'

const AGENCY = 7
const ACTOR = 10
const HANDLER_A = 55
const HANDLER_B = 66
const LEAD = 42

const requireProductAccess = vi.fn()
const notifyEvent = vi.fn()
const emitLeadStatusChanged = vi.fn()
const revalidatePath = vi.fn()
const assertLeadQuota = vi.fn()
const emitLeadCreated = vi.fn()
const emitAutomationEvent = vi.fn()
const getAgencyId = vi.fn()
const withAgencyQuotaLock = vi.fn()

vi.mock('@/lib/requireUser', () => ({
  requireProductAccess: (...args: unknown[]) => requireProductAccess(...args),
  // upsertLead now enters through the basic-CRM guard and escalates only on its
  // create/convert branches, so the mock must expose both doors. Same user.
  requireBasicCrmAccess: (...args: unknown[]) => requireProductAccess(...args),
}))

vi.mock('@/lib/notifications/emit', () => ({
  notifyEvent: (...args: unknown[]) => notifyEvent(...args),
}))

vi.mock('@/lib/automations/statusChanged', () => ({
  emitLeadStatusChanged: (...args: unknown[]) => emitLeadStatusChanged(...args),
}))

vi.mock('@/lib/notifications/emitLeadCreated', () => ({
  emitLeadCreated: (...args: unknown[]) => emitLeadCreated(...args),
}))

vi.mock('@/lib/automations/emit', () => ({
  emitAutomationEvent: (...args: unknown[]) => emitAutomationEvent(...args),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}))

vi.mock('@/db/agencies', () => ({
  getAgencyId: (...args: unknown[]) => getAgencyId(...args),
}))

vi.mock('@/lib/quota', () => ({
  assertLeadQuota: (...args: unknown[]) => assertLeadQuota(...args),
  withAgencyQuotaLock: (...args: unknown[]) => withAgencyQuotaLock(...args),
  QuotaExceededError: class QuotaExceededError extends Error {
    current = 0
    limit = 0
    attempted = 0
  },
  getEffectiveLeadPlan: vi.fn(),
}))

type LeadRow = {
  id: number
  agencyId: number
  lead: boolean
  status: string | null
  handlerId: number | null
  userId: number | null
  firstName: string | null
  lastName: string | null
}

let leadRow: LeadRow
let lastUpdate: Record<string, unknown> | null
let lastTrx: any
let failOnUpdate = false
let failOnNotify = false

function makeTrx() {
  const trx: any = vi.fn((table: string) => {
    if (table !== 'clients') throw new Error(`unexpected ${table}`)
    return trx
  })
  trx.where = vi.fn(() => trx)
  trx.forUpdate = vi.fn(() => trx)
  trx.first = vi.fn(async (cols?: unknown) => {
    void cols
    return { ...leadRow }
  })
  trx.update = vi.fn((payload: Record<string, unknown>) => {
    if (failOnUpdate) {
      const rejected: any = Promise.reject(new Error('forced_rollback'))
      rejected.returning = () => rejected
      return rejected
    }
    lastUpdate = payload
    if (payload.status !== undefined) leadRow.status = payload.status as string
    if (payload.handlerId !== undefined) {
      leadRow.handlerId = payload.handlerId == null ? null : Number(payload.handlerId)
    }
    if (payload.userId !== undefined) {
      leadRow.userId = payload.userId == null ? null : Number(payload.userId)
    }
    if (payload.firstName !== undefined) leadRow.firstName = payload.firstName as string
    const updated = { ...leadRow, ...payload }
    const chain: any = {
      returning: async () => [updated],
      then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(1).then(onFulfilled, onRejected),
    }
    return chain
  })
  lastTrx = trx
  return trx
}

vi.mock('@/config/db', () => ({
  db: {
    transaction: async (fn: (t: unknown) => Promise<unknown>) => {
      const trx = makeTrx()
      return fn(trx)
    },
    // INSERT / non-trx paths unused by these UPDATE tests
    raw: vi.fn(),
  },
}))

const { upsertLead, transferLeadToRep } = await import('@/actions/clients')

beforeEach(() => {
  requireProductAccess.mockReset()
  requireProductAccess.mockResolvedValue({ id: ACTOR, agencyId: AGENCY, role: 'ADMIN' })
  notifyEvent.mockReset()
  notifyEvent.mockImplementation(async () => {
    if (failOnNotify) throw new Error('enqueue_boom')
    return { enqueued: true, jobId: 1 }
  })
  emitLeadStatusChanged.mockReset()
  emitLeadStatusChanged.mockResolvedValue(undefined)
  revalidatePath.mockReset()
  assertLeadQuota.mockReset()
  emitLeadCreated.mockReset()
  emitAutomationEvent.mockReset()
  getAgencyId.mockReset()
  withAgencyQuotaLock.mockReset()
  leadRow = {
    id: LEAD,
    agencyId: AGENCY,
    lead: true,
    status: 'new',
    handlerId: HANDLER_A,
    userId: HANDLER_A,
    firstName: 'דניאל',
    lastName: 'כהן',
  }
  lastUpdate = null
  lastTrx = null
  failOnUpdate = false
  failOnNotify = false
})

describe('upsertLead UPDATE — assignment', () => {
  it('handler A → B emits lead.assigned to B (new handler) inside the trx', async () => {
    await upsertLead(ACTOR, { handlerId: HANDLER_B, firstName: 'דניאל' }, LEAD, false)

    expect(notifyEvent).toHaveBeenCalledTimes(1)
    expect(notifyEvent.mock.calls[0][0]).toMatchObject({
      type: 'lead.assigned',
      agencyId: AGENCY,
      entityType: 'lead',
      entityId: LEAD,
      actorUserId: ACTOR,
      payload: { assignedUserId: HANDLER_B, leadName: 'דניאל כהן' },
    })
    expect(notifyEvent.mock.calls[0][1]).toMatchObject({ trx: lastTrx })
    expect(emitLeadStatusChanged).not.toHaveBeenCalled()
  })

  it('same handler → no assignment notification', async () => {
    await upsertLead(ACTOR, { handlerId: HANDLER_A, firstName: 'דניאל' }, LEAD, false)
    expect(notifyEvent).not.toHaveBeenCalled()
  })
})

describe('upsertLead UPDATE — status', () => {
  it('status A → B emits via emitLeadStatusChanged with row statusChangedAt', async () => {
    await upsertLead(ACTOR, { status: 'contacted', firstName: 'דניאל' }, LEAD, false)

    expect(emitLeadStatusChanged).toHaveBeenCalledTimes(1)
    const args = emitLeadStatusChanged.mock.calls[0][0]
    expect(args).toMatchObject({
      agencyId: AGENCY,
      leadId: LEAD,
      newStatus: 'contacted',
      actorUserId: ACTOR,
      leadName: 'דניאל כהן',
    })
    expect(args.occurredAt).toBeInstanceOf(Date)
    expect(args.trx).toBe(lastTrx)
    expect(lastUpdate).toMatchObject({ status: 'contacted' })
    expect(lastUpdate?.statusChangedAt).toBeInstanceOf(Date)
    expect(lastUpdate?.statusChangedAt).toEqual(args.occurredAt)
    expect(notifyEvent).not.toHaveBeenCalled()
  })

  it('same status → no status notification', async () => {
    await upsertLead(ACTOR, { status: 'new', firstName: 'דניאל' }, LEAD, false)
    expect(emitLeadStatusChanged).not.toHaveBeenCalled()
    expect(lastUpdate).not.toHaveProperty('statusChangedAt')
  })
})

describe('upsertLead UPDATE — combined + atomicity', () => {
  it('assignment + status in one update emits both once (assign then status)', async () => {
    await upsertLead(ACTOR, { handlerId: HANDLER_B, status: 'interested' }, LEAD, false)

    expect(notifyEvent).toHaveBeenCalledTimes(1)
    expect(notifyEvent.mock.calls[0][0].type).toBe('lead.assigned')
    expect(emitLeadStatusChanged).toHaveBeenCalledTimes(1)
    expect(emitLeadStatusChanged.mock.calls[0][0].newStatus).toBe('interested')

    // Deterministic order: assignment before status.
    const assignOrder = notifyEvent.mock.invocationCallOrder[0]
    const statusOrder = emitLeadStatusChanged.mock.invocationCallOrder[0]
    expect(assignOrder).toBeLessThan(statusOrder)
  })

  it('rollback on update → no notification', async () => {
    failOnUpdate = true
    await expect(upsertLead(ACTOR, { status: 'contacted', handlerId: HANDLER_B }, LEAD, false)).resolves.toMatchObject({
      err: true,
    })
    expect(notifyEvent).not.toHaveBeenCalled()
    expect(emitLeadStatusChanged).not.toHaveBeenCalled()
  })

  it('rollback on enqueue after persist throws out of the transaction path', async () => {
    failOnNotify = true
    await expect(upsertLead(ACTOR, { handlerId: HANDLER_B }, LEAD, false)).resolves.toMatchObject({ err: true })
    expect(notifyEvent).toHaveBeenCalledTimes(1)
  })
})

describe('existing transferLeadToRep path unchanged', () => {
  it('still emits lead.assigned with both userId+handlerId and stable eventKey', async () => {
    // transferLeadToRep uses the same db.transaction mock
    await transferLeadToRep(LEAD, HANDLER_B)
    expect(lastUpdate).toEqual({ userId: HANDLER_B, handlerId: HANDLER_B })
    expect(notifyEvent).toHaveBeenCalledTimes(1)
    const event = notifyEvent.mock.calls[0][0] as NotificationEvent
    expect(eventKeyForEvent(event)).toBe(`lead.assigned:${AGENCY}:lead:${LEAD}:to:${HANDLER_B}`)
  })
})
