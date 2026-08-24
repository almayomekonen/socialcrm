/**
 * Lead search scope — regression tests for the "my leads disappeared" defect.
 *
 * REAL DATABASE. Only Next.js infrastructure and the identity layer are mocked,
 * exactly as `lead-isolation.test.ts` does: everything asserted here is about
 * what PostgreSQL actually returns, because the defect was a query that silently
 * returned zero rows, not a component that mis-rendered a known result.
 *
 * Covers, in order:
 *   · `?q=` narrows the workspace instead of replacing it with one record
 *   · multi-term search is order-independent and agrees with the autocomplete
 *   · search composes with a saved list and with `view=due`
 *   · search is still agency- and permission-scoped
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
let leadSecondSefi: number // agencyA / repA1 — proves a partial term returns a SET
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
  const q = typeof params.q === 'string' ? params.q : ''
  return getLeadsTable({ user, params, leads: true, gotPermIds, filters: q ? { q } : null })
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
    leadSecondSefi = await mkLead(repA1, { firstName: 'ספי', lastName: 'מזרחי', status: 'interested' })
    leadOfAgencyB = await mkLead(adminB, { firstName: 'סוכנות', lastName: 'אחרת', status: 'new' })
  })

  afterAll(async () => {
    try {
      await purge([agencyA, agencyB].filter((id) => id != null))
    } finally {
      await db.destroy()
    }
  })

  // ── Search narrows the workspace; it does not replace it ───────────────────

  it('an exact two-word search finds the lead', async () => {
    setCurrentUser(adminA)
    expect(ids(await leadsTableFor(adminA, { q: 'ספי ברהנה' }))).toEqual([leadNew])
  })

  it('a partial term returns every match — a search, not a record lookup', async () => {
    setCurrentUser(adminA)
    const rows = await leadsTableFor(adminA, { q: 'ספי' })
    expect(ids(rows)).toEqual(expect.arrayContaining([leadNew, leadSecondSefi]))
    expect(rows.length).toBeGreaterThan(1)
  })

  it('reversed terms match — the table agrees with the autocomplete', async () => {
    setCurrentUser(adminA)
    // The autocomplete splits on whitespace and ANDs the terms; before this the
    // table matched one un-split `%q%` and returned nothing for this query.
    expect(ids(await leadsTableFor(adminA, { q: 'ברהנה ספי' }))).toEqual([leadNew])
  })

  it('a search that matches nothing returns zero rows without throwing', async () => {
    setCurrentUser(adminA)
    await expect(leadsTableFor(adminA, { q: 'לאקייםבכלל' })).resolves.toHaveLength(0)
  })

  it('search composes with view=due instead of bypassing it', async () => {
    setCurrentUser(adminA)
    // leadClosed is never a member of the due worklist, so a due-scoped search
    // for it must return nothing — the search narrows, it does not override.
    expect(ids(await leadsTableFor(adminA, { q: 'סגור', view: 'due' }))).toHaveLength(0)
    expect(ids(await leadsTableFor(adminA, { q: 'סגור' }))).toEqual([leadClosed])
  })

  it('search composes with a saved list', async () => {
    setCurrentUser(adminA)
    const [list] = await db('client_lists')
      .insert({ userId: adminA.id, title: '__test_list_compose__', clientIds: [leadNew] })
      .returning('id')

    expect(ids(await leadsTableFor(adminA, { q: 'ספי', listId: String(list.id) }))).toEqual([leadNew])
    // …and a lead outside the list is excluded even though it matches the term.
    expect(ids(await leadsTableFor(adminA, { q: 'ספי', listId: String(list.id) }))).not.toContain(leadSecondSefi)
  })

  it('pagination applies normally to search results', async () => {
    setCurrentUser(adminA)
    const page1 = await leadsTableFor(adminA, { q: 'ספי', tableLimit: '1', pageNum: '1' })
    const page2 = await leadsTableFor(adminA, { q: 'ספי', tableLimit: '1', pageNum: '2' })
    expect(page1).toHaveLength(1)
    expect(page2).toHaveLength(1)
    expect(ids(page1)[0]).not.toBe(ids(page2)[0])
  })

  it('a leftover ?clientId= no longer scopes the list to one record', async () => {
    setCurrentUser(adminA)
    const rows = await leadsTableFor(adminA, { clientId: String(leadNew) })
    expect(rows.length).toBeGreaterThan(1)
  })

  // ── Security boundaries the fix must NOT relax ─────────────────────────────

  it('search stays agency-scoped', async () => {
    setCurrentUser(adminA)
    expect(await leadsTableFor(adminA, { q: 'אחרת' })).toHaveLength(0)
  })

  it('search stays permission-scoped for non-admins', async () => {
    setCurrentUser(repA1)
    expect(ids(await leadsTableFor(repA1, { q: 'לאחר' }))).toHaveLength(0)
    // …and the rep's own lead is still reachable by the same search.
    expect(ids(await leadsTableFor(repA1, { q: 'ברהנה' }))).toEqual([leadNew])
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
