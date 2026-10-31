/**
 * get_revenue's reader against a REAL database, side by side with the
 * Performance screen's own path.
 *
 * Performance (/sum_sales) is `getPermsAndFilter` → `getSaleStats` (AllNumbox).
 * For every role and every period below, the Agent's reader must return the same
 * paid revenue, paid-deal count and pipeline value as that path on the same rows
 * — including Performance's existing boundary behaviour, which is pinned here as
 * found, not corrected.
 *
 * The Performance side needs a web session for an admin (`getPerms` →
 * `getAgencyId()`), so `getAgencyId` is mocked for it — and asserted NEVER called
 * by the Agent's reader, which also runs with `getUser()` returning null.
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
vi.mock('@/db/auth', () => ({
  getUser: vi.fn(async () => null),
  getCachedUser: vi.fn(),
  createCookie: vi.fn(),
  getUserByEmail: vi.fn(),
  decrypt: vi.fn(),
  encrypt: vi.fn(async () => 'signed'),
}))
vi.mock('@/db/agencies', () => ({ getAgencyId: vi.fn(), getAgencyById: vi.fn() }))

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { db } from '@/config/db'
import { getAgencyId } from '@/db/agencies'
import { getUser } from '@/db/auth'
import { getPermsAndFilter } from '@/db/filter'
import { getSaleStats } from '@/db/sumSales'
import { getRevenueTotals, revenueWindow, type RevenuePeriod } from '@/db/agentRevenue'
import { readerScope } from '@/lib/agent/tools/readerScope'
import type { AgentScope } from '@/lib/agent/types'

const agencyIdMock = getAgencyId as unknown as ReturnType<typeof vi.fn>

/** Mid-June 2026, local time: "this month" = June, "last month" = May. */
const NOW = new Date(2026, 5, 15, 12, 0, 0)

type U = { id: number; agencyId: number; role: string; name: string }
let A: number
let B: number
let admin: U, repX: U, repY: U, mngr: U, office: U, adminB: U
const uniq = `${Date.now()}`

async function user(agencyId: number, role: string, first: string): Promise<U> {
  const [r] = await db('users')
    .insert({ firstName: first, lastName: 'T', email: `rev-${first}-${uniq}@example.test`, agencyId, role: role as never })
    .returning('id')
  return { id: Number(r.id ?? r), agencyId, role, name: `${first} T` }
}

