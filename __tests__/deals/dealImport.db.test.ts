/**
 * Deal (עסקאות) Excel import against a REAL database.
 *
 * Every write is the production server action; only Next.js infrastructure and
 * the session are mocked. The automation / notification emitters are wrapped in
 * pass-through spies so the test can prove the import never calls them.
 *
 * DB-backed: run serialized via `npm run test:db`.
 */

import { vi } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  cacheTag: vi.fn(),
  unstable_cache: vi.fn((fn: unknown) => fn),
}))
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(() => null), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(() => ({ get: vi.fn(() => null) })),
}))
vi.mock('next/server', () => ({ after: (fn: () => unknown) => fn() }))
vi.mock('@/lib/requireUser', () => {
  const ru = vi.fn()
  return { requireUser: ru, requireProductAccess: ru, requireBasicCrmAccess: ru }
})
vi.mock('@/db/auth', () => ({
  getUser: vi.fn(),
  getCachedUser: vi.fn(),
  createCookie: vi.fn(),
  getUserByEmail: vi.fn(),
  decrypt: vi.fn(),
  encrypt: vi.fn(async () => 'signed'),
}))
vi.mock('@/db/agencies', () => ({ getAgencyId: vi.fn(), getAgencyById: vi.fn() }))
vi.mock('@/lib/automations/statusChanged', async (orig) => {
  const m = await orig<typeof import('@/lib/automations/statusChanged')>()
  return { ...m, emitLeadStatusChanged: vi.fn(m.emitLeadStatusChanged) }
})
vi.mock('@/lib/automations/emit', async (orig) => {
  const m = await orig<typeof import('@/lib/automations/emit')>()
  return { ...m, emitAutomationEvent: vi.fn(m.emitAutomationEvent) }
})
/** Pass-through spy: the failure-path test makes it throw AFTER writing. */
vi.mock('@/components/sales/saleForm/funcs/insertSale', async (orig) => {
  const m = await orig<typeof import('@/components/sales/saleForm/funcs/insertSale')>()
  return { ...m, insertSaleUsers: vi.fn(m.insertSaleUsers) }
})
vi.mock('@/lib/notifications/emit', async (orig) => {
  const m = await orig<typeof import('@/lib/notifications/emit')>()
  return { ...m, notifyEvent: vi.fn(m.notifyEvent) }
})

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { db } from '@/config/db'
import { requireProductAccess } from '@/lib/requireUser'
import { getUser } from '@/db/auth'
import { getAgencyId } from '@/db/agencies'
import { importDeals } from '@/actions/dealImport'
import { mapDealImportRows } from '@/lib/deals/importMapping'
import { getEffectiveLeadPlan, FREE_LEAD_LIMIT } from '@/lib/quota'
import { getPerms } from '@/db/filter'
import { formatSqlFilter } from '@/components/filter/formatFilter'
import { getDealTableData } from '@/db/salesTbl'
import { emitLeadStatusChanged } from '@/lib/automations/statusChanged'
import { emitAutomationEvent } from '@/lib/automations/emit'
import { notifyEvent } from '@/lib/notifications/emit'
import { insertSaleUsers } from '@/components/sales/saleForm/funcs/insertSale'

let agencyId: number
let otherAgencyId: number
let repId: number
let otherRepId: number
const sessionFor = (id: number, agency: number) => ({ id, agencyId: agency, role: 'AGNT', email: `u${id}@example.test`, name: 'Rep' })

async function makeAgency(name: string) {
  const [a] = await db('agencies').insert({ name }).returning('id')
  return Number(a.id ?? a)
}
async function makeUser(agency: number, tag: string) {
  const [u] = await db('users')
    .insert({ firstName: tag, lastName: 'Rep', email: `${tag}-${Date.now()}@example.test`, agencyId: agency, role: 'AGNT' })
    .returning('id')
  return Number(u.id ?? u)
}
async function makeLead(agency: number, fields: Record<string, unknown>) {
  const [c] = await db('clients')
    .insert({ firstName: 'קיים', lastName: '', createdById: repId, userId: repId, agencyId: agency, lead: true, status: 'contacted', ...fields })
    .returning('id')
  return Number(c.id ?? c)
}
async function wipe(agency: number) {
  const saleIds = db('sales').where({ agencyId: agency }).select('id')
  await db('sale_users').whereIn('saleId', saleIds).del()
  await db('sales').where({ agencyId: agency }).del()
  await db('analytics_events').where({ agencyId: agency }).del()
  await db('clients').where({ agencyId: agency }).del()
}
/** Header + rows through the real mapper, then the real action. */
async function run(headers: unknown[], rows: unknown[][]) {
  const mapped = mapDealImportRows(headers, rows)
  expect(mapped.error).toBeUndefined()
  return importDeals(mapped.data)
}
const H = ['שם', 'טלפון', 'מייל', 'סכום', 'סטטוס', 'תאריך עסקה', 'שירות']

