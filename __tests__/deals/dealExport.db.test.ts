/**
 * Deals export against a REAL (local test) database: the rows the export builds
 * on the server are exactly the table's rows for the same filter, unpaged, and
 * agency and rep scope come from the session — never from the filter.
 *
 * DB-backed: run serialized via `npm run test:db`.
 */
import { vi } from 'vitest'

const { requireProductAccess } = vi.hoisted(() => ({ requireProductAccess: vi.fn() }))

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
vi.mock('@/db/auth', () => ({ getUser: vi.fn(), getCachedUser: vi.fn(), createCookie: vi.fn(), getUserByEmail: vi.fn() }))
vi.mock('@/db/agencies', () => ({ getAgencyId: vi.fn(), getAgencyById: vi.fn() }))
vi.mock('@/lib/requireUser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/requireUser')>()),
  requireProductAccess,
}))

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '@/config/db'
import { getAgencyId } from '@/db/agencies'
import { getPermsAndFilter } from '@/db/filter'
import { getDealTableData } from '@/db/salesTbl'
import { getDealDataToExport } from '@/actions/salesTbl'
import { Roles } from '@/types/roles'

type U = { id: number; agencyId: number; role: Roles; name: string }
let agencyA: number
let agencyB: number
let adminA: U
let rep1: U
let rep2: U
let adminB: U
let clientA: number
let clientB: number

const now = new Date()
const thisMonth = new Date(now.getFullYear(), now.getMonth(), Math.min(now.getDate(), 15), 12)

async function deal(agencyId: number, userId: number, amount: number, clientId: number) {
  const [s] = await db('sales')
    .insert({
      status: 'שולם',
      action: 'מכירה',
      company: 'ללא ספק',
      branch: 'שירותים',
      prdct: 'SEO',
      prdctType: 'תשלום חד פעמי',
      offrDt: thisMonth,
      saleDt: thisMonth,
      clientId,
      createdById: userId,
      handlerId: userId,
      amount,
      cmsn: amount,
      agencyId,
    })
    .returning('id')
  await db('sale_users').insert({ saleId: s.id ?? s, userId, prcnt: 100, amount, cmsn: amount })
}

async function user(agencyId: number, role: Roles, name: string): Promise<U> {
  const [u] = await db('users')
    .insert({ firstName: name, lastName: 'x', email: `dx-${name}-${Date.now()}-${Math.random()}@example.test`, agencyId, role })
    .returning('id')
  return { id: Number(u.id ?? u), agencyId, role, name }
}

/** The export as the browser triggers it, for `session` — and the amounts it returned. */
async function exportAs(session: U, filter?: Record<string, unknown>) {
  requireProductAccess.mockResolvedValue(session)
  ;(getAgencyId as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(session.agencyId)
  const rows = await getDealDataToExport(filter ? JSON.stringify(filter) : null)
  return rows.map((r: any) => Number(r.amount)).sort((a: number, b: number) => a - b)
}

/** What the table shows for the same session and filter, unpaged. */
async function tableAs(session: U, filter?: Record<string, unknown>) {
  ;(getAgencyId as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(session.agencyId)
  const { sqlFilter } = await getPermsAndFilter({ user: session as any, filter: filter ? JSON.stringify(filter) : undefined })
  const { tblData } = await getDealTableData(sqlFilter as any, { pageNum: 1, tableLimit: 10_000 })
  return tblData.map((r: any) => Number(r.amount)).sort((a: number, b: number) => a - b)
}

beforeAll(async () => {
  for (const name of ['Export A', 'Export B']) {
    const [a] = await db('agencies').insert({ name }).returning('id')
    if (name === 'Export A') agencyA = Number(a.id ?? a)
    else agencyB = Number(a.id ?? a)
  }
  adminA = await user(agencyA, Roles.ADMIN, 'adminA')
  rep1 = await user(agencyA, Roles.AGNT, 'rep1')
  rep2 = await user(agencyA, Roles.AGNT, 'rep2')
  adminB = await user(agencyB, Roles.ADMIN, 'adminB')

  const [ca] = await db('clients')
    .insert({ firstName: 'ליד', lastName: 'A', createdById: adminA.id, agencyId: agencyA, lead: true })
    .returning('id')
  const [cb] = await db('clients')
    .insert({ firstName: 'ליד', lastName: 'B', createdById: adminB.id, agencyId: agencyB, lead: true })
    .returning('id')
  clientA = Number(ca.id ?? ca)
  clientB = Number(cb.id ?? cb)

  await deal(agencyA, adminA.id, 1000, clientA)
  await deal(agencyA, rep1.id, 300, clientA)
  await deal(agencyA, rep2.id, 200, clientA)
  await deal(agencyB, adminB.id, 777, clientB)
})

afterAll(async () => {
  for (const agencyId of [agencyA, agencyB]) {
    await db('sale_users').whereIn('saleId', db('sales').where({ agencyId }).select('id')).del()
    await db('sales').where({ agencyId }).del()
    await db('clients').where({ agencyId }).del()
    await db('users').where({ agencyId }).del()
    await db('agencies').where({ id: agencyId }).del()
  }
  await db.destroy()
})

describe('deals export — rebuilt on the server, scoped by the session', () => {
  it('admin, default filter: every deal of the agency, equal to the table', async () => {
    expect(await exportAs(adminA)).toEqual([200, 300, 1000])
    expect(await exportAs(adminA)).toEqual(await tableAs(adminA))
  })

  it('supported filters behave as in the table (status, rep, all dates)', async () => {
    for (const f of [{ status: ['שולם'] }, { userIds: [rep1.id] }, { dateRange: 'כל התאריכים' }, { status: ['בהצעה'] }]) {
      expect(await exportAs(adminA, f)).toEqual(await tableAs(adminA, f))
    }
    expect(await exportAs(adminA, { userIds: [rep1.id] })).toEqual([300])
    expect(await exportAs(adminA, { status: ['בהצעה'] })).toEqual([])
  })

  it('cross-agency: naming the other agency’s lead or rep returns nothing from it', async () => {
    expect(await exportAs(adminA, { clientIds: [clientB] })).toEqual([])
    expect(await exportAs(adminA, { userIds: [adminB.id] })).toEqual([])
    expect(await exportAs(adminB)).toEqual([777])
  })

  it('a rep exports only their own deals', async () => {
    expect(await exportAs(rep1)).toEqual([300])
  })

  it('cross-user: a rep naming a rep they have no permission for still gets only their own scope', async () => {
    expect(await exportAs(rep1, { userIds: [rep2.id] })).toEqual([300])
    expect(await exportAs(rep1, { userIds: [rep2.id] })).toEqual(await tableAs(rep1, { userIds: [rep2.id] }))
  })

  it('invalid input is refused and returns no rows', async () => {
    requireProductAccess.mockResolvedValue(adminA)
    await expect(getDealDataToExport('SELECT * FROM sales')).rejects.toThrow('Invalid export request')
    await expect(getDealDataToExport({ sql: 'SELECT * FROM sales', bindings: [] })).rejects.toThrow('Invalid export request')
  })
})
