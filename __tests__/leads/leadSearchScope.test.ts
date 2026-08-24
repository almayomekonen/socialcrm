/**
 * Lead search scope — regression tests for the "my leads disappeared" defect.
 *
 * REAL DATABASE. Only Next.js infrastructure and the identity layer are mocked,
 * exactly as `lead-isolation.test.ts` does: everything asserted here is about
 * what PostgreSQL actually returns, because the defect was a query that silently
 * returned zero rows, not a component that mis-rendered a known result.
 *
 * Covers, in order:
 *   · a targeted `?clientId=` lookup survives pagination and `view=due`
 *   · an unparseable `?clientId=` cannot crash the page (was `22P02`)
 *   · a targeted lookup is still agency- and permission-scoped
 *   · the autocomplete obeys the same permission rule as the table
 *   · a bad or foreign `?listId=` cannot crash or expose anything
 */
import { vi } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  cacheTag: vi.fn(),
  unstable_cache: vi.fn((fn: unknown) => fn),
}))
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn((fn: () => void) => fn) }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(() => null), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(() => ({ get: vi.fn(() => null) })),
}))
vi.mock('@/lib/requireUser', async () => {
  const actual = await vi.importActual<typeof import('@/lib/requireUser')>('@/lib/requireUser')
  const current = vi.fn()
  return { ...actual, requireUser: current, requireAgencyUser: current, requireProductAccess: current }
})
vi.mock('@/db/auth', () => ({
  getUser: vi.fn(),
  getCachedUser: vi.fn(),
  createCookie: vi.fn(),
  getUserByEmail: vi.fn(),
  decrypt: vi.fn(),
  encrypt: vi.fn(),
}))

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { requireUser } from '@/lib/requireUser'
import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { getLeadsTable } from '@/db/clients'
import { getPerms } from '@/db/filter'
import { searchLeads } from '@/actions/clients'
import { Roles } from '@/types/roles'

const AGENCY_A = '__test_search_scope_A__'
const AGENCY_B = '__test_search_scope_B__'

type TestUser = { id: number; agencyId: number; role: Roles; name?: string | null }

let agencyA: number
let agencyB: number
let adminA: TestUser
let repA1: TestUser
let repA2: TestUser
let adminB: TestUser

let leadNew: number // agencyA / repA1 / status 'new'
let leadClosed: number // agencyA / repA1 / status 'closed' — never "due"
let leadOfOtherRep: number // agencyA / repA2 — invisible to repA1
let leadOfAgencyB: number

function setCurrentUser(user: TestUser) {
  vi.mocked(requireUser).mockResolvedValue(user as never)
  vi.mocked(getUser).mockResolvedValue(user as never)
}

async function syncSequence(seqName: string, table: string, idCol = 'id') {
  await db.raw(`SELECT setval(?, (SELECT COALESCE(MAX(??) + 1, 1) FROM ??), false)`, [seqName, db.raw(`"${idCol}"`), table])
}

async function purge(ids: number[]) {
  if (!ids.length) return
  const users = await db('users').whereIn('agencyId', ids).select('id')
  await db('client_lists')
    .whereIn(
      'userId',
      users.map((u: { id: number }) => u.id),
    )
    .delete()
  await db('clients').whereIn('agencyId', ids).delete()
  await db('users').whereIn('agencyId', ids).delete()
  await db('agencies').whereIn('id', ids).delete()
}

/** The list read exactly as `app/(app)/leads/page.tsx` performs it. */
async function leadsTableFor(user: TestUser, params: Record<string, unknown>) {
  const { gotPermIds } = await getPerms(user)
  return getLeadsTable({ user, params, leads: true, gotPermIds })
}

const ids = (rows: { id: number }[]) => rows.map((r) => Number(r.id))

