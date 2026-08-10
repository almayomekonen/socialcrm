/**
 * Facebook comment ingest — Task 3.
 *
 * The two properties that matter most are asserted first and hardest:
 *   TENANCY    — agencyId is resolved from facebook_pages via the SIGNED
 *                pageId, and no value from the payload can influence it.
 *   IDEMPOTENCY— Meta redelivers on any non-2xx, so a duplicate delivery must
 *                never produce a second row.
 *
 * Task 3 persists comments and nothing else: no Lead is created here (that is
 * Task 6), which the `clients` table assertion pins down.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    connection: null as Record<string, unknown> | null,
    /** When set, any query against this table throws — simulates a DB outage. */
    throwOnTable: null as string | null,
    /** Every table name the module touched, in order. */
    tablesTouched: [] as string[],
    inserts: [] as Record<string, unknown>[],
    merges: [] as Record<string, unknown>[],
    conflictTargets: [] as unknown[],
    updates: [] as { where: unknown; row: Record<string, unknown> }[],
    wheres: [] as unknown[],
  }

  function qb(table: string) {
    state.tablesTouched.push(table)
    if (state.throwOnTable === table) throw new Error('db down')
    let lastWhere: unknown = null
    const b: Record<string, unknown> = {}
    b.where = (w: unknown) => {
      lastWhere = w
      state.wheres.push({ table, w })
      return b
    }
    b.first = async () => (table === 'facebook_pages' ? state.connection : undefined)
    b.insert = (row: Record<string, unknown>) => {
      state.inserts.push(row)
      return b
    }
    b.onConflict = (target: unknown) => {
      state.conflictTargets.push(target)
      return b
    }
    b.merge = async (row: Record<string, unknown>) => {
      state.merges.push(row)
      return [1]
    }
    b.update = async (row: Record<string, unknown>) => {
      state.updates.push({ where: lastWhere, row })
      return 1
    }
    return b
  }

  const db = Object.assign((t: string) => qb(t), { raw: async () => ({}) })
  return { state, db }
})

vi.mock('@/config/db', () => ({ db: h.db }))

import { ingestFacebookComment } from '@/lib/system/ingestFacebookComment'

const PAGE = '1175908668934802'
const POST = `${PAGE}_122113311069337165`
const COMMENT = '122113311069337165_987654321'

const comment = (over: Record<string, unknown> = {}) => ({
  item: 'comment',
  verb: 'add',
  comment_id: COMMENT,
  post_id: POST,
  parent_id: POST,
  from: { id: 'U1', name: 'דוד כהן' },
  created_time: 1786364410,
  ...over,
})

beforeEach(() => {
  process.env.FACEBOOK_COMMENTS_ENABLED = '1'
  process.env.FACEBOOK_COMMENTS_AGENCY_ALLOWLIST = '103'
  h.state.connection = { page_id: PAGE, agency_id: 103, user_id: 332 }
  h.state.throwOnTable = null
  h.state.tablesTouched = []
  h.state.inserts = []
  h.state.merges = []
  h.state.conflictTargets = []
  h.state.updates = []
  h.state.wheres = []
})

// ───────────────────────────── TENANT ISOLATION ─────────────────────────────

describe('ingestFacebookComment — tenant isolation', () => {
  it('resolves agencyId from facebook_pages using the signed pageId', async () => {
    const r = await ingestFacebookComment(PAGE, comment())

    expect(r).toBe('ingested')
    expect(h.state.tablesTouched[0]).toBe('facebook_pages')
    expect(h.state.wheres[0]).toEqual({ table: 'facebook_pages', w: { page_id: PAGE } })
    expect(h.state.inserts[0].agencyId).toBe(103)
  })

  it('HOSTILE PAYLOAD: agency_id=999 can never reach the persisted row', async () => {
    const hostile = comment({
      agency_id: 999,
      agencyId: 999,
      agency: { id: 999 },
      tenant_id: 999,
      page_id: '999999999999',
      pageId: '999999999999',
    })

    const r = await ingestFacebookComment(PAGE, hostile)

    expect(r).toBe('ingested')
    const row = h.state.inserts[0]
    expect(row.agencyId).toBe(103)
    expect(row.pageId).toBe(PAGE)
    // Nothing anywhere in the persisted row carries the attacker's values.
    expect(JSON.stringify(row)).not.toContain('999')
    expect(JSON.stringify(h.state.merges)).not.toContain('999')
  })

  it('ignores a Page with no connection row — no tenant, no write', async () => {
    h.state.connection = null

    expect(await ingestFacebookComment(PAGE, comment())).toBe('ignored')
    expect(h.state.inserts).toHaveLength(0)
    expect(h.state.updates).toHaveLength(0)
  })

  it('ignores an agency that is not on the rollout allowlist — nothing is persisted', async () => {
    h.state.connection = { page_id: PAGE, agency_id: 555, user_id: 1 }

    expect(await ingestFacebookComment(PAGE, comment())).toBe('ignored')
    expect(h.state.inserts).toHaveLength(0)
  })

  it('ignores everything when the kill switch is off', async () => {
    delete process.env.FACEBOOK_COMMENTS_ENABLED

    expect(await ingestFacebookComment(PAGE, comment())).toBe('ignored')
    expect(h.state.inserts).toHaveLength(0)
  })

  it('scopes the deletion update by BOTH pageId and commentId', async () => {
    await ingestFacebookComment(PAGE, comment({ verb: 'remove' }))

    expect(h.state.updates[0].where).toMatchObject({ pageId: PAGE, commentId: COMMENT })
  })
})