async function deal(
  agencyId: number,
  userId: number,
  clientId: number,
  offrDt: Date | string,
  status: string,
  amount: number,
  action = 'מכירה',
) {
  const [s] = await db('sales')
    .insert({
      status,
      action,
      company: 'ללא ספק',
      branch: 'שירותים',
      prdct: 'SEO',
      prdctType: 'תשלום חד פעמי',
      offrDt,
      saleDt: offrDt,
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

async function lead(agencyId: number, createdById: number): Promise<number> {
  const [c] = await db('clients').insert({ firstName: 'ליד', lastName: '', createdById, agencyId, lead: true }).returning('id')
  return Number(c.id ?? c)
}

const PERFORMANCE_LABEL: Record<Exclude<RevenuePeriod, 'custom'>, string> = {
  this_month: 'החודש הנוכחי',
  last_month: 'החודש הקודם',
  this_year: 'השנה הנוכחית',
  last_year: 'השנה הקודמת',
}

/** Exactly what /sum_sales does for its boxes. */
async function performance(u: U, filter: Record<string, unknown>) {
  agencyIdMock.mockResolvedValue(u.agencyId)
  const { sqlFilter } = await getPermsAndFilter({ user: u as any, filter: JSON.stringify(filter) })
  const s = await getSaleStats(sqlFilter as any)
  return { paidRevenue: Number(s.totalRevenue), paidDeals: Number(s.hofakCount), pipelineValue: Number(s.pipelineValue) }
}

/** The Agent's side: the scope as resolveAgentScope / the WhatsApp identity build it, no session. */
async function agent(u: U, period: RevenuePeriod, range?: { from: string; to: string }) {
  const { getPerms } = await import('@/db/filter')
  const gotPermIds = u.role === 'ADMIN' || u.role === 'GM' ? [] : (await getPerms(u as any)).gotPermIds
  const scope: AgentScope = {
    agencyId: u.agencyId,
    userId: u.id,
    role: u.role as AgentScope['role'],
    gotPermIds,
    plan: 'pro',
    firstName: 'T',
  }
  const w = revenueWindow(period, new Date(), range)
  if (!w) throw new Error('no window')
  agencyIdMock.mockReset()
  agencyIdMock.mockRejectedValue(new Error('no session on this path'))
  ;(getUser as unknown as ReturnType<typeof vi.fn>).mockClear()
  const t = await getRevenueTotals(readerScope(scope), w)
  expect(agencyIdMock, 'the Agent reader must not resolve the agency from a session').not.toHaveBeenCalled()
  expect(getUser, 'the Agent reader must not read a session').not.toHaveBeenCalled()
  return t
}

const pick = (t: { paidRevenue: number; paidDeals: number; pipelineValue: number }) => ({
  paidRevenue: t.paidRevenue,
  paidDeals: t.paidDeals,
  pipelineValue: t.pipelineValue,
})

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  const [a] = await db('agencies')
    .insert({ name: `Revenue A ${uniq}` })
    .returning('id')
  const [b] = await db('agencies')
    .insert({ name: `Revenue B ${uniq}` })
    .returning('id')
  A = Number(a.id ?? a)
  B = Number(b.id ?? b)
  admin = await user(A, 'ADMIN', 'admin')
  repX = await user(A, 'AGNT', 'repx')
  repY = await user(A, 'AGNT', 'repy')
  mngr = await user(A, 'MNGR', 'mngr')
  office = await user(A, 'OFFICE', 'office')
  adminB = await user(B, 'ADMIN', 'adminb')

  // repX gave repY access; mngr manages a team with repX in it.
  await db('user_perms').insert({ gaveId: repX.id, gotId: repY.id })
  const [t] = await db('teams')
    .insert({ name: `Rev team ${uniq}`, agencyId: A })
    .returning('id')
  const teamId = Number(t.id ?? t)
  await db('user_teams').insert([
    { userId: mngr.id, teamId, type: 'mngr' },
    { userId: repX.id, teamId, type: 'user' },
  ])

  const ca = await lead(A, admin.id)
  const cb = await lead(B, adminB.id)
  // June 2026 (this month)
  await deal(A, repX.id, ca, new Date(2026, 5, 3), 'שולם', 1000)
  await deal(A, repX.id, ca, new Date(2026, 5, 30, 15), 'שולם', 250) // after "this year"'s end (tomorrow 00:00)
  await deal(A, repX.id, ca, new Date(2026, 5, 10), 'בהצעה', 400)
  await deal(A, repX.id, ca, new Date(2026, 5, 11), 'במו"מ', 300)
  await deal(A, repX.id, ca, new Date(2026, 5, 12), 'ממתין לתשלום', 200)
  await deal(A, repX.id, ca, new Date(2026, 5, 5), 'חדש', 100)
  await deal(A, repX.id, ca, new Date(2026, 5, 6), 'בוטל', 999) // never counted
  await deal(A, repX.id, ca, new Date(2026, 5, 7), 'נגנז', 888) // never counted
  await deal(A, repX.id, ca, new Date(2026, 5, 8), 'שולם', 777, 'החזר') // not a sale
  await deal(A, repY.id, ca, new Date(2026, 5, 12), 'שולם', 500)
  await deal(A, admin.id, ca, new Date(2026, 6, 10), 'שולם', 700) // July: inside Performance's "this month" (ends Jul 16)
  // May 2026 (last month): Performance's end is May 31 00:00
  await deal(A, admin.id, ca, new Date(2026, 4, 31), 'שולם', 2000)
  await deal(A, admin.id, ca, new Date(2026, 4, 31, 15), 'שולם', 3000) // excluded by Performance's last-month end
  // 2026 start, and 2025 (last year): Performance's end is Dec 31 00:00
  await deal(A, admin.id, ca, new Date(2026, 0, 1), 'שולם', 600)
  await deal(A, admin.id, ca, new Date(2025, 11, 31), 'שולם', 4000)
  await deal(A, admin.id, ca, new Date(2025, 11, 31, 18), 'שולם', 5000) // excluded by Performance's last-year end
  // Another agency, same month
  await deal(B, adminB.id, cb, new Date(2026, 5, 12), 'שולם', 99999)
})

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ
})
const ORIGINAL_TZ = process.env.TZ

