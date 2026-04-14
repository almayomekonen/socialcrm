/**
 * Lead System — Critical Integration Tests
 *
 * Strategy
 * --------
 * • All DB operations are REAL (same local PostgreSQL used by the app).
 * • Only Next.js infrastructure (cookies, cache invalidation, navigation) is
 *   mocked — it has no bearing on data correctness.
 * • requireUser / getUser are mocked so we can inject any "current user"
 *   without running a Next.js server.
 * • beforeAll:  advance sequences past existing max IDs, clean up any stale
 *               test rows left by a previous interrupted run, then seed two
 *               isolated agencies + one user each.
 * • beforeEach: insert a fresh lead for agency A.
 * • afterEach:  delete all test leads.
 * • afterAll:   delete test users + agencies, destroy the pool.
 */

// ─── Next.js infrastructure mocks ────────────────────────────────────────────
// vi.mock calls are hoisted above all imports by Vitest — the factories run
// before any module that depends on these packages is evaluated.
import { vi } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  cacheTag: vi.fn(),
  unstable_cache: vi.fn((fn: unknown) => fn),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(() => null), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(() => ({ get: vi.fn(() => null) })),
}))

// Auth layer: swap the "logged-in user" per-test via setCurrentUser()
vi.mock('@/lib/requireUser', () => ({ requireUser: vi.fn() }))
vi.mock('@/db/auth', () => ({
  getUser: vi.fn(),
  getCachedUser: vi.fn(),
  createCookie: vi.fn(),
  getUserByEmail: vi.fn(),
  decrypt: vi.fn(),
  encrypt: vi.fn(),
}))

// ─── Imports ──────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { requireUser } from '@/lib/requireUser'
import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { getFullLead } from '@/db/clients'
import { updateLead, deleteLead, fetchLeadsSince, upsertLead } from '@/actions/clients'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Advance a sequence so it sits safely above the current max id.
 * Prevents duplicate-key errors when the sequence falls behind production rows.
 */
async function syncSequence(seqName: string, table: string, idCol = 'id') {
  await db.raw(
    `SELECT setval(?, (SELECT COALESCE(MAX(??) + 1, 1) FROM ??), false)`,
    [seqName, db.raw(`"${idCol}"`), table],
  )
}

type TestUser = {
  id: number
  agencyId: number
  role: string
  suspended: boolean
  name: string | null
  email: string | null
  picture: string | null
}

// ─── Shared state ─────────────────────────────────────────────────────────────
const TEST_AGENCY_A = '__test_agency_A__'
const TEST_AGENCY_B = '__test_agency_B__'

let agencyA: number
let agencyB: number
let userA: TestUser
let userB: TestUser
let leadAId: number

/** Point both requireUser() and getUser() at the given user for this test. */
function setCurrentUser(user: TestUser) {
  vi.mocked(requireUser).mockResolvedValue(user as any)
  vi.mocked(getUser).mockResolvedValue(user as any)
}

// ─── Utility: delete all data scoped to the given agency IDs ─────────────────
async function purgeTestAgencies(ids: number[]) {
  if (!ids.length) return
  // clients first (FK createdById → users is ON DELETE RESTRICT)
  await db('clients').whereIn('agencyId', ids).delete()
  await db('users').whereIn('agencyId', ids).delete()
  await db('agencies').whereIn('id', ids).delete()
}

