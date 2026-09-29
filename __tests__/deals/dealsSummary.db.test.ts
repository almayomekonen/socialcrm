/**
 * /deals summary cards vs. the table, against a REAL database.
 *
 * Both come from one path: getPermsAndFilter (the page's active filter) →
 * getDealTableData (the table's query, which also returns the cards' count and
 * revenue). For every filter we assert the cards describe exactly the rows the
 * table shows — count = rows, revenue = sum of those rows' amounts.
 *
 * DB-backed: run serialized via `npm run test:db`.
 */

import { vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), cacheTag: vi.fn(), unstable_cache: vi.fn((fn: unknown) => fn) }))
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(() => null), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(() => ({ get: vi.fn(() => null) })),
}))
vi.mock('@/db/auth', () => ({ getUser: vi.fn(), getCachedUser: vi.fn(), createCookie: vi.fn(), getUserByEmail: vi.fn(), decrypt: vi.fn(), encrypt: vi.fn(async () => 'signed') }))
vi.mock('@/db/agencies', () => ({ getAgencyId: vi.fn(), getAgencyById: vi.fn() }))

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '@/config/db'
import { getAgencyId } from '@/db/agencies'
import { getPermsAndFilter } from '@/db/filter'
import { getDealTableData } from '@/db/salesTbl'

let agencyId: number
let adminId: number
let repId: number
let admin: { id: number; agencyId: number; role: string; name: string }

// A date comfortably inside the current month, and one inside the previous month.
const now = new Date()
const thisMonth = new Date(now.getFullYear(), now.getMonth(), Math.min(now.getDate(), 15), 12)
const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 10, 12)

async function deal(userId: number, offrDt: Date | string, status: string, amount: number, clientId: number) {
  const [s] = await db('sales')
    .insert({
      status, action: 'מכירה', company: 'ללא ספק', branch: 'שירותים', prdct: 'SEO', prdctType: 'תשלום חד פעמי',
      offrDt, saleDt: offrDt, clientId, createdById: userId, handlerId: userId, amount, cmsn: amount, agencyId,
    })
    .returning('id')
  await db('sale_users').insert({ saleId: s.id ?? s, userId, prcnt: 100, amount, cmsn: amount })
}

/** Exactly what /deals does: the active filter → the table query (+ its card numbers). */
async function dealsPage(filter?: Record<string, unknown>) {
  const { sqlFilter, rawFilter } = await getPermsAndFilter({ user: admin as any, filter: filter ? JSON.stringify(filter) : undefined })
  const { tblData, count, revenue } = await getDealTableData(sqlFilter as any, { pageNum: 1, tableLimit: 100 })
  const tableSum = tblData.reduce((t: number, r: any) => t + Number(r.amount), 0)
  // The invariant this fix exists for: cards and table describe the same deals.
  expect(Number(count)).toBe(tblData.length)
  expect(revenue).toBe(tableSum)
  return { rows: tblData.length, revenue, amounts: tblData.map((r: any) => Number(r.amount)).sort((a: number, b: number) => a - b), rawFilter }
}

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: 'Deals Summary Agency' }).returning('id')
  agencyId = Number(a.id ?? a)
  const [u1] = await db('users').insert({ firstName: 'Admin', lastName: 'A', email: `ds-a-${Date.now()}@example.test`, agencyId, role: 'ADMIN' }).returning('id')
  const [u2] = await db('users').insert({ firstName: 'Rep', lastName: 'B', email: `ds-b-${Date.now()}@example.test`, agencyId, role: 'AGNT' }).returning('id')
  adminId = Number(u1.id ?? u1)
  repId = Number(u2.id ?? u2)
  admin = { id: adminId, agencyId, role: 'ADMIN', name: 'Admin A' }
  ;(getAgencyId as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(agencyId)

  const [c] = await db('clients').insert({ firstName: 'ליד', lastName: '', createdById: adminId, agencyId, lead: true }).returning('id')
  const clientId = Number(c.id ?? c)
  await deal(adminId, thisMonth, 'שולם', 1000, clientId)       // A
  await deal(repId, thisMonth, 'בהצעה', 300, clientId)         // B
  await deal(adminId, thisMonth, 'בוטל', 999, clientId)        // cancelled: hidden by the default status filter
  await deal(adminId, lastMonth, 'שולם', 500, clientId)        // C
  await deal(adminId, '2025-12-10', 'שולם', 1500, clientId)    // D (historical)
  await deal(repId, '2025-12-12', 'חדש', 200, clientId)        // E (historical)
})

afterAll(async () => {
  await db('sale_users').whereIn('saleId', db('sales').where({ agencyId }).select('id')).del()
  await db('sales').where({ agencyId }).del()
  await db('clients').where({ agencyId }).del()
  await db('users').where({ agencyId }).del()
  await db('agencies').where({ id: agencyId }).del()
  await db.destroy()
})

describe('/deals — summary cards follow the active filter', () => {
  it('default (admin → current month): cards = this month\'s table rows', async () => {
    const r = await dealsPage()
    expect(r.rawFilter.dateRange).toBe('החודש הנוכחי')
    expect(r).toMatchObject({ rows: 2, revenue: 1300, amounts: [300, 1000] })
  })

  it('all dates: historical deals are in the table AND in both cards', async () => {
    const r = await dealsPage({ dateRange: 'כל התאריכים' })
    expect(r).toMatchObject({ rows: 5, revenue: 3500, amounts: [200, 300, 500, 1000, 1500] })
  })

  it('a historical month (custom range): table and cards both use that month', async () => {
    const r = await dealsPage({ dateRange: 'מותאם אישית', start: '2025-12-01', end: '2025-12-31T23:59:59' })
    expect(r).toMatchObject({ rows: 2, revenue: 1700, amounts: [200, 1500] })
  })

  it('previous month preset: table and cards both use it', async () => {
    const r = await dealsPage({ dateRange: 'החודש הקודם' })
    expect(r).toMatchObject({ rows: 1, revenue: 500 })
  })

  it('non-date filters: status and salesperson narrow both', async () => {
    expect(await dealsPage({ dateRange: 'כל התאריכים', status: ['שולם'] })).toMatchObject({ rows: 3, revenue: 3000 })
    expect(await dealsPage({ dateRange: 'כל התאריכים', userIds: [repId] })).toMatchObject({ rows: 2, revenue: 500 })
  })

  it('combined filters: the same intersection for table and cards', async () => {
    const r = await dealsPage({ dateRange: 'מותאם אישית', start: '2025-12-01', end: '2025-12-31T23:59:59', userIds: [repId] })
    expect(r).toMatchObject({ rows: 1, revenue: 200, amounts: [200] })
  })

  it('an empty result: zero rows, zero count, ₪0', async () => {
    const r = await dealsPage({ dateRange: 'מותאם אישית', start: '2020-01-01', end: '2020-01-31' })
    expect(r).toMatchObject({ rows: 0, revenue: 0 })
  })
})
