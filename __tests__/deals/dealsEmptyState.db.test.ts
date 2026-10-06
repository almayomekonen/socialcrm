/**
 * /deals empty state against a REAL database: onboarding ("no deals yet") only
 * when the user's scope genuinely has no deals — never because the active (now
 * possibly remembered) filter matched nothing.
 *
 * Uses the page's own decision, isDealsSystemEmpty (table empty && no deal in scope).
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
import { getDealTableData, hasAnyDeals, isDealsSystemEmpty } from '@/db/salesTbl'

let emptyAgency: number
let busyAgency: number
const users: Record<string, { id: number; agencyId: number; role: string; name: string }> = {}

async function makeAgency(name: string) {
  const [a] = await db('agencies').insert({ name }).returning('id')
  return Number(a.id ?? a)
}
async function makeUser(agencyId: number, role: string, tag: string) {
  const [u] = await db('users').insert({ firstName: tag, lastName: 'T', email: `es-${tag}-${Date.now()}@example.test`, agencyId, role: role as any }).returning('id')
  return { id: Number(u.id ?? u), agencyId, role, name: tag }
}

/** Exactly what /deals computes for the given user + active filter. */
async function dealsPage(user: (typeof users)[string], filter?: Record<string, unknown>) {
  ;(getAgencyId as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(user.agencyId)
  const { sqlFilter, gotPermIds } = await getPermsAndFilter({ user: user as any, filter: filter ? JSON.stringify(filter) : undefined })
  const { tblData } = await getDealTableData(sqlFilter as any, { pageNum: 1, tableLimit: 100 })
  const isSystemEmpty = await isDealsSystemEmpty(tblData.length, user.agencyId, gotPermIds)
  return { rows: tblData.length, isSystemEmpty }
}

beforeAll(async () => {
  emptyAgency = await makeAgency('Empty Deals Agency')
  busyAgency = await makeAgency('Busy Deals Agency')
  users.emptyAdmin = await makeUser(emptyAgency, 'ADMIN', 'emptyAdmin')
  users.admin = await makeUser(busyAgency, 'ADMIN', 'admin')
  users.rep = await makeUser(busyAgency, 'AGNT', 'rep')

  const [c] = await db('clients').insert({ firstName: 'ליד', lastName: '', createdById: users.admin.id, agencyId: busyAgency, lead: true }).returning('id')
  const [s] = await db('sales')
    .insert({
      status: 'שולם', action: 'מכירה', company: 'ללא ספק', branch: 'שירותים', prdct: 'SEO', prdctType: 'תשלום חד פעמי',
      offrDt: '2025-12-10', saleDt: '2025-12-10', clientId: Number(c.id ?? c), createdById: users.admin.id, handlerId: users.admin.id,
      amount: 1500, cmsn: 1500, agencyId: busyAgency,
    })
    .returning('id')
  await db('sale_users').insert({ saleId: Number(s.id ?? s), userId: users.admin.id, prcnt: 100, amount: 1500, cmsn: 1500 })
})

afterAll(async () => {
  for (const a of [emptyAgency, busyAgency]) {
    await db('sale_users').whereIn('saleId', db('sales').where({ agencyId: a }).select('id')).del()
    await db('sales').where({ agencyId: a }).del()
    await db('clients').where({ agencyId: a }).del()
    await db('users').where({ agencyId: a }).del()
    await db('agencies').where({ id: a }).del()
  }
  await db.destroy()
})

describe('/deals onboarding vs filtered-zero', () => {
  it('a genuinely empty agency gets the onboarding empty state — with or without a filter', async () => {
    expect(await dealsPage(users.emptyAdmin)).toEqual({ rows: 0, isSystemEmpty: true })
    expect(await dealsPage(users.emptyAdmin, { dateRange: 'כל התאריכים' })).toEqual({ rows: 0, isSystemEmpty: true })
  })

  it('deals exist but the (default or remembered) filter matches none → filtered UI, NOT onboarding', async () => {
    // The only deal is from 12/2025, so the admin default (current month) matches nothing.
    expect(await dealsPage(users.admin)).toEqual({ rows: 0, isSystemEmpty: false })
    expect(await dealsPage(users.admin, { dateRange: 'מותאם אישית', start: '2020-01-01', end: '2020-01-31' })).toEqual({ rows: 0, isSystemEmpty: false })
  })

  it('the same deals with a matching filter show rows', async () => {
    expect(await dealsPage(users.admin, { dateRange: 'כל התאריכים' })).toEqual({ rows: 1, isSystemEmpty: false })
  })

  it('scope follows permissions: a rep with no permitted deals sees onboarding', async () => {
    // The agency's only deal belongs to the admin; the rep has no permission on it.
    expect(await dealsPage(users.rep, { dateRange: 'כל התאריכים' })).toEqual({ rows: 0, isSystemEmpty: true })
  })

  it('hasAnyDeals is agency-scoped', async () => {
    expect(await hasAnyDeals(emptyAgency, [])).toBe(false)
    expect(await hasAnyDeals(busyAgency, [])).toBe(true)
  })
})