// ─── Suite ────────────────────────────────────────────────────────────────────
describe('Lead system critical tests', () => {
  // ── Global setup ─────────────────────────────────────────────────────────
  beforeAll(async () => {
    // 1. Advance sequences above production max to avoid duplicate-key clashes
    await syncSequence('agencies_id_seq', 'agencies')
    await syncSequence('users_seq', 'users')
    await syncSequence('"Client_id_seq"', 'clients')

    // 2. Clean up any rows left behind by a previously interrupted test run
    const staleAgencies = await db('agencies')
      .whereIn('name', [TEST_AGENCY_A, TEST_AGENCY_B])
      .select('id')
    await purgeTestAgencies(staleAgencies.map((a: { id: number }) => a.id))

    // 3. Create two isolated agencies
    const [a] = await db('agencies').insert({ name: TEST_AGENCY_A }).returning('id')
    const [b] = await db('agencies').insert({ name: TEST_AGENCY_B }).returning('id')
    agencyA = a.id
    agencyB = b.id

    // 4. One ADMIN user per agency
    const [uA] = await db('users')
      .insert({ firstName: '__test__', lastName: 'UserA', role: 'ADMIN', agencyId: agencyA })
      .returning('*')
    const [uB] = await db('users')
      .insert({ firstName: '__test__', lastName: 'UserB', role: 'ADMIN', agencyId: agencyB })
      .returning('*')
    userA = uA
    userB = uB
  })

  // ── Global teardown ───────────────────────────────────────────────────────
  afterAll(async () => {
    try {
      const ids = [agencyA, agencyB].filter((id) => id != null)
      await purgeTestAgencies(ids)
    } finally {
      await db.destroy()
    }
  })

  // ── Per-test setup: fresh lead for agency A ───────────────────────────────
  beforeEach(async () => {
    const [lead] = await db('clients')
      .insert({
        firstName: '__test__',
        lastName: 'Lead',
        agencyId: agencyA,
        userId: userA.id,
        createdById: userA.id,
        lead: true,
      })
      .returning('id')
    leadAId = lead.id
    // Note: client_info_insert_trigger fires AFTER INSERT on clients and
    // automatically creates the clients_info row — no manual insert needed.
  })

  // ── Per-test teardown ─────────────────────────────────────────────────────
  afterEach(async () => {
    await db('clients').whereIn('agencyId', [agencyA, agencyB]).delete()
    vi.clearAllMocks()
  })

  // ── Test 1 — Cross-agency READ is blocked ─────────────────────────────────
  it('User B cannot read a lead that belongs to agency A', async () => {
    setCurrentUser(userB)

    const result = await getFullLead({ id: leadAId })

    // getFullLead now enforces WHERE c.agencyId = user.agencyId.
    // userB.agencyId = agencyB; the lead belongs to agencyA → must not return.
    expect(result).toBeUndefined()
  })

  // ── Test 2 — Cross-agency UPDATE is blocked ───────────────────────────────
  it('User B cannot update a lead that belongs to agency A', async () => {
    setCurrentUser(userB)

    const before = await db('clients').where({ id: leadAId }).select('status').first()
    await updateLead({ id: leadAId, status: 'contacted' })
    const after = await db('clients').where({ id: leadAId }).select('status').first()

    // updateLead WHERE clause: { id, agencyId: user.agencyId }.
    // With agencyB ≠ agencyA → 0 rows affected.
    expect(after.status).toBe(before.status)
    expect(after.status).not.toBe('contacted')
  })

  // ── Test 3 — Cross-agency DELETE is blocked ───────────────────────────────
  it('User B cannot delete a lead that belongs to agency A', async () => {
    setCurrentUser(userB)

    await deleteLead(leadAId)

    // deleteLead WHERE clause: { id, agencyId: user.agencyId }.
    // Lead must still exist.
    const row = await db('clients').where({ id: leadAId }).first()
    expect(row).toBeDefined()
    expect(row.id).toBe(leadAId)
  })

  // ── Test 4 — Owner can UPDATE their own lead ──────────────────────────────
  it('User A can update their own lead — status and updatedAt change', async () => {
    setCurrentUser(userA)

    const before = await db('clients').where({ id: leadAId }).select('updatedAt', 'status').first()

    // Small pause so the new updatedAt timestamp is measurably later
    await new Promise((r) => setTimeout(r, 20))

    const result = await updateLead({ id: leadAId, status: 'contacted' })

    expect(result).toBeDefined()
    expect(result.id).toBe(leadAId)
    expect(result.status).toBe('contacted')
    expect(new Date(result.updatedAt).getTime()).toBeGreaterThan(
      new Date(before.updatedAt).getTime(),
    )

    // Confirm in DB — not just the returned value
    const row = await db('clients').where({ id: leadAId }).first()
    expect(row.status).toBe('contacted')
  })

  // ── Test 5 — fetchLeadsSince returns chronologically updated leads ─────────
  it('fetchLeadsSince returns a lead after it is updated, without cross-agency leaks', async () => {
    setCurrentUser(userA)

    // Pin the lead's updatedAt to a known point in the far past
    await db('clients').where({ id: leadAId }).update({ updatedAt: new Date('2020-01-01') })

    // Cursor = a date that is after the initial insert but before the update
    const lastSeenAt = new Date('2020-06-01').toISOString()

    // Real update: sets updatedAt = now(), which is > lastSeenAt
    await updateLead({ id: leadAId, status: 'interested' })

    const results = (await fetchLeadsSince(lastSeenAt)) as any[]

    // The updated lead must appear
    const found = results.find((l) => l.id === leadAId)
    expect(found).toBeDefined()
    expect(found.status).toBe('interested')
    expect(found.agencyId).toBe(agencyA)

    // No data from agency B must ever appear in userA's poll
    const leaked = results.filter((l) => l.agencyId !== agencyA)
    expect(leaked).toHaveLength(0)
  })

  // ── Test 6 — Inserted lead is scoped to the correct agency ────────────────
  it('upsertLead stores the lead under the correct agency', async () => {
    setCurrentUser(userA)

    // _system=true skips requireUser() and getAgencyId() inside upsertLead,
    // so we supply agencyId explicitly.
    const lead = await upsertLead(
      userA.id,
      {
        firstName: '__test__',
        lastName: 'NewLead',
        lead: true,
        agencyId: agencyA,
        userId: userA.id,
        _system: true,
      },
      null, // clientId = null → INSERT path
    )

    expect(lead).toBeDefined()
    expect(lead.agencyId).toBe(agencyA)

    // Verify directly in the DB
    const row = await db('clients').where({ id: lead.id }).first()
    expect(row).toBeDefined()
    expect(row.agencyId).toBe(agencyA)
    expect(row.lead).toBe(true)

    // No accidental write to agency B
    const crossRow = await db('clients').where({ id: lead.id, agencyId: agencyB }).first()
    expect(crossRow).toBeUndefined()
  })
})