afterAll(async () => {
  vi.useRealTimers()
  const ids = [admin, repX, repY, mngr, office, adminB].map((u) => u.id)
  const sales = await db('sales').whereIn('agencyId', [A, B]).pluck('id')
  await db('sale_users').whereIn('saleId', sales).del()
  await db('sales').whereIn('id', sales).del()
  await db('clients').whereIn('agencyId', [A, B]).del()
  await db('user_teams').whereIn('userId', ids).del()
  await db('user_perms').whereIn('gaveId', ids).del()
  await db('teams').whereIn('agencyId', [A, B]).del()
  await db('users').whereIn('id', ids).del()
  await db('agencies').whereIn('id', [A, B]).del()
})

describe('get_revenue reader = the Performance screen, for every role and period', () => {
  const roles = () => [admin, repX, repY, mngr, office, adminB]
  const periods: RevenuePeriod[] = ['this_month', 'last_month', 'this_year', 'last_year']

  it.each(periods)('%s: same paid revenue, paid deals and pipeline for every role', async (period) => {
    for (const u of roles()) {
      const screen = await performance(u, { dateRange: PERFORMANCE_LABEL[period as Exclude<RevenuePeriod, 'custom'>] })
      expect(pick(await agent(u, period)), `${u.name} ${period}`).toEqual(screen)
    }
  })

  it.each([
    ['2026-06-01', '2026-06-30'],
    ['2026-05-31', '2026-05-31'],
    ['2025-01-01', '2026-12-31'],
  ])("custom %s → %s: same as Performance's custom range for every role", async (from, to) => {
    for (const u of roles()) {
      const screen = await performance(u, { dateRange: 'מותאם אישית', start: from, end: to })
      expect(pick(await agent(u, 'custom', { from, to })), `${u.name} ${from}..${to}`).toEqual(screen)
    }
  })
})

describe('the definitions, pinned on known rows', () => {
  it('this month (admin): paid = שולם sales only; pipeline = open statuses; cancelled, archived and non-sale rows never count', async () => {
    expect(pick(await agent(admin, 'this_month'))).toEqual({
      paidRevenue: 1000 + 250 + 500 + 700,
      paidDeals: 4,
      pipelineValue: 400 + 300 + 200 + 100,
    })
  })

  it('paid revenue and pipeline are separate numbers, never summed', async () => {
    const t = await agent(admin, 'this_month')
    expect(t.paidRevenue).toBe(2450)
    expect(t.pipelineValue).toBe(1000)
    expect(t.dealsInPeriod).toBe(8) // 4 paid + 4 open shares; cancelled / archived / refund excluded
  })

  it('reports "no deals recorded" separately from "nothing in this period"', async () => {
    const t = await agent(admin, 'custom', { from: '2020-01-01', to: '2020-12-31' })
    expect(t).toMatchObject({ paidRevenue: 0, dealsInPeriod: 0 })
    expect(t.dealsEver).toBeGreaterThan(0)
  })
})

describe('agency isolation', () => {
  it("agency A never sees agency B's deals, and B sees only its own", async () => {
    expect((await agent(admin, 'this_month')).paidRevenue).toBe(2450)
    expect(pick(await agent(adminB, 'this_month'))).toEqual({ paidRevenue: 99999, paidDeals: 1, pipelineValue: 0 })
  })

  it("a scope naming agency B with agency A's reps sees nothing of either", async () => {
    const t = await getRevenueTotals(
      { user: { role: 'AGNT' as never }, gotPermIds: [repX.id], agencyId: B },
      revenueWindow('this_month', new Date())!,
    )
    expect(pick(t)).toEqual({ paidRevenue: 0, paidDeals: 0, pipelineValue: 0 })
  })
})

