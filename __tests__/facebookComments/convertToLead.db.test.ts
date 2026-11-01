/**
 * Comment → ליד against a real Postgres: the ליד must be FINDABLE in לידים.
 *
 * Regression (production, 2026-09-15): every "צור ליד" click created a ליד and
 * linked the comment, but the insert left `clients.status` and `userId` to their
 * column defaults ('true', NULL). The desktop לידים table shows a row only under
 * the status tab equal to its status (default tab "new"), and a rep only sees
 * rows whose `userId` is in their permission set — so the ליד appeared nowhere.
 *
 * Asserted through the same read the לידים page performs (`getPerms` +
 * `getLeadsTable`), for the initiating admin and the initiating rep, plus
 * workspace isolation and one ליד under concurrent clicks.
 *
 * Only Next.js infrastructure, identity, and the notification/automation emits
 * (not under test) are mocked.
 *
 * Run: npm run test:db -- __tests__/facebookComments/convertToLead.db.test.ts
 */
import { vi } from 'vitest'

vi.hoisted(() => {
  process.env.FACEBOOK_COMMENTS_ENABLED = '1'
})
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  cacheTag: vi.fn(),
  unstable_cache: vi.fn((fn: unknown) => fn),
}))
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn(), userAgent: vi.fn(() => ({ device: {}, ua: '' })) }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(() => null), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(() => ({ get: vi.fn(() => null) })),
}))
vi.mock('@/lib/requireUser', async () => {
  const actual = await vi.importActual<typeof import('@/lib/requireUser')>('@/lib/requireUser')
  const current = vi.fn()
  return {
    ...actual,
    requireUser: current,
    requireAgencyUser: current,
    requireProductAccess: current,
    requireBasicCrmAccess: current,
  }
})
vi.mock('@/db/auth', () => ({
  getUser: vi.fn(),
  getCachedUser: vi.fn(),
  createCookie: vi.fn(),
  getUserByEmail: vi.fn(),
  decrypt: vi.fn(),
  encrypt: vi.fn(),
}))
vi.mock('@/lib/automations/emit', () => ({ emitAutomationEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/notifications/emitLeadCreated', () => ({ emitLeadCreated: vi.fn(async () => undefined) }))

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { requireUser } from '@/lib/requireUser'
import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { getLeadsTable } from '@/db/clients'
import { getPerms } from '@/db/filter'
import { convertCommentToLead } from '@/modules/facebookComments/actions'
import { listPageComments } from '@/modules/facebookComments/queries'
import { Roles } from '@/types/roles'

const AGENCY = '__test_comment_lead__'
const OTHER_AGENCY = '__test_comment_lead_other__'
const PAGE = '__test_comment_lead_page__'
const OTHER_PAGE = '__test_comment_lead_other_page__'

type TestUser = { id: number; agencyId: number; role: Roles; name?: string | null }

let agencyId = 0
let otherAgencyId = 0
let admin: TestUser
let rep: TestUser
let otherRep: TestUser
let outsider: TestUser
let seq = 0

function actAs(user: TestUser) {
  vi.mocked(requireUser).mockResolvedValue(user as never)
  vi.mocked(getUser).mockResolvedValue(user as never)
}

async function purge(ids: number[]) {
  if (!ids.length) return
  await db('facebook_page_comments').whereIn('agencyId', ids).delete()
  await db('facebook_pages').whereIn('agency_id', ids).delete()
  await db('clients').whereIn('agencyId', ids).delete()
  await db('users').whereIn('agencyId', ids).delete()
  await db('agencies').whereIn('id', ids).delete()
}

async function syncSequence(seqName: string, table: string) {
  await db.raw(`SELECT setval(?, (SELECT COALESCE(MAX(id) + 1, 1) FROM ??), false)`, [seqName, table])
}

/** A fresh open comment on the agency's Page; ids are unique per test. */
async function seedComment(over: Record<string, unknown> = {}) {
  seq += 1
  const commentId = `__tcl_${Date.now()}_${seq}`
  await db('facebook_page_comments').insert({
    agencyId,
    pageId: PAGE,
    commentId,
    postId: `${PAGE}_1`,
    parentId: `${PAGE}_1`,
    authorName: 'דוד כהן',
    ...over,
  })
  return commentId
}

/** The list read exactly as `app/(he)/(app)/leads/page.tsx` performs it. */
async function leadsTableFor(user: TestUser) {
  const { gotPermIds } = await getPerms(user)
  return (await getLeadsTable({ user, params: {}, leads: true, gotPermIds })) as { id: number; status: string }[]
}

describe.skipIf(process.env.VITEST_NO_DB === '1')('comment → ליד (real DB)', () => {
  beforeAll(async () => {
    await syncSequence('agencies_id_seq', 'agencies')
    await syncSequence('users_seq', 'users')
    await syncSequence('"Client_id_seq"', 'clients')
    const stale = await db('agencies').whereIn('name', [AGENCY, OTHER_AGENCY]).select('id')
    await purge(stale.map((a: { id: number }) => Number(a.id)))

    const [a] = await db('agencies').insert({ name: AGENCY }).returning('id')
    const [b] = await db('agencies').insert({ name: OTHER_AGENCY }).returning('id')
    agencyId = Number(a.id)
    otherAgencyId = Number(b.id)
    process.env.FACEBOOK_COMMENTS_AGENCY_ALLOWLIST = `${agencyId},${otherAgencyId}`

    const mkUser = async (agency: number, role: Roles, lastName: string) => {
      const [u] = await db('users').insert({ firstName: '__test__', lastName, role, agencyId: agency }).returning('*')
      return { ...u, id: Number(u.id), agencyId: agency } as TestUser
    }
    admin = await mkUser(agencyId, Roles.ADMIN, 'Admin')
    rep = await mkUser(agencyId, Roles.AGNT, 'Rep')
    otherRep = await mkUser(agencyId, Roles.AGNT, 'OtherRep')
    outsider = await mkUser(otherAgencyId, Roles.ADMIN, 'Outsider')

    await db('facebook_pages').insert([
      { user_id: admin.id, agency_id: agencyId, page_id: PAGE, page_name: 'העסק', page_access_token: 'x' },
      { user_id: outsider.id, agency_id: otherAgencyId, page_id: OTHER_PAGE, page_name: 'אחר', page_access_token: 'x' },
    ])
  })

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterAll(async () => {
    try {
      await purge([agencyId, otherAgencyId].filter(Boolean))
    } finally {
      await db.destroy()
    }
  })

  it('an admin’s ליד is status "new" (the default לידים tab), owned by them, and returned by the לידים read', async () => {
    actAs(admin)
    const commentId = await seedComment()

    const r = await convertCommentToLead(commentId)

    expect(r).toMatchObject({ ok: true, created: true })
    const leadId = 'leadId' in r ? r.leadId : 0
    const lead = await db('clients').where({ id: leadId }).first()
    expect(lead).toMatchObject({
      agencyId,
      status: 'new',
      userId: admin.id,
      handlerId: admin.id,
      lead: true,
      leadSource: `facebook_comment:${commentId}`,
    })
    expect(lead.phone ?? null).toBeNull()
    expect(lead.email ?? null).toBeNull()

    const row = (await leadsTableFor(admin)).find((l) => Number(l.id) === leadId)
    expect(row?.status).toBe('new')

    const comment = await db('facebook_page_comments').where({ commentId, agencyId }).first()
    expect(comment).toMatchObject({ status: 'converted', convertedLeadId: leadId })
  })

  it('a rep sees the ליד they created; a rep without permission does not', async () => {
    actAs(rep)
    const commentId = await seedComment({ authorName: 'מיכל לוי' })

    const r = await convertCommentToLead(commentId)
    const leadId = 'leadId' in r ? r.leadId : 0

    expect(leadId).toBeGreaterThan(0)
    expect((await leadsTableFor(rep)).map((l) => Number(l.id))).toContain(leadId)
    expect((await leadsTableFor(otherRep)).map((l) => Number(l.id))).not.toContain(leadId)
  })

  it('repeated clicks after success return the same ליד, marked as already linked', async () => {
    actAs(admin)
    const commentId = await seedComment()

    const first = await convertCommentToLead(commentId)
    const second = await convertCommentToLead(commentId)

    expect(first).toMatchObject({ ok: true, created: true })
    expect(second).toEqual({ ok: true, leadId: 'leadId' in first ? first.leadId : -1, created: false })
    expect(
      await db('clients')
        .where({ leadSource: `facebook_comment:${commentId}` })
        .count({ n: '*' })
        .first(),
    ).toMatchObject({ n: '1' })
  })

  it('concurrent clicks create ONE ליד and both report it', async () => {
    actAs(admin)
    const commentId = await seedComment()

    const results = await Promise.all([
      convertCommentToLead(commentId),
      convertCommentToLead(commentId),
      convertCommentToLead(commentId),
    ])

    const leadIds = new Set(results.map((r) => ('leadId' in r ? r.leadId : null)))
    expect(results.every((r) => r.ok)).toBe(true)
    expect(leadIds.size).toBe(1)
    expect(results.filter((r) => 'created' in r && r.created)).toHaveLength(1)
    expect(
      await db('clients')
        .where({ leadSource: `facebook_comment:${commentId}` })
        .count({ n: '*' })
        .first(),
    ).toMatchObject({ n: '1' })
  })

  it('an unlinked ליד left by an interrupted attempt is linked, not duplicated', async () => {
    actAs(admin)
    const commentId = await seedComment()
    const [orphan] = await db('clients')
      .insert({
        agencyId,
        firstName: 'דוד',
        lastName: 'כהן',
        lead: true,
        status: 'new',
        userId: admin.id,
        createdById: admin.id,
        leadSource: `facebook_comment:${commentId}`,
      })
      .returning('id')

    const r = await convertCommentToLead(commentId)

    expect(r).toEqual({ ok: true, leadId: Number(orphan.id), created: false })
    expect(await db('facebook_page_comments').where({ commentId, agencyId }).first()).toMatchObject({
      status: 'converted',
      convertedLeadId: Number(orphan.id),
    })
  })

  it('another workspace cannot convert, or learn anything about, this comment', async () => {
    const commentId = await seedComment()
    actAs(outsider)

    const r = await convertCommentToLead(commentId)

    expect(r).toEqual({ ok: false, reason: 'not_found' })
    expect(
      await db('clients')
        .where({ leadSource: `facebook_comment:${commentId}` })
        .first(),
    ).toBeUndefined()
    expect(await db('facebook_page_comments').where({ commentId, agencyId }).first()).toMatchObject({
      status: 'open',
      convertedLeadId: null,
    })
  })

  it('a commenter with a one-word name, or no name, still becomes a ליד (lastName is NOT NULL)', async () => {
    actAs(admin)
    for (const authorName of ['מיכל', null]) {
      const commentId = await seedComment({ authorName })
      const r = await convertCommentToLead(commentId)
      expect(r).toMatchObject({ ok: true, created: true })
      const lead = await db('clients')
        .where({ id: 'leadId' in r ? r.leadId : 0 })
        .first()
      expect(lead).toMatchObject({ firstName: authorName ?? 'מגיב מפייסבוק', lastName: '' })
    }
  })

  it('a comment an old failed click left "converted" with no ליד can be finished now', async () => {
    actAs(admin)
    const commentId = await seedComment({ status: 'converted' })

    const r = await convertCommentToLead(commentId)

    expect(r).toMatchObject({ ok: true, created: true })
    expect(await db('facebook_page_comments').where({ commentId, agencyId }).first()).toMatchObject({
      status: 'converted',
      convertedLeadId: 'leadId' in r ? r.leadId : -1,
    })
  })

  it('a converted comment later deleted on Facebook stays listed under "all" and "converted" — for its own workspace only', async () => {
    actAs(admin)
    const commentId = await seedComment()
    const r = await convertCommentToLead(commentId)
    await db('facebook_page_comments').where({ commentId, agencyId }).update({ status: 'deleted' })
    const unlinkedDeleted = await seedComment({ status: 'deleted' })

    for (const status of ['all', 'converted'] as const) {
      const ids = (await listPageComments(agencyId, { status, limit: 100 })).items.map((c) => c.commentId)
      expect(ids).toContain(commentId)
      expect(ids).not.toContain(unlinkedDeleted)
    }
    expect((await listPageComments(agencyId, { status: 'open', limit: 100 })).items.map((c) => c.commentId)).not.toContain(
      commentId,
    )
    expect((await listPageComments(otherAgencyId, { status: 'all', limit: 100 })).items.map((c) => c.commentId)).not.toContain(
      commentId,
    )
    expect(r.ok).toBe(true)
  })

  it('a deleted comment is refused and left untouched', async () => {
    actAs(admin)
    const commentId = await seedComment({ status: 'deleted' })

    expect(await convertCommentToLead(commentId)).toEqual({ ok: false, reason: 'deleted' })
    expect(
      await db('clients')
        .where({ leadSource: `facebook_comment:${commentId}` })
        .first(),
    ).toBeUndefined()
  })
})
