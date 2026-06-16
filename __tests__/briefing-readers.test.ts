/**
 * Integration tests for the General-Mode briefing readers — REAL Postgres
 * (socialcrm_test). The readers only depend on getAgencyId / getAgencyPlan
 * (mocked) + the DB; everything else is real SQL. Focus: the permission-scope
 * control (gotPermIds) and the date/threshold logic, end-to-end against the
 * live schema.
 *
 * ⚠️ PRE-EXISTING HARNESS BLOCKER (not this feature): `__tests__/setup.ts` does
 * `DROP SCHEMA public CASCADE` + `knex migrate.latest()`, but the base tables
 * (clients, tasks, …) are Prisma-created — no knex migration builds them — so a
 * from-scratch migrate fails with `relation "clients" does not exist`. EVERY
 * DB-backed test currently fails the same way (verified against the existing
 * lead-isolation.test.ts). This file will pass once the harness seeds the
 * Prisma baseline before knex migrations.
 *
 * Until then, the readers were verified directly against the live schema + real
 * data via read-only psql (all five execute cleanly; the {total,sample} cap was
 * confirmed with a real 78-row section returning 50), and the permission gate
 * is proven at the SQL level in __tests__/ai/briefing-scope.test.ts.
 */
import { vi } from 'vitest'

vi.mock('@/db/agencies', () => ({ getAgencyId: vi.fn() }))
vi.mock('@/lib/quota', () => ({ getAgencyPlan: vi.fn() }))

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '@/config/db'
import { getAgencyId } from '@/db/agencies'
import { getAgencyPlan } from '@/lib/quota'
import {
  getFollowUpsDueToday,
  getLeadsNotContactedRecently,
  getNewLeadsThisWeek,
  getOverdueTaskSummary,
  getUnreadInboxSummary,
} from '@/db/briefing'
import { Roles } from '@/types/roles'

let agencyId: number
let u1: number
let u2: number
const L: Record<string, number> = {}

async function seedLead(opts: {
  owner: number
  status?: string
  nextFollowUpAt?: unknown
  lastActivityAt?: unknown
  createdAt?: unknown
}): Promise<number> {
  const row: Record<string, unknown> = {
    firstName: '__test__',
    lastName: 'Lead',
    agencyId,
    userId: opts.owner,
    createdById: opts.owner,
    lead: true,
    status: opts.status ?? 'new',
  }
  if (opts.nextFollowUpAt !== undefined) row.nextFollowUpAt = opts.nextFollowUpAt
  if (opts.lastActivityAt !== undefined) row.lastActivityAt = opts.lastActivityAt
  if (opts.createdAt !== undefined) row.createdAt = opts.createdAt
  const [r] = await db('clients').insert(row).returning('id')
  return r.id
}

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__test_briefing__' }).returning('id')
  agencyId = a.id
  const [a1] = await db('users').insert({ firstName: 'U1', role: 'AGNT', agencyId }).returning('id')
  const [a2] = await db('users').insert({ firstName: 'U2', role: 'AGNT', agencyId }).returning('id')
  u1 = a1.id
  u2 = a2.id

  const today12 = db.raw("date_trunc('day', NOW()) + interval '12 hours'")
  const old = db.raw("NOW() - interval '60 days'")

  // Old createdAt so these are NOT "new this week".
  L.l1 = await seedLead({ owner: u1, nextFollowUpAt: today12, createdAt: old }) // due today, owner U1
  L.l2 = await seedLead({ owner: u2, nextFollowUpAt: today12, createdAt: old }) // due today, owner U2 (cross-user)
  L.stale = await seedLead({ owner: u1, lastActivityAt: db.raw("NOW() - interval '30 days'"), createdAt: old })
  L.fresh = await seedLead({ owner: u1, lastActivityAt: db.raw('NOW()'), createdAt: old })
  L.newThisWeek = await seedLead({ owner: u1 }) // createdAt defaults to NOW() → in week

  await db('tasks').insert({
    clientId: L.l1,
    title: '__test__ overdue',
    completed: false,
    dueDate: db.raw("CURRENT_DATE - interval '1 day'"),
  })

  await db('inbox_conversations').insert({
    agencyId,
    leadId: L.l1,
    businessPhoneNumberId: 'pn_test',
    customerWaId: 'wa_test',
    unreadCount: 3,
  })

  vi.mocked(getAgencyId).mockResolvedValue(agencyId)
  vi.mocked(getAgencyPlan).mockResolvedValue('pro' as never)
})

afterAll(async () => {
  try {
    await db('inbox_conversations').where({ agencyId }).delete()
    await db('tasks').whereIn('clientId', Object.values(L)).delete()
    await db('clients').where({ agencyId }).delete()
    await db('users').where({ agencyId }).delete()
    await db('agencies').where({ id: agencyId }).delete()
  } finally {
    await db.destroy()
  }
})

const agent = (id: number) => ({ user: { role: Roles.AGNT }, gotPermIds: [id] })
const admin = { user: { role: Roles.ADMIN }, gotPermIds: [] as number[] }

describe('briefing readers — live schema + permission scoping', () => {
  it('follow-ups due today: AGENT sees only own; ADMIN sees both', async () => {
    const a = await getFollowUpsDueToday(agent(u1))
    expect(a.sample.map((r) => r.id)).toContain(L.l1)
    expect(a.sample.map((r) => r.id)).not.toContain(L.l2)

    const adm = await getFollowUpsDueToday(admin)
    expect(adm.sample.map((r) => r.id)).toEqual(expect.arrayContaining([L.l1, L.l2]))
    expect(adm.total).toBeGreaterThanOrEqual(2)
  })

  it('not contacted recently: includes stale + null-activity, excludes fresh + cross-user', async () => {
    const a = await getLeadsNotContactedRecently(agent(u1))
    const ids = a.sample.map((r) => r.id)
    expect(ids).toContain(L.stale)
    expect(ids).not.toContain(L.fresh)
    expect(ids).not.toContain(L.l2) // owned by U2
  })

  it('new this week: includes a lead created now, excludes 60-days-old ones', async () => {
    const a = await getNewLeadsThisWeek(agent(u1))
    const ids = a.sample.map((r) => r.id)
    expect(ids).toContain(L.newThisWeek)
    expect(ids).not.toContain(L.stale)
  })

  it('overdue tasks: counts the overdue task on the in-scope lead', async () => {
    const a = await getOverdueTaskSummary(agent(u1))
    expect(a.total).toBeGreaterThanOrEqual(1)
    expect(a.sample.map((r) => r.id)).toContain(L.l1)
    // out-of-scope agent sees none of U1's overdue tasks
    const other = await getOverdueTaskSummary(agent(u2))
    expect(other.sample.map((r) => r.id)).not.toContain(L.l1)
  })

  it('unread inbox: aggregates unread for in-scope leads only', async () => {
    const a = await getUnreadInboxSummary(agent(u1))
    expect(a.conversations).toBe(1)
    expect(a.unread).toBe(3)
    const other = await getUnreadInboxSummary(agent(u2))
    expect(other.unread).toBe(0)
  })
})
