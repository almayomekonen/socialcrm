/**
 * THE VALUE LOOP, end to end, against a REAL database.
 *
 *   zero leads → import → real leads → open/act on one → set a follow-up
 *
 * Every write here is the production server action; only Next.js infrastructure
 * and the session are mocked. This exists because the milestone it proves —
 * `first_follow_up_set` — had never fired once in production, and a unit test
 * with a mocked `db` cannot show that the row actually lands.
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
/** `after()` throws outside a request scope; run the callback inline so the
 *  analytics write really happens and can be asserted. */
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
  encrypt: vi.fn(),
}))
vi.mock('@/db/agencies', () => ({ getAgencyId: vi.fn(), getAgencyById: vi.fn() }))

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { db } from '@/config/db'
import { requireProductAccess } from '@/lib/requireUser'
import { getUser } from '@/db/auth'
import { getAgencyId } from '@/db/agencies'
import { addLeads } from '@/actions/clients'
import { setLeadFollowUp, clearLeadFollowUp } from '@/actions/leadFollowUp'
import { parsePastedLeads } from '@/lib/leads/pastedLeads'
import { mapImportRows } from '@/lib/leads/importMapping'

let agencyId: number
let userId: number

async function events(event: string) {
  return db('analytics_events').where({ agencyId, event }).select('*')
}

beforeAll(async () => {
  const [agency] = await db('agencies').insert({ name: 'VL Test Agency' }).returning('id')
  agencyId = Number(agency.id ?? agency)

  const [user] = await db('users')
    .insert({
      firstName: 'VL',
      lastName: 'Tester',
      email: `vl-${Date.now()}@example.test`,
      agencyId,
      role: 'ADMIN',
    })
    .returning('*')
  userId = Number(user.id)

  const session = { id: userId, agencyId, role: 'ADMIN', email: user.email }
  ;(requireProductAccess as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(session)
  ;(getUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(session)
  ;(getAgencyId as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(agencyId)
})

afterAll(async () => {
  await db('analytics_events').where({ agencyId }).del()
  await db('clients').where({ agencyId }).del()
  await db('users').where({ agencyId }).del()
  await db('agencies').where({ id: agencyId }).del()
  await db.destroy()
})

beforeEach(async () => {
  await db('clients').where({ agencyId }).del()
  await db('analytics_events').where({ agencyId }).del()
})

describe('value loop — a brand-new workspace reaches a real lead with a follow-up', () => {
  it('(a) starts with zero leads', async () => {
    const [{ count }] = await db('clients').where({ agencyId }).count({ count: '*' })
    expect(Number(count)).toBe(0)
  })

  it('(b) imports a pasted column of phone numbers into REAL rows', async () => {
    const parsed = parsePastedLeads('דנה לוי, 0521234567\n0537654321\n052-123-4567')
    // The third line duplicates the first number and must not become a lead.
    expect(parsed.rows).toHaveLength(2)

    const res = await addLeads(parsed.rows, 'paste')
    expect(res).toMatchObject({ success: true, inserted: 2 })
    expect((res as { firstId?: number }).firstId).toBeGreaterThan(0)

    const rows = await db('clients').where({ agencyId }).select('firstName', 'phone')
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.phone).sort()).toEqual(['0521234567', '0537654321'])

    const imported = await events('leads_imported')
    expect(imported).toHaveLength(1)
    expect(imported[0].props).toMatchObject({ count: 2, format: 'paste' })
  })

  it('(b2) imports a spreadsheet that has a phone and NO national id', async () => {
    const mapped = mapImportRows(
      ['שם פרטי', 'שם משפחה', 'טלפון'],
      [
        ['דנה', 'לוי', '0521111111'],
        ['יוסי', 'כהן', '0522222222'],
      ],
    )
    expect(mapped.data).toHaveLength(2)

    const res = await addLeads(mapped.data, 'excel')
    expect(res).toMatchObject({ success: true, inserted: 2 })

    const rows = await db('clients').where({ agencyId })
    expect(rows).toHaveLength(2)
    // The row that used to be impossible: a lead with a phone and no idNum.
    expect(rows.every((r) => !r.idNum && r.phone)).toBe(true)
  })

  it('(c) does not re-import leads that already exist', async () => {
    const rows = parsePastedLeads('0521234567').rows
    await addLeads(rows, 'paste')
    const second = await addLeads(rows, 'paste')

    expect(second).toMatchObject({ success: true, inserted: 0 })
    const [{ count }] = await db('clients').where({ agencyId }).count({ count: '*' })
    expect(Number(count)).toBe(1)
    // No genuine insert → no second import event.
    expect(await events('leads_imported')).toHaveLength(1)
  })

  it('(d+e) setting a follow-up on the first lead persists AND emits first_follow_up_set', async () => {
    const res = await addLeads(parsePastedLeads('דנה, 0521234567').rows, 'paste')
    const leadId = (res as { firstId?: number }).firstId!
    expect(leadId).toBeGreaterThan(0)

    expect(await events('first_follow_up_set')).toHaveLength(0)

    const at = new Date(Date.now() + 24 * 3600 * 1000)
    const saved = await setLeadFollowUp({ id: leadId, at: at.toISOString(), note: 'לחזור מחר' })
    expect(saved).not.toMatchObject({ err: true })

    // The real column, not just the event.
    const lead = await db('clients').where({ id: leadId }).first()
    expect(lead.nextFollowUpAt).toBeTruthy()
    expect(lead.followUpNote).toBe('לחזור מחר')
    expect(lead.lastActivityAt).toBeTruthy()

    const fired = await events('first_follow_up_set')
    expect(fired).toHaveLength(1)
    expect(Number(fired[0].userId)).toBe(userId)
  })

  it('(e2) stays at exactly one event across repeated saves — idempotent per agency', async () => {
    const res = await addLeads(parsePastedLeads('0521234567\n0537654321').rows, 'paste')
    const leadId = (res as { firstId?: number }).firstId!
    const other = await db('clients').where({ agencyId }).whereNot({ id: leadId }).first()

    const at = new Date(Date.now() + 24 * 3600 * 1000)
    await setLeadFollowUp({ id: leadId, at: at.toISOString() })
    await setLeadFollowUp({ id: leadId, at: new Date(Date.now() + 48 * 3600 * 1000).toISOString() })
    await setLeadFollowUp({ id: Number(other.id), at: at.toISOString() })

    expect(await events('first_follow_up_set')).toHaveLength(1)
  })

  it('(e3) clearing a follow-up is not "setting one" and emits nothing', async () => {
    const res = await addLeads(parsePastedLeads('0521234567').rows, 'paste')
    const leadId = (res as { firstId?: number }).firstId!

    await clearLeadFollowUp({ id: leadId })

    expect(await events('first_follow_up_set')).toHaveLength(0)
    const lead = await db('clients').where({ id: leadId }).first()
    expect(lead.nextFollowUpAt).toBeNull()
  })

  it('(f) a failed save emits nothing — the milestone tracks reality', async () => {
    // A lead id that does not belong to this agency must not produce a row.
    await setLeadFollowUp({ id: 999_999_999, at: new Date().toISOString() })
    expect(await events('first_follow_up_set')).toHaveLength(0)
  })
})
