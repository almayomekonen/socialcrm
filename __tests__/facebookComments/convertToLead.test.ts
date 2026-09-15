/**
 * Comment → Lead conversion — Task 6.
 *
 * The conversion reuses the PUBLIC `upsertLead` action rather than the
 * server-internal `insertLeadSystem`: this is a user-initiated write, and
 * insertLeadSystem's own header forbids that ("The public upsertLead server
 * action MUST NOT delegate to this helper... route it through upsertLead unless
 * you are operating from a signed, server-verified context"). upsertLead brings
 * quota enforcement, the agency quota-lock transaction, origin coercion and the
 * lead_created emit with it.
 *
 * The properties under most pressure: tenancy comes only from the session, and
 * a comment can produce at most ONE Lead no matter how many times the button is
 * pressed or how a previous attempt failed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    comment: null as Record<string, unknown> | null,
    existingLead: undefined as Record<string, unknown> | undefined,
    /** When set, successive `clients` probes return these in order (then `existingLead`). */
    leadProbes: [] as (Record<string, unknown> | undefined)[],
    wheres: [] as { table: string; where: unknown }[],
    updates: [] as { table: string; where: unknown; row: Record<string, unknown> }[],
    throwOnTable: null as string | null,
  }
  function qb(table: string) {
    if (state.throwOnTable === table) throw new Error('db down')
    let lastWhere: unknown = null
    const b: Record<string, unknown> = {}
    b.where = (w: unknown) => {
      lastWhere = w
      state.wheres.push({ table, where: w })
      return b
    }
    b.first = async () => {
      if (table === 'facebook_page_comments') return state.comment
      if (table === 'clients') return state.leadProbes.length ? state.leadProbes.shift() : state.existingLead
      return undefined
    }
    b.update = async (row: Record<string, unknown>) => {
      state.updates.push({ table, where: lastWhere, row })
      return 1
    }
    return b
  }
  const db = Object.assign((t: string) => qb(t), { raw: async () => ({}) })
  return { state, db }
})

