/**
 * Task 2 — CF7 / website new leads call emitLeadCreated(origin: 'webhook').
 *
 * Existing / phone / email / concurrent-adopt paths must stay silent.
 * emitAutomationEvent remains on the create path unchanged.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const insertLeadSystem = vi.fn()
const emitAutomationEvent = vi.fn()
const emitLeadCreated = vi.fn()
const getQuotaStatus = vi.fn()

vi.mock('@/lib/system/insertLeadSystem', () => ({
  insertLeadSystem: (...args: unknown[]) => insertLeadSystem(...args),
}))

vi.mock('@/lib/automations/emit', () => ({
  emitAutomationEvent: (...args: unknown[]) => emitAutomationEvent(...args),
}))

vi.mock('@/lib/notifications/emitLeadCreated', () => ({
  emitLeadCreated: (...args: unknown[]) => emitLeadCreated(...args),
}))

vi.mock('@/lib/quota', () => ({
  getQuotaStatus: (...args: unknown[]) => getQuotaStatus(...args),
}))

const CONNECTION = {
  id: 3,
  agencyId: 7,
  ownerUserId: 11,
  externalId: 'https://example.com',
  displayName: 'site',
  webhookSecret: 'sec',
  revokedAt: null,
}

type ClientHit = { id: number } | null
let byLeadSourceHits: ClientHit[] = []
let byPhone: ClientHit = null
let byEmail: ClientHit = null

vi.mock('@/config/db', () => {
  function query(table: string) {
    const state: { table: string; where: Record<string, unknown>; whereRaw: boolean } = {
      table,
      where: {},
      whereRaw: false,
    }
    const q: any = {
      select: () => q,
      where: (w: Record<string, unknown>) => {
        Object.assign(state.where, w)
        return q
      },
      whereRaw: () => {
        state.whereRaw = true
        return q
      },
      orderBy: () => q,
      first: async () => {
        if (state.table !== 'clients') return null
        if (state.where.leadSource != null) {
          const next = byLeadSourceHits.shift() ?? null
          return next
        }
        if (state.where.phone != null) return byPhone
        if (state.whereRaw) return byEmail
        return null
      },
      insert: () => ({
        onConflict: () => ({
          merge: async () => undefined,
        }),
      }),
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        try {
          if (state.table === 'automation_connections') resolve([CONNECTION])
          else resolve([])
        } catch (e) {
          reject?.(e)
        }
      },
    }
    return q
  }
  return { db: (table: string) => query(table) }
})

const { contactForm7Provider } = await import('@/lib/automations/connectors/contactForm7')

const mapped = {
  eventKey: 'form.submitted' as const,
  occurrenceKey: 'form:42:sub_new',
  occurredAt: new Date('2026-08-12T12:00:00.000Z'),
  fields: {
    formId: '42',
    formName: 'צור קשר',
    submissionId: 'sub_new',
    pageUrl: 'https://example.com/contact/',
    leadName: 'דנה לוי',
    message: 'שלום',
  },
  subject: { email: 'dana@example.com', phone: '0501234567' },
}

beforeEach(() => {
  insertLeadSystem.mockReset()
  emitAutomationEvent.mockReset()
  emitLeadCreated.mockReset()
  getQuotaStatus.mockReset()
  emitLeadCreated.mockResolvedValue({ enqueued: true, skipped: null })
  emitAutomationEvent.mockResolvedValue(undefined)
  getQuotaStatus.mockResolvedValue({ plan: 'grow', limit: null, used: 0 })
  byLeadSourceHits = []
  byPhone = null
  byEmail = null
})

describe('CF7 resolveSubject → emitLeadCreated', () => {
  it('emits lead.created via emitLeadCreated when insertLeadSystem creates a new lead', async () => {
    byLeadSourceHits = [null] // no prior submission
    insertLeadSystem.mockResolvedValue({
      id: 900,
      firstName: 'דנה',
      lastName: 'לוי',
      leadSource: 'contact_form_7:3:sub_new',
    })

    const leadId = await contactForm7Provider.resolveSubject!(7, mapped)

    expect(leadId).toBe(900)
    expect(insertLeadSystem).toHaveBeenCalledTimes(1)
    expect(insertLeadSystem.mock.calls[0][0]).toMatchObject({ createOrigin: 'cf7' })
    expect(emitAutomationEvent).toHaveBeenCalledTimes(1)
    expect(emitAutomationEvent.mock.calls[0][0]).toMatchObject({
      trigger: 'lead_created',
      origin: 'webhook',
      agencyId: 7,
      leadId: 900,
    })
    expect(emitLeadCreated).toHaveBeenCalledTimes(1)
    expect(emitLeadCreated.mock.calls[0][0]).toMatchObject({
      agencyId: 7,
      leadId: 900,
      actorUserId: null,
      origin: 'webhook',
      leadName: 'דנה לוי',
    })
  })

  it('does not emit when the submission leadSource already exists', async () => {
    byLeadSourceHits = [{ id: 50 }]

    const leadId = await contactForm7Provider.resolveSubject!(7, mapped)

    expect(leadId).toBe(50)
    expect(insertLeadSystem).not.toHaveBeenCalled()
    expect(emitAutomationEvent).not.toHaveBeenCalled()
    expect(emitLeadCreated).not.toHaveBeenCalled()
  })

  it('does not emit when an existing lead matches by phone', async () => {
    byLeadSourceHits = [null]
    byPhone = { id: 60 }

    const leadId = await contactForm7Provider.resolveSubject!(7, mapped)

    expect(leadId).toBe(60)
    expect(insertLeadSystem).not.toHaveBeenCalled()
    expect(emitLeadCreated).not.toHaveBeenCalled()
    expect(emitAutomationEvent).not.toHaveBeenCalled()
  })

  it('does not emit when insert fails and a concurrent row is adopted', async () => {
    byLeadSourceHits = [null, { id: 70 }] // miss, then concurrent adopt
    insertLeadSystem.mockResolvedValue(null)

    const leadId = await contactForm7Provider.resolveSubject!(7, mapped)

    expect(leadId).toBe(70)
    expect(emitAutomationEvent).not.toHaveBeenCalled()
    expect(emitLeadCreated).not.toHaveBeenCalled()
  })
})