describe('lead search scope', () => {
  beforeAll(async () => {
    await syncSequence('agencies_id_seq', 'agencies')
    await syncSequence('users_seq', 'users')
    await syncSequence('"Client_id_seq"', 'clients')

    const stale = await db('agencies').whereIn('name', [AGENCY_A, AGENCY_B]).select('id')
    await purge(stale.map((a: { id: number }) => a.id))

    const [a] = await db('agencies').insert({ name: AGENCY_A }).returning('id')
    const [b] = await db('agencies').insert({ name: AGENCY_B }).returning('id')
    agencyA = a.id
    agencyB = b.id

    const mkUser = async (agencyId: number, role: Roles, lastName: string) => {
      const [u] = await db('users').insert({ firstName: '__test__', lastName, role, agencyId }).returning('*')
      return u as TestUser
    }
    adminA = await mkUser(agencyA, Roles.ADMIN, 'AdminA')
    repA1 = await mkUser(agencyA, Roles.AGNT, 'RepOne')
    repA2 = await mkUser(agencyA, Roles.AGNT, 'RepTwo')
    adminB = await mkUser(agencyB, Roles.ADMIN, 'AdminB')

    const mkLead = async (owner: TestUser, fields: Record<string, unknown>) => {
      const [row] = await db('clients')
        .insert({
          agencyId: owner.agencyId,
          userId: owner.id,
          createdById: owner.id,
          lead: true,
          overQuota: false,
          ...fields,
        })
        .returning('id')
      return Number(row.id)
    }

    leadNew = await mkLead(repA1, { firstName: 'ספי', lastName: 'ברהנה', status: 'new' })
    leadClosed = await mkLead(repA1, { firstName: 'סגור', lastName: 'עסקה', status: 'closed' })
    leadOfOtherRep = await mkLead(repA2, { firstName: 'שייך', lastName: 'לאחר', status: 'new', idNum: '123456789' })
    leadOfAgencyB = await mkLead(adminB, { firstName: 'סוכנות', lastName: 'אחרת', status: 'new' })
  })

  afterAll(async () => {
    try {
      await purge([agencyA, agencyB].filter((id) => id != null))
    } finally {
      await db.destroy()
    }
  })

  // ── Targeted lookup vs list constraints ────────────────────────────────────

  it('returns the requested lead on pageNum=2 (offset must not hide it)', async () => {
    setCurrentUser(adminA)
    const rows = await leadsTableFor(adminA, { clientId: String(leadNew), pageNum: '2' })
    expect(ids(rows)).toEqual([leadNew])
  })

  it('returns the requested lead on pageNum=3', async () => {
    setCurrentUser(adminA)
    const rows = await leadsTableFor(adminA, { clientId: String(leadNew), pageNum: '3', tableLimit: '100' })
    expect(ids(rows)).toEqual([leadNew])
  })

  it('returns the requested lead under view=due even though it is not due', async () => {
    setCurrentUser(adminA)
    // Sanity: a closed lead is never a member of the due worklist.
    const dueOnly = await leadsTableFor(adminA, { view: 'due' })
    expect(ids(dueOnly)).not.toContain(leadClosed)

    const rows = await leadsTableFor(adminA, { clientId: String(leadClosed), view: 'due' })
    expect(ids(rows)).toEqual([leadClosed])
  })

  it('an unparseable clientId does not throw 22P02 and falls back to the normal list', async () => {
    setCurrentUser(adminA)
    const rows = await leadsTableFor(adminA, { clientId: 'ספי ברהנה' })
    expect(ids(rows)).toEqual(expect.arrayContaining([leadNew, leadClosed, leadOfOtherRep]))
    expect(ids(rows)).not.toContain(leadOfAgencyB)
  })

  // ── Security boundaries the fix must NOT relax ─────────────────────────────

  it('a targeted lookup stays agency-scoped', async () => {
    setCurrentUser(adminA)
    const rows = await leadsTableFor(adminA, { clientId: String(leadOfAgencyB) })
    expect(rows).toHaveLength(0)
  })

  it('a targeted lookup stays permission-scoped for non-admins', async () => {
    setCurrentUser(repA1)
    expect(ids(await leadsTableFor(repA1, { clientId: String(leadOfOtherRep) }))).toHaveLength(0)
    // …and the rep's own lead is still reachable the same way.
    expect(ids(await leadsTableFor(repA1, { clientId: String(leadNew) }))).toEqual([leadNew])
  })

  // ── Autocomplete permissions ───────────────────────────────────────────────

  it('a rep cannot autocomplete another rep’s lead', async () => {
    setCurrentUser(repA1)
    const results = await searchLeads('שייך')
    expect(results.map((r: { id: number }) => Number(r.id))).not.toContain(leadOfOtherRep)
  })

  it('autocomplete never returns idNum (or details carrying it) for an inaccessible lead', async () => {
    setCurrentUser(repA1)
    const results = await searchLeads('123456789')
    expect(results).toHaveLength(0)

    // `details` is generated as firstName || ' ' || lastName || ' (' || idNum || ')',
    // so a leaked row leaks the national ID through it as well.
    const byName = await searchLeads('לאחר')
    expect(JSON.stringify(byName)).not.toContain('123456789')
  })

  it('a rep can still autocomplete their own leads', async () => {
    setCurrentUser(repA1)
    const results = await searchLeads('ברהנה')
    expect(results.map((r: { id: number }) => Number(r.id))).toContain(leadNew)
  })

  it('admin autocomplete is unchanged — every lead in the agency, none outside it', async () => {
    setCurrentUser(adminA)
    const found = (await searchLeads('לאחר')).map((r: { id: number }) => Number(r.id))
    expect(found).toContain(leadOfOtherRep)

    const cross = (await searchLeads('אחרת')).map((r: { id: number }) => Number(r.id))
    expect(cross).not.toContain(leadOfAgencyB)
  })

  // ── Saved-list safety ──────────────────────────────────────────────────────

  it('a nonexistent listId does not crash the page', async () => {
    setCurrentUser(adminA)
    await expect(leadsTableFor(adminA, { listId: '999999999' })).resolves.toBeDefined()
    await expect(leadsTableFor(adminA, { listId: 'not-a-number' })).resolves.toBeDefined()
  })

  it('a listId owned by another agency exposes nothing', async () => {
    setCurrentUser(adminB)
    const [list] = await db('client_lists')
      .insert({ userId: adminB.id, title: '__test_list__', clientIds: [leadOfAgencyB] })
      .returning('id')

    setCurrentUser(adminA)
    const rows = await leadsTableFor(adminA, { listId: String(list.id) })
    expect(ids(rows)).not.toContain(leadOfAgencyB)
    expect(rows.every((r: { agencyId: number }) => Number(r.agencyId) === agencyA)).toBe(true)
  })
})
