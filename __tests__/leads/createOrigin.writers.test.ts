/**
 * createOrigin writer runtime — upsertLead / addLeads insert+update contracts.
 * DB-free (VITEST_NO_DB=1 safe).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireProductAccess = vi.fn()
const getUser = vi.fn()
const getAgencyId = vi.fn()
const assertLeadQuota = vi.fn()
const withAgencyQuotaLock = vi.fn()
const emitAutomationEvent = vi.fn()
const emitLeadCreated = vi.fn()
const revalidatePath = vi.fn()

let lastInsert: Record<string, unknown> | null = null
let lastUpdate: Record<string, unknown> | null = null
let lastBulkInsert: Record<string, unknown>[] | null = null

vi.mock('@/lib/requireUser', () => ({
  requireProductAccess: (...args: unknown[]) => requireProductAccess(...args),
}))

vi.mock('@/db/auth', () => ({
  getUser: (...args: unknown[]) => getUser(...args),
}))

vi.mock('@/db/agencies', () => ({
  getAgencyId: (...args: unknown[]) => getAgencyId(...args),
}))

vi.mock('@/lib/quota', () => ({
  assertLeadQuota: (...args: unknown[]) => assertLeadQuota(...args),
  withAgencyQuotaLock: (...args: unknown[]) => withAgencyQuotaLock(...args),
  QuotaExceededError: class QuotaExceededError extends Error {
    current: number
    limit: number
    attempted: number
    constructor(current: number, limit: number, attempted: number) {
      super('quota')
      this.current = current
      this.limit = limit
      this.attempted = attempted
    }
  },
  getEffectiveLeadPlan: vi.fn(),
}))

vi.mock('@/lib/automations/emit', () => ({
  emitAutomationEvent: (...args: unknown[]) => emitAutomationEvent(...args),
}))

vi.mock('@/lib/notifications/emitLeadCreated', () => ({
  emitLeadCreated: (...args: unknown[]) => emitLeadCreated(...args),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}))

vi.mock('@/config/db', () => {
  const db: any = (table: string) => {
    if (table !== 'clients') throw new Error(`unexpected table ${table}`)
    return {
      where: () => ({
        first: async () => ({ lead: true }),
        update: (payload: Record<string, unknown>) => {
          lastUpdate = payload
          return {
            returning: async () => [{ id: 5, ...payload }],
          }
        },
      }),
      select: () => ({
        whereIn: async () => [],
      }),
      insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        if (Array.isArray(rows)) {
          lastBulkInsert = rows
          return Promise.resolve(rows.length)
        }
        lastInsert = rows
        return {
          returning: async () => [{ id: 1, lead: true, ...rows }],
        }
      },
    }
  }
  return { db }
})

const { upsertLead, addLeads } = await import('@/actions/clients')

beforeEach(() => {
  lastInsert = null
  lastUpdate = null
  lastBulkInsert = null
  requireProductAccess.mockReset()
  getUser.mockReset()
  getAgencyId.mockReset()
  assertLeadQuota.mockReset()
  withAgencyQuotaLock.mockReset()
  emitAutomationEvent.mockReset()
  emitLeadCreated.mockReset()
  revalidatePath.mockReset()

  requireProductAccess.mockResolvedValue({ id: 10, agencyId: 7, role: 'ADMIN' })
  getUser.mockResolvedValue({ id: 10 })
  getAgencyId.mockResolvedValue(7)
  assertLeadQuota.mockResolvedValue(undefined)
  emitAutomationEvent.mockResolvedValue(undefined)
  emitLeadCreated.mockResolvedValue({ enqueued: true, skipped: null })
  withAgencyQuotaLock.mockImplementation(async (_agencyId: number, fn: (trx: any) => Promise<unknown>) => {
    const trx: any = (table: string) => {
      if (table !== 'clients') throw new Error(`unexpected table ${table}`)
      return {
        insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
          if (Array.isArray(rows)) {
            lastBulkInsert = rows
            return Promise.resolve(rows.length)
          }
          lastInsert = rows
          return {
            returning: async () => [{ id: 1, lead: true, leadSource: rows.leadSource ?? null, ...rows }],
          }
        },
      }
    }
    return fn(trx)
  })
})

describe('upsertLead createOrigin', () => {
  it('manual create writes createOrigin=manual (CSV-spoofed createOrigin ignored)', async () => {
    await upsertLead(10, { firstName: 'דני', createOrigin: 'facebook', lead: true }, null, false, 'manual')
    expect(lastInsert).toMatchObject({ firstName: 'דני', createOrigin: 'manual' })
    expect(lastInsert).not.toHaveProperty('createOrigin', 'facebook')
  })

  it('CSV import path writes createOrigin=import', async () => {
    await upsertLead(10, { firstName: 'יובל', lead: true }, null, false, 'import')
    expect(lastInsert).toMatchObject({ createOrigin: 'import' })
  })

  it('UPDATE cannot change createOrigin even if payload tries', async () => {
    await upsertLead(
      10,
      { firstName: 'עודכן', createOrigin: 'import', status: 'contacted' },
      5,
      false,
      'manual',
    )
    expect(lastUpdate).toBeTruthy()
    expect(lastUpdate).not.toHaveProperty('createOrigin')
    expect(lastUpdate).toMatchObject({ firstName: 'עודכן', status: 'contacted' })
  })
})

describe('addLeads createOrigin (Excel import)', () => {
  it('forces createOrigin=import on every row', async () => {
    const res = await addLeads([
      { firstName: 'א', idNum: '100000001', createOrigin: 'manual' },
      { firstName: 'ב', idNum: '100000002' },
    ])
    expect(res).toEqual({ success: true, inserted: 2 })
    expect(lastBulkInsert).toHaveLength(2)
    expect(lastBulkInsert![0]).toMatchObject({ createOrigin: 'import', firstName: 'א' })
    expect(lastBulkInsert![1]).toMatchObject({ createOrigin: 'import', firstName: 'ב' })
  })
})