beforeAll(async () => {
  agencyId = await makeAgency('Deal Import Agency')
  otherAgencyId = await makeAgency('Other Agency')
  repId = await makeUser(agencyId, 'di')
  otherRepId = await makeUser(agencyId, 'di2')
  const session = sessionFor(repId, agencyId)
  ;(requireProductAccess as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(session)
  ;(getUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(session)
  ;(getAgencyId as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(agencyId)
})

afterAll(async () => {
  await wipe(agencyId)
  await wipe(otherAgencyId)
  await db('users').whereIn('agencyId', [agencyId, otherAgencyId]).del()
  await db('agencies').whereIn('id', [agencyId, otherAgencyId]).del()
  await db.destroy()
})

beforeEach(async () => {
  await wipe(agencyId)
  await wipe(otherAgencyId)
  vi.mocked(emitLeadStatusChanged).mockClear()
  vi.mocked(emitAutomationEvent).mockClear()
  vi.mocked(notifyEvent).mockClear()
  vi.mocked(insertSaleUsers).mockClear()
})

describe('importDeals — lead matching', () => {
  it('matches a lead stored as 05… from a sheet phone', async () => {
    const leadId = await makeLead(agencyId, { phone: '0541110005' })
    const res = await run(H, [['', '054-111-0005', '', 100, '', '', '']])
    expect(res).toMatchObject({ imported: 1, createdLeads: 0, rejected: [] })
    expect(await db('sales').where({ agencyId }).pluck('clientId')).toEqual([leadId])
  })

  it('matches a lead stored as 972… (the CSV importer format)', async () => {
    const leadId = await makeLead(agencyId, { phone: '972541110006' })
    const res = await run(H, [['', '0541110006', '', 100, '', '', '']])
    expect(res).toMatchObject({ imported: 1, createdLeads: 0 })
    expect(await db('sales').where({ agencyId }).pluck('clientId')).toEqual([leadId])
  })

  it('falls back to email, case-insensitively', async () => {
    const leadId = await makeLead(agencyId, { email: 'Dana@Example.com' })
    const res = await run(H, [['', '', 'dana@example.COM', 100, '', '', '']])
    expect(res).toMatchObject({ imported: 1, createdLeads: 0 })
    expect(await db('sales').where({ agencyId }).pluck('clientId')).toEqual([leadId])
  })

  it('never matches a lead of another agency', async () => {
    const foreign = await makeLead(otherAgencyId, { phone: '0541110007', email: 'x@example.com' })
    const res = await run(H, [['', '0541110007', 'x@example.com', 100, '', '', '']])
    expect(res).toMatchObject({ imported: 0, createdLeads: 0 })
    expect((res as any).rejected).toHaveLength(1)
    expect(await db('sales').where({ clientId: foreign })).toHaveLength(0)
    expect(await db('sales').where({ agencyId })).toHaveLength(0)
  })

  it('creates a missing lead from name + phone, through the import writer', async () => {
    const res = await run(H, [['נועה כהן', '0541110008', '', 250, 'שולם', '01/02/2026', 'SEO']])
    expect(res).toMatchObject({ imported: 1, createdLeads: 1, rejected: [] })
    const lead = await db('clients').where({ agencyId }).first()
    expect(lead).toMatchObject({ firstName: 'נועה', lastName: 'כהן', phone: '0541110008', status: 'new', lead: true, createOrigin: 'import', userId: repId, handlerId: repId, createdById: repId })
    // Lead + deal + sale_users persist together.
    const sales = await db('sales').where({ agencyId })
    expect(sales.map((s) => s.clientId)).toEqual([lead.id])
    expect(await db('sale_users').where({ saleId: sales[0].id })).toHaveLength(1)
    // The post-commit import signal addLeads would have emitted.
    const events = await db('analytics_events').where({ agencyId, event: 'leads_imported' })
    expect(events).toHaveLength(1)
    expect(events[0].props).toMatchObject({ count: 1, format: 'excel' })
  })

  it('rejects an unmatched row without enough identity to create a lead', async () => {
    const res = await run(H, [
      ['', '0541110009', '', 100, '', '', ''],
      ['דנה', '', 'nobody@example.com', 100, '', '', ''],
    ])
    expect(res).toMatchObject({ imported: 0, createdLeads: 0 })
    expect((res as any).rejected.map((r: any) => r.row)).toEqual([2, 3])
    expect(await db('clients').where({ agencyId })).toHaveLength(0)
  })

  it('respects the lead quota when a missing lead would exceed it', async () => {
    expect(await getEffectiveLeadPlan(agencyId)).toBe('free')
    await db('clients').insert(
      Array.from({ length: FREE_LEAD_LIMIT }, (_, i) => ({
        firstName: `L${i}`, lastName: '', createdById: repId, agencyId, lead: true, status: 'new', phone: `05200000${String(i).padStart(2, '0')}`,
      })),
    )
    const res = await run(H, [['חדש לגמרי', '0549999999', '', 100, '', '', '']])
    expect(res).toMatchObject({ error: 'quota_exceeded', limit: FREE_LEAD_LIMIT })
    expect(await db('clients').where({ agencyId, phone: '0549999999' })).toHaveLength(0)
    expect(await db('sales').where({ agencyId })).toHaveLength(0)
  })
})

describe('importDeals — atomicity', () => {
  it('a deal write that fails after a new lead was created leaves nothing behind', async () => {
    // Pre-existing agency data that must survive untouched.
    const existingLead = await makeLead(agencyId, { phone: '0541110020' })
    expect(await run(H, [['', '0541110020', '', 700, '', '2026-01-01', 'SEO']])).toMatchObject({ imported: 1 })
    const snapshot = async () => ({
      clients: await db('clients').where({ agencyId }).orderBy('id'),
      sales: await db('sales').where({ agencyId }).orderBy('id'),
      saleUsers: await db('sale_users').whereIn('saleId', db('sales').where({ agencyId }).select('id')).orderBy('saleId'),
    })
    const before = await snapshot()
    expect(before.clients).toHaveLength(1)
    expect(before.sales).toHaveLength(1)
    expect(before.saleUsers).toHaveLength(1)
    vi.mocked(emitLeadStatusChanged).mockClear()
    vi.mocked(emitAutomationEvent).mockClear()
    vi.mocked(notifyEvent).mockClear()
    vi.mocked(insertSaleUsers).mockClear()
    await db('analytics_events').where({ agencyId }).del()

    // Row 1 matches the existing lead; row 2 needs a NEW lead. The second
    // sale_users write really lands, then throws — i.e. the failure happens
    // after the new lead, both sales rows and a sale_users row were written.
    const real = (await vi.importActual<typeof import('@/components/sales/saleForm/funcs/insertSale')>(
      '@/components/sales/saleForm/funcs/insertSale'
    )).insertSaleUsers
    vi.mocked(insertSaleUsers)
      .mockImplementationOnce(real)
      .mockImplementationOnce(async (...args: Parameters<typeof real>) => {
        await real(...args)
        const [trx] = args
        // Prove the orphan-to-be really existed inside the transaction.
        expect(await trx('clients').where({ agencyId, phone: '0541110021' })).toHaveLength(1)
        throw new Error('simulated deal write failure')
      })

    const mapped = mapDealImportRows(H, [
      ['', '0541110020', '', 800, '', '2026-02-01', 'SEO'],
      ['ליד חדש', '0541110021', '', 900, 'שולם', '2026-02-02', 'SEO'],
    ])
    await expect(importDeals(mapped.data)).rejects.toThrow('simulated deal write failure')
    expect(insertSaleUsers).toHaveBeenCalledTimes(2)

    // The new lead did not survive, and no sales / sale_users rows remain.
    expect(await db('clients').where({ phone: '0541110021' })).toHaveLength(0)
    // Pre-existing data is byte-for-byte unchanged.
    expect(await snapshot()).toEqual(before)
    expect((await db('clients').where({ id: existingLead }).first()).status).toBe('contacted')
    // No automation, notification, job or import event.
    expect(emitLeadStatusChanged).not.toHaveBeenCalled()
    expect(emitAutomationEvent).not.toHaveBeenCalled()
    expect(notifyEvent).not.toHaveBeenCalled()
    expect(await db('automation_jobs').where({ agencyId })).toHaveLength(0)
    expect(await db('analytics_events').where({ agencyId })).toHaveLength(0)
  })
})

describe('importDeals — duplicates', () => {
  it('skips a duplicate row inside the same file', async () => {
    await makeLead(agencyId, { phone: '0541110010' })
    const row = ['', '0541110010', '', 300, '', '2026-01-10', 'SEO']
    const res = await run(H, [row, row])
    expect(res).toMatchObject({ imported: 1, duplicates: 1 })
    expect(await db('sales').where({ agencyId })).toHaveLength(1)
  })

  it('does not re-import a deal the agency already has', async () => {
    await makeLead(agencyId, { phone: '0541110011' })
    const rows = [['', '0541110011', '', 300, '', '2026-01-10', 'SEO']]
    expect(await run(H, rows)).toMatchObject({ imported: 1, duplicates: 0 })
    expect(await run(H, rows)).toMatchObject({ imported: 0, duplicates: 1 })
    // A different amount on the same lead is a different deal.
    expect(await run(H, [['', '0541110011', '', 301, '', '2026-01-10', 'SEO']])).toMatchObject({ imported: 1 })
    expect(await db('sales').where({ agencyId })).toHaveLength(2)
  })
})

describe('importDeals — rows written', () => {
  it('writes sales with the form defaults and a sale_users row for the importer', async () => {
    const leadId = await makeLead(agencyId, { phone: '0541110012' })
    await run(H, [['', '0541110012', '', 1200, 'סגור', '15/03/2026', 'בניית אתר']])
    const sale = await db('sales').where({ agencyId }).first()
    expect(sale).toMatchObject({
      clientId: leadId,
      amount: 1200,
      status: 'שולם',
      prdct: 'בניית אתר',
      company: 'ללא ספק',
      branch: 'שירותים',
      action: 'מכירה',
      prdctType: 'תשלום חד פעמי',
      createdById: repId,
      handlerId: repId,
    })
    expect(Number(sale.tfuca)).toBe(1200)
    const [day] = (await db.raw(`SELECT to_char("saleDt", 'YYYY-MM-DD') AS d FROM sales WHERE id = ?`, [sale.id])).rows
    expect(day.d).toBe('2026-03-15')
    const su = await db('sale_users').where({ saleId: sale.id })
    expect(su).toHaveLength(1)
    expect(su[0]).toMatchObject({ userId: repId, prcnt: 100, amount: 1200 })
  })

  it('is visible to the importing rep under the real permission filter, and not to an unrelated rep', async () => {
    await makeLead(agencyId, { phone: '0541110013' })
    await run(H, [['', '0541110013', '', 500, '', '', '']])

    async function visibleTo(id: number) {
      const user = sessionFor(id, agencyId)
      const { gotPermIds } = await getPerms(user)
      const sqlFilter = await formatSqlFilter({ user: user as any, filter: {}, gotPermIds })
      const { tblData } = await getDealTableData(sqlFilter as any, { pageNum: 1, tableLimit: 100 })
      return tblData
    }
    expect(await visibleTo(repId)).toHaveLength(1)
    expect(await visibleTo(otherRepId)).toHaveLength(0)
  })
})

describe('importDeals — no live-deal side effects', () => {
  it('leaves the lead status unchanged, even for a paid deal', async () => {
    const leadId = await makeLead(agencyId, { phone: '0541110014', status: 'contacted' })
    const before = await db('clients').where({ id: leadId }).first()
    await run(H, [['', '0541110014', '', 900, 'שולם', '', '']])
    const after = await db('clients').where({ id: leadId }).first()
    expect(after.status).toBe('contacted')
    expect(after.lead).toBe(true)
    expect(after.statusChangedAt).toEqual(before.statusChangedAt)
  })

  it('fires no automation or notification, and queues no automation job', async () => {
    await makeLead(agencyId, { phone: '0541110015' })
    await run(H, [
      ['', '0541110015', '', 900, 'שולם', '', ''],
      ['ליד חדש', '0541110016', '', 400, 'שולם', '', ''],
    ])
    expect(emitLeadStatusChanged).not.toHaveBeenCalled()
    expect(emitAutomationEvent).not.toHaveBeenCalled()
    expect(notifyEvent).not.toHaveBeenCalled()
    expect(await db('automation_jobs').where({ agencyId })).toHaveLength(0)
    expect(await db('sales').where({ agencyId })).toHaveLength(2)
  })
})