vi.mock('@/config/db', () => ({ db: h.db }))
vi.mock('@/lib/requireUser', () => ({
  requireAgencyUser: vi.fn(async () => ({ id: 332, agencyId: 103, email: 'a@b.co' })),
}))
vi.mock('@/actions/clients', () => ({ upsertLead: vi.fn(async () => ({ id: 777, leadSource: 'x' })) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { convertCommentToLead } from '@/modules/facebookComments/actions'
import { upsertLead } from '@/actions/clients'
import { requireAgencyUser } from '@/lib/requireUser'

const COMMENT = '122113311069337165_987654321'
const AGENCY = 103

const openComment = (over: Record<string, unknown> = {}) => ({
  id: 5,
  commentId: COMMENT,
  agencyId: AGENCY,
  pageId: '1175908668934802',
  postId: '1175908668934802_122113311069337165',
  authorName: 'דוד כהן',
  message: 'כמה עולה?',
  messageAvailable: true,
  status: 'open',
  convertedLeadId: null,
  ...over,
})

beforeEach(() => {
  process.env.FACEBOOK_COMMENTS_ENABLED = '1'
  process.env.FACEBOOK_COMMENTS_AGENCY_ALLOWLIST = String(AGENCY)
  h.state.comment = openComment()
  h.state.existingLead = undefined
  h.state.leadProbes = []
  h.state.wheres = []
  h.state.updates = []
  h.state.throwOnTable = null
  vi.mocked(upsertLead).mockClear()
  vi.mocked(upsertLead).mockResolvedValue({ id: 777, leadSource: `facebook_comment:${COMMENT}` } as never)
  vi.mocked(requireAgencyUser).mockResolvedValue({ id: 332, agencyId: AGENCY, email: 'a@b.co' } as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// ──────────────────────────── HAPPY PATH ────────────────────────────────────

describe('convertCommentToLead — successful conversion', () => {
  it('creates the Lead and returns its id', async () => {
    const r = await convertCommentToLead(COMMENT)

    expect(r).toEqual({ ok: true, leadId: 777, created: true })
    expect(upsertLead).toHaveBeenCalledTimes(1)
  })

  it('populates exactly the fields a comment can honestly supply', async () => {
    await convertCommentToLead(COMMENT)
    const [userId, data, clientId, , origin] = vi.mocked(upsertLead).mock.calls[0]

    expect(userId).toBe(332)
    expect(clientId).toBeUndefined() // insert branch, never an update
    expect(origin).toBe('manual')
    expect(data).toMatchObject({
      firstName: 'דוד',
      lastName: 'כהן',
      leadSource: `facebook_comment:${COMMENT}`,
      lead: true,
      handlerId: 332,
    })
  })

  it('creates the ליד where לידים can show it: status "new", owned by the initiating user', async () => {
    // Regression (production, 2026-09-15): without these the column defaults
    // applied — status 'true', userId NULL — and the ליד matched no status tab
    // in לידים and no rep's permission filter, though the comment said converted.
    await convertCommentToLead(COMMENT)
    const data = vi.mocked(upsertLead).mock.calls[0][1] as Record<string, unknown>

    expect(data.status).toBe('new')
    expect(data.userId).toBe(332)
  })

  it('NEVER sets idNum — add_zeros_trigger LPADs to 9 chars and truncates', async () => {
    await convertCommentToLead(COMMENT)
    const data = vi.mocked(upsertLead).mock.calls[0][1] as Record<string, unknown>

    expect(data.idNum).toBeUndefined()
    expect('idNum' in data).toBe(false)
  })

  it('invents no contact information — a comment has no phone or email', async () => {
    await convertCommentToLead(COMMENT)
    const data = vi.mocked(upsertLead).mock.calls[0][1] as Record<string, unknown>

    expect(data.phone).toBeUndefined()
    expect(data.email).toBeUndefined()
  })

  it('handles a single-word author name', async () => {
    h.state.comment = openComment({ authorName: 'דוד' })
    await convertCommentToLead(COMMENT)
    const data = vi.mocked(upsertLead).mock.calls[0][1] as Record<string, unknown>

    expect(data.firstName).toBe('דוד')
    // clients."lastName" is NOT NULL — null would make the insert fail.
    expect(data.lastName).toBe('')
  })

  it('falls back to a neutral name when the author is unknown', async () => {
    h.state.comment = openComment({ authorName: null })
    await convertCommentToLead(COMMENT)
    const data = vi.mocked(upsertLead).mock.calls[0][1] as Record<string, unknown>

    expect(data.firstName).toBe('מגיב מפייסבוק')
  })

  it('links the comment to the Lead and marks it converted', async () => {
    await convertCommentToLead(COMMENT)
    const link = h.state.updates.find((u) => u.table === 'facebook_page_comments')

    expect(link?.row).toMatchObject({ convertedLeadId: 777, status: 'converted' })
    expect(link?.where).toMatchObject({ commentId: COMMENT, agencyId: AGENCY })
  })
})

// ─────────────────────────── TENANT ISOLATION ───────────────────────────────

describe('convertCommentToLead — tenant isolation', () => {
  it('loads the comment scoped by the SESSION agencyId', async () => {
    await convertCommentToLead(COMMENT)
    const load = h.state.wheres.find((w) => w.table === 'facebook_page_comments')

    expect(load?.where).toEqual({ commentId: COMMENT, agencyId: AGENCY })
  })

  it("another agency's comment is simply not found — no leak, no creation", async () => {
    // The tenant predicate makes a cross-agency row invisible to the query.
    h.state.comment = null

    const r = await convertCommentToLead(COMMENT)

    expect(r).toEqual({ ok: false, reason: 'not_found' })
    expect(upsertLead).not.toHaveBeenCalled()
  })

  it('takes agencyId ONLY from the session — it is not an argument at all', async () => {
    process.env.FACEBOOK_COMMENTS_AGENCY_ALLOWLIST = '103,555'
    vi.mocked(requireAgencyUser).mockResolvedValue({ id: 9, agencyId: 555, email: 'x@y.z' } as never)
    h.state.comment = null

    // Even a caller who knows a real commentId gets nothing under their own tenant.
    await convertCommentToLead(COMMENT)
    const load = h.state.wheres.find((w) => w.table === 'facebook_page_comments')

    expect(load?.where).toMatchObject({ agencyId: 555 })
    expect(convertCommentToLead.length).toBe(1) // single param: commentId
  })

  it('refuses when the agency is not enabled for Facebook Comments', async () => {
    process.env.FACEBOOK_COMMENTS_AGENCY_ALLOWLIST = '999'

    const r = await convertCommentToLead(COMMENT)

    expect(r).toEqual({ ok: false, reason: 'not_enabled' })
    expect(upsertLead).not.toHaveBeenCalled()
    expect(h.state.wheres).toHaveLength(0) // gated before any query
  })
})

// ───────────────────────────── IDEMPOTENCY ──────────────────────────────────

describe('convertCommentToLead — idempotency', () => {
  it('an already-converted comment returns its existing Lead without creating another', async () => {
    h.state.comment = openComment({ status: 'converted', convertedLeadId: 777 })

    const r = await convertCommentToLead(COMMENT)

    expect(r).toEqual({ ok: true, leadId: 777, created: false })
    expect(upsertLead).not.toHaveBeenCalled()
  })

  it('repeated conversion produces exactly one Lead', async () => {
    const first = await convertCommentToLead(COMMENT)
    // Simulate the row as it now stands after the first conversion.
    h.state.comment = openComment({ status: 'converted', convertedLeadId: 777 })
    const second = await convertCommentToLead(COMMENT)
    const third = await convertCommentToLead(COMMENT)

    expect([first, second, third]).toEqual([
      { ok: true, leadId: 777, created: true },
      { ok: true, leadId: 777, created: false },
      { ok: true, leadId: 777, created: false },
    ])
    expect(upsertLead).toHaveBeenCalledTimes(1)
  })

  it('ADOPTS an orphaned Lead from a partially-failed earlier attempt', async () => {
    // A previous run created the Lead then died before linking. The global
    // unique index on clients."leadSource" means creating another is impossible,
    // so the only correct move is to adopt the existing one.
    h.state.existingLead = { id: 555 }

    const r = await convertCommentToLead(COMMENT)

    expect(r).toEqual({ ok: true, leadId: 555, created: false })
    expect(upsertLead).not.toHaveBeenCalled()
    expect(h.state.updates[0].row).toMatchObject({ convertedLeadId: 555, status: 'converted' })
  })

  it('a concurrent click that created the ליד first is adopted, not reported as a failure', async () => {
    // Nothing exists when this request looks; the other request's insert then
    // wins the unique leadSource index, so ours comes back without an id.
    h.state.leadProbes = [undefined, { id: 901 }]
    vi.mocked(upsertLead).mockResolvedValue({ err: true, msg: 'duplicate key value violates unique constraint' } as never)

    const r = await convertCommentToLead(COMMENT)

    expect(r).toEqual({ ok: true, leadId: 901, created: false })
    expect(h.state.updates).toHaveLength(1)
    expect(h.state.updates[0].row).toMatchObject({ convertedLeadId: 901, status: 'converted' })
  })

  it('looks for the orphan by leadSource within the tenant', async () => {
    h.state.existingLead = { id: 555 }
    await convertCommentToLead(COMMENT)
    const probe = h.state.wheres.find((w) => w.table === 'clients')

    expect(probe?.where).toEqual({ leadSource: `facebook_comment:${COMMENT}`, agencyId: AGENCY })
  })
})

// ───────────────────────── FAILURES AND EDGE CASES ──────────────────────────

describe('convertCommentToLead — failure handling', () => {
  it('refuses to convert a deleted comment', async () => {
    h.state.comment = openComment({ status: 'deleted' })

    const r = await convertCommentToLead(COMMENT)

    expect(r).toEqual({ ok: false, reason: 'deleted' })
    expect(upsertLead).not.toHaveBeenCalled()
  })

  it('surfaces a quota rejection as a typed reason, not a crash', async () => {
    vi.mocked(upsertLead).mockResolvedValue({ error: 'quota_exceeded', current: 50, limit: 50 } as never)

    const r = await convertCommentToLead(COMMENT)

    expect(r).toEqual({ ok: false, reason: 'quota_exceeded' })
    expect(h.state.updates).toHaveLength(0) // comment untouched
  })

  it('reports a Lead-creation failure without linking anything', async () => {
    vi.mocked(upsertLead).mockResolvedValue(null as never)

    const r = await convertCommentToLead(COMMENT)

    expect(r).toEqual({ ok: false, reason: 'create_failed' })
    expect(h.state.updates).toHaveLength(0)
  })

  it('an error result from upsertLead (no id) is a failure: the comment stays open', async () => {
    vi.mocked(upsertLead).mockResolvedValue({ err: true, msg: 'insert failed' } as never)

    const r = await convertCommentToLead(COMMENT)

    expect(r).toEqual({ ok: false, reason: 'create_failed' })
    expect(h.state.updates).toHaveLength(0)
  })

  it('never leaks a raw database error to the client', async () => {
    h.state.throwOnTable = 'facebook_page_comments'

    const r = await convertCommentToLead(COMMENT)

    expect(r).toEqual({ ok: false, reason: 'db_error' })
    expect(JSON.stringify(r)).not.toContain('db down')
  })

  it('never leaks a raw error when Lead creation throws', async () => {
    vi.mocked(upsertLead).mockRejectedValue(new Error('connection reset by peer'))

    const r = await convertCommentToLead(COMMENT)

    expect(r).toEqual({ ok: false, reason: 'db_error' })
    expect(JSON.stringify(r)).not.toContain('connection reset')
  })

  it('rejects a blank commentId before touching the database', async () => {
    const r = await convertCommentToLead('')

    expect(r).toEqual({ ok: false, reason: 'not_found' })
    expect(h.state.wheres).toHaveLength(0)
  })
})