// ────────────────────────────── IDEMPOTENCY ─────────────────────────────────

describe('ingestFacebookComment — idempotency', () => {
  it('dedups on (pageId, commentId) so redelivery cannot duplicate a row', async () => {
    await ingestFacebookComment(PAGE, comment())
    await ingestFacebookComment(PAGE, comment())
    await ingestFacebookComment(PAGE, comment())

    expect(h.state.merges).toHaveLength(3)
    expect(h.state.conflictTargets).toEqual([
      ['pageId', 'commentId'],
      ['pageId', 'commentId'],
      ['pageId', 'commentId'],
    ])
    expect(h.state.inserts.every((r) => r.commentId === COMMENT && r.pageId === PAGE)).toBe(true)
  })

  it('an edited redelivery refreshes the text but never the tenancy', async () => {
    await ingestFacebookComment(PAGE, comment({ verb: 'edited', message: 'עודכן' }))

    const merged = h.state.merges[0]
    expect(merged.message).toBe('עודכן')
    expect(merged).not.toHaveProperty('agencyId')
    expect(merged).not.toHaveProperty('pageId')
  })
})

// ───────────────────────────── PERSISTED SHAPE ──────────────────────────────

describe('ingestFacebookComment — persisted shape', () => {
  it('stores every field the plan requires', async () => {
    await ingestFacebookComment(PAGE, comment())
    const row = h.state.inserts[0]

    expect(row).toMatchObject({
      agencyId: 103,
      pageId: PAGE,
      commentId: COMMENT,
      postId: POST,
      parentId: POST,
      isTopLevel: true,
      authorExternalId: 'U1',
      authorName: 'דוד כהן',
      message: '',
      messageAvailable: false,
      verb: 'add',
    })
    expect(row.createdTime).toBeInstanceOf(Date)
    expect(row.receivedAt).toBeInstanceOf(Date)
  })

  it('marks a reply as not top-level', async () => {
    await ingestFacebookComment(PAGE, comment({ parent_id: '122113311069337165_111' }))

    expect(h.state.inserts[0].isTopLevel).toBe(false)
  })

  it('stores messageAvailable=false while Meta withholds the text', async () => {
    await ingestFacebookComment(PAGE, comment())

    expect(h.state.inserts[0].message).toBe('')
    expect(h.state.inserts[0].messageAvailable).toBe(false)
  })

  it('stores the text once Meta sends it', async () => {
    await ingestFacebookComment(PAGE, comment({ message: 'כמה עולה?' }))

    expect(h.state.inserts[0].message).toBe('כמה עולה?')
    expect(h.state.inserts[0].messageAvailable).toBe(true)
  })
})

// ──────────────────────────── VERBS AND DELETION ────────────────────────────

describe('ingestFacebookComment — verbs', () => {
  it('marks a removed comment deleted rather than inserting one', async () => {
    const r = await ingestFacebookComment(PAGE, comment({ verb: 'remove' }))

    expect(r).toBe('deleted')
    expect(h.state.inserts).toHaveLength(0)
    expect(h.state.updates[0].row).toMatchObject({ status: 'deleted' })
    expect(h.state.updates[0].row.deletedAt).toBeInstanceOf(Date)
  })

  it('a deletion for a comment we never stored is a harmless no-op', async () => {
    // The update simply matches nothing. It must not throw or insert.
    const r = await ingestFacebookComment(PAGE, comment({ verb: 'remove', comment_id: 'NEVER_SEEN' }))

    expect(r).toBe('deleted')
    expect(h.state.inserts).toHaveLength(0)
  })

  it.each(['hide', 'unhide', 'unknown'])('ignores verb %s — out of MVP scope', async (verb) => {
    expect(await ingestFacebookComment(PAGE, comment({ verb }))).toBe('ignored')
    expect(h.state.inserts).toHaveLength(0)
  })

  it('ignores non-comment feed items', async () => {
    // Production delivered 10 video/remove events during the canary.
    expect(await ingestFacebookComment(PAGE, { item: 'video', verb: 'remove' })).toBe('ignored')
    expect(h.state.tablesTouched).toHaveLength(0)
  })
})

// ──────────────────────────── SAFETY INVARIANTS ─────────────────────────────

describe('ingestFacebookComment — safety invariants', () => {
  it('never creates a Lead — Task 3 does not touch the clients table', async () => {
    await ingestFacebookComment(PAGE, comment())

    expect(h.state.tablesTouched).not.toContain('clients')
    expect(h.state.tablesTouched).toEqual(['facebook_pages', 'facebook_page_comments'])
  })

  it.each([null, undefined, 'x', 0, [], { item: 'comment' }])(
    'never throws on hostile input: %p',
    async (value) => {
      await expect(ingestFacebookComment(PAGE, value)).resolves.toBe('ignored')
    },
  )

  it('never throws when the database fails mid-write — the webhook batch survives', async () => {
    // Tenancy resolves, then the write explodes. A throw here would abort the
    // whole webhook delivery and strand sibling leadgen events.
    h.state.throwOnTable = 'facebook_page_comments'

    await expect(ingestFacebookComment(PAGE, comment())).resolves.toBe('ignored')
  })

  it('ignores an empty pageId — there is no verified tenant to resolve', async () => {
    expect(await ingestFacebookComment('', comment())).toBe('ignored')
    expect(h.state.tablesTouched).toHaveLength(0)
  })
})