describe("representative-level permissions (Performance's gotPermIds)", () => {
  it('a rep sees only their own deals', async () => {
    expect(pick(await agent(repX, 'this_month'))).toEqual({ paidRevenue: 1250, paidDeals: 2, pipelineValue: 1000 })
  })
  it("a rep granted another rep's data sees both", async () => {
    expect(pick(await agent(repY, 'this_month'))).toEqual({ paidRevenue: 1250 + 500, paidDeals: 3, pipelineValue: 1000 })
  })
  it('a manager sees their team', async () => {
    expect(pick(await agent(mngr, 'this_month'))).toEqual({ paidRevenue: 1250, paidDeals: 2, pipelineValue: 1000 })
  })
  it('a user with no grants (the [0] sentinel) sees nothing', async () => {
    expect(pick(await agent(office, 'this_month'))).toEqual({ paidRevenue: 0, paidDeals: 0, pipelineValue: 0 })
  })
  it('an empty permission list for a non-admin fails closed, never widens to the agency', async () => {
    const t = await getRevenueTotals(
      { user: { role: 'AGNT' as never }, gotPermIds: [], agencyId: A },
      revenueWindow('this_month', new Date())!,
    )
    expect(t.paidRevenue).toBe(0)
  })
  it('a role Performance has no view for gets no numbers at all', async () => {
    await expect(
      getRevenueTotals(
        { user: { role: 'EXT' as never }, gotPermIds: [repX.id], agencyId: A },
        revenueWindow('this_month', new Date())!,
      ),
    ).rejects.toThrow(/no Performance view/)
  })
})

describe("date boundaries — Performance's existing behaviour, reproduced", () => {
  it('last month ends at 00:00 of its last day: a deal at 00:00 counts, one later that day does not', async () => {
    expect((await agent(admin, 'last_month')).paidRevenue).toBe(2000)
  })
  it('last year ends at 00:00 on Dec 31: same exclusion', async () => {
    expect((await agent(admin, 'last_year')).paidRevenue).toBe(4000)
  })
  it('this year ends at tomorrow 00:00: later-dated deals this year are not counted', async () => {
    // 1000 (Jun 3) + 500 (Jun 12) + 2000 + 3000 (May 31) + 600 (Jan 1); Jun 30 and Jul 10 are after the end.
    expect((await agent(admin, 'this_year')).paidRevenue).toBe(7100)
  })
  it("this month runs to next month's same day + 1: a July-dated deal counts in June", async () => {
    expect(revenueWindow('this_month', new Date())).toEqual({ start: new Date(2026, 5, 1), end: new Date(2026, 6, 16) })
  })
  it("a custom range's end day is included only at 00:00, as Performance's date inputs send it", async () => {
    expect((await agent(admin, 'custom', { from: '2026-05-31', to: '2026-05-31' })).paidRevenue).toBe(2000)
  })

  it.each(['UTC', 'Asia/Jerusalem'])(
    "process timezone %s: the window is the server's local wall clock, identical on both sides",
    async (tz) => {
      process.env.TZ = tz
      // 2026-06-30 22:30 UTC is already July 1 in Jerusalem: the two timezones disagree on "this month".
      vi.setSystemTime(new Date('2026-06-30T22:30:00Z'))
      try {
        for (const u of [admin, repX]) {
          const screen = await performance(u, { dateRange: 'החודש הנוכחי' })
          expect(pick(await agent(u, 'this_month')), `${tz} ${u.name}`).toEqual(screen)
        }
        const w = revenueWindow('this_month', new Date())!
        expect((w.start as Date).getMonth()).toBe(tz === 'UTC' ? 5 : 6)
      } finally {
        vi.setSystemTime(NOW)
      }
    },
  )
})
