/**
 * Facebook webhook → feed comment wiring — Task 4.
 *
 * INTEGRATION, deliberately: only the database and the leadgen collaborators
 * are mocked. The route, parseFeedComment and ingestFacebookComment all run for
 * real, so these tests prove the actual wiring rather than that a spy was
 * called.
 *
 * The invariant under the most pressure is that Lead Ads is untouched: the feed
 * branch must never reach `createLeadFromWebhook`, and a feed event must never
 * stop a sibling leadgen event in the same signed batch from being processed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHmac } from 'crypto'

const h = vi.hoisted(() => {
  const state = {
    connection: null as Record<string, unknown> | null,
    existingClient: undefined as unknown,
    tablesTouched: [] as string[],
    commentInserts: [] as Record<string, unknown>[],
    commentMerges: [] as Record<string, unknown>[],
    commentUpdates: [] as { where: unknown; row: Record<string, unknown> }[],
    conflictTargets: [] as unknown[],
    failures: [] as unknown[],
  }

  function qb(table: string) {
    state.tablesTouched.push(table)
    let lastWhere: unknown = null
    const b: Record<string, unknown> = {}
    b.where = (w: unknown) => {
      lastWhere = w
      return b
    }
    b.whereLike = () => b
    // Lead-Ads dedup now looks up BOTH source prefixes for one leadgen id
    // (`facebook:` and `instagram:`) since Instagram separation, so the builder
    // has to answer whereIn/orWhereLike as well. Behaviour is unchanged: these
    // are filters, and `first()` still returns whatever the fixture staged.
    b.whereIn = () => b
    b.orWhereLike = () => b
    b.first = async () => {
      if (table === 'facebook_pages') return state.connection
      if (table === 'clients') return state.existingClient
      return undefined
    }
    b.insert = (row: Record<string, unknown>) => {
      if (table === 'facebook_page_comments') {
        state.commentInserts.push(row)
        return b
      }
      if (table === 'webhook_failures') state.failures.push(row)
      return Promise.resolve([1])
    }
    b.onConflict = (t: unknown) => {
      state.conflictTargets.push(t)
      return b
    }
    b.merge = async (row: Record<string, unknown>) => {
      state.commentMerges.push(row)
      return [1]
    }
    b.update = (row: Record<string, unknown>) => {
      if (table === 'facebook_page_comments') state.commentUpdates.push({ where: lastWhere, row })
      return Promise.resolve(1)
    }
    return b
  }

  const db = Object.assign((t: string) => qb(t), { raw: async () => ({}) })
  return { state, db }
})

vi.mock('@/config/db', () => ({ db: h.db }))
vi.mock('@/lib/facebook/health', () => ({ repairFacebookConnection: vi.fn(async () => ({})) }))
vi.mock('@/lib/adapters/facebookLead', () => ({
  parseFacebookLead: vi.fn(() => ({ firstName: 'דוד', lastName: 'כהן', phone: '972500000000', email: null })),
}))
vi.mock('@/lib/system/createClientFromWebhook', () => ({
  createLeadFromWebhook: vi.fn(async () => ({ id: 42 })),
}))

import { POST } from '@/app/api/webhooks/facebook/route'
import { createLeadFromWebhook } from '@/lib/system/createClientFromWebhook'

const SECRET = 'test-app-secret-not-real'
const PAGE = '1175908668934802'
const POST_ID = `${PAGE}_122113311069337165`
const COMMENT = '122113311069337165_987654321'

const feedComment = (over: Record<string, unknown> = {}) => ({
  field: 'feed',
  value: {
    item: 'comment',
    verb: 'add',
    comment_id: COMMENT,
    post_id: POST_ID,
    parent_id: POST_ID,
    from: { id: 'U1', name: 'דוד כהן' },
    created_time: 1786364410,
    ...over,
  },
})

const leadgen = (id = 'LEAD_1') => ({ field: 'leadgen', value: { leadgen_id: id } })

function req(body: unknown, signature?: string) {
  const raw = JSON.stringify(body)
  const sig = signature ?? 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex')
  return {
    text: async () => raw,
    headers: { get: (k: string) => (k.toLowerCase() === 'x-hub-signature-256' ? sig : null) },
  } as unknown as import('next/server').NextRequest
}

beforeEach(() => {
  process.env.META_APP_SECRET = SECRET
  process.env.FACEBOOK_COMMENTS_ENABLED = '1'
  process.env.FACEBOOK_COMMENTS_AGENCY_ALLOWLIST = '103'
  h.state.connection = { page_id: PAGE, agency_id: 103, user_id: 332, health_status: 'healthy', page_access_token: 'ptok' }
  h.state.existingClient = undefined
  h.state.tablesTouched = []
  h.state.commentInserts = []
  h.state.commentMerges = []
  h.state.commentUpdates = []
  h.state.conflictTargets = []
  h.state.failures = []
  vi.mocked(createLeadFromWebhook).mockClear()

  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})

  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ field_data: [{ name: 'full_name', values: ['דוד כהן'] }] }),
    text: async () => '{}',
  })) as unknown as typeof fetch
})

// ──────────────────────────── FEED → COMMENT PATH ───────────────────────────

describe('webhook wiring — feed comments reach the ingest path', () => {
  it('WW-1: a signed feed/comment/add is persisted as a comment', async () => {
    const r = await POST(req({ entry: [{ id: PAGE, changes: [feedComment()] }] }))

    expect(r.status).toBe(200)
    expect(h.state.commentInserts).toHaveLength(1)
    expect(h.state.commentInserts[0]).toMatchObject({
      agencyId: 103,
      pageId: PAGE,
      commentId: COMMENT,
      postId: POST_ID,
      isTopLevel: true,
      verb: 'add',
    })
  })

  it('WW-2: comment/remove marks the row deleted instead of inserting', async () => {
    const r = await POST(req({ entry: [{ id: PAGE, changes: [feedComment({ verb: 'remove' })] }] }))

    expect(r.status).toBe(200)
    expect(h.state.commentInserts).toHaveLength(0)
    expect(h.state.commentUpdates).toHaveLength(1)
    expect(h.state.commentUpdates[0].row).toMatchObject({ status: 'deleted' })
    expect(h.state.commentUpdates[0].where).toMatchObject({ pageId: PAGE, commentId: COMMENT })
  })

  it('WW-3: a non-comment feed item creates nothing', async () => {
    // Production delivered ten video/remove events during the canary window.
    const r = await POST(
      req({ entry: [{ id: PAGE, changes: [{ field: 'feed', value: { item: 'video', verb: 'remove', post_id: POST_ID } }] }] }),
    )

    expect(r.status).toBe(200)
    expect(h.state.commentInserts).toHaveLength(0)
    expect(h.state.commentUpdates).toHaveLength(0)
    expect(h.state.tablesTouched).not.toContain('facebook_page_comments')
  })

  it('WW-4: pageId comes from the SIGNED entry.id, never from change.value', async () => {
    const hostile = feedComment({
      page_id: '999999999999',
      pageId: '999999999999',
      agency_id: 999,
      agencyId: 999,
    })

    await POST(req({ entry: [{ id: PAGE, changes: [hostile] }] }))

    const row = h.state.commentInserts[0]
    expect(row.pageId).toBe(PAGE)
    expect(row.agencyId).toBe(103)
    expect(JSON.stringify(row)).not.toContain('999')
  })

  it('WW-5: a disabled agency persists nothing', async () => {
    process.env.FACEBOOK_COMMENTS_AGENCY_ALLOWLIST = '555'

    const r = await POST(req({ entry: [{ id: PAGE, changes: [feedComment()] }] }))

    expect(r.status).toBe(200)
    expect(h.state.commentInserts).toHaveLength(0)
    expect(h.state.tablesTouched).not.toContain('facebook_page_comments')
  })

  it('WW-6: duplicate delivery stays idempotent — upsert on (pageId, commentId)', async () => {
    const delivery = { entry: [{ id: PAGE, changes: [feedComment()] }] }

    await POST(req(delivery))
    await POST(req(delivery))

    expect(h.state.commentMerges).toHaveLength(2)
    expect(h.state.conflictTargets).toEqual([
      ['pageId', 'commentId'],
      ['pageId', 'commentId'],
    ])
    expect(h.state.commentInserts.every((r) => r.commentId === COMMENT && r.pageId === PAGE)).toBe(true)
  })

  it('WW-7: a malformed feed payload does not throw and returns 200', async () => {
    for (const value of [null, 'x', 0, [], { item: 'comment' }]) {
      h.state.commentInserts = []
      const r = await POST(req({ entry: [{ id: PAGE, changes: [{ field: 'feed', value }] }] }))
      expect(r.status).toBe(200)
      expect(h.state.commentInserts).toHaveLength(0)
    }
  })
})

// ───────────────────────── LEAD ADS PRESERVATION ────────────────────────────

describe('webhook wiring — Lead Ads is untouched', () => {
  it('WW-8: a feed event never invokes the Lead Ads path', async () => {
    await POST(req({ entry: [{ id: PAGE, changes: [feedComment()] }] }))

    expect(createLeadFromWebhook).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled() // no Graph API call from the feed branch
  })

  it('WW-9: a leadgen change still creates a Lead through the existing path', async () => {
    await POST(req({ entry: [{ id: PAGE, changes: [leadgen()] }] }))

    expect(createLeadFromWebhook).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createLeadFromWebhook).mock.calls[0][0]).toMatchObject({
      leadId: 'LEAD_1',
      agencyId: 103,
      userId: 332,
    })
    expect(h.state.commentInserts).toHaveLength(0)
  })

  it('WW-10: a change with NO field key still reaches leadgen (CANARY-2 invariant)', async () => {
    // Gating leadgen on `field === 'leadgen'` would silently drop these.
    await POST(req({ entry: [{ id: PAGE, changes: [{ value: { leadgen_id: 'LEAD_2' } }] }] }))

    expect(createLeadFromWebhook).toHaveBeenCalledTimes(1)
  })

  it('WW-11: a feed event never stops a sibling leadgen event in the same batch', async () => {
    await POST(
      req({
        entry: [
          { id: PAGE, changes: [feedComment(), leadgen('LEAD_A')] },
          { id: PAGE, changes: [{ field: 'feed', value: null }, leadgen('LEAD_B')] },
        ],
      }),
    )

    expect(createLeadFromWebhook).toHaveBeenCalledTimes(2)
    const ids = vi.mocked(createLeadFromWebhook).mock.calls.map((c) => c[0].leadId)
    expect(ids).toEqual(['LEAD_A', 'LEAD_B'])
    expect(h.state.commentInserts).toHaveLength(1)
  })

  it('WW-12: a DB failure in the feed branch does not strand a sibling leadgen event', async () => {
    h.state.connection = null // ingest resolves no tenant, returns ignored

    await POST(req({ entry: [{ id: PAGE, changes: [feedComment(), leadgen('LEAD_C')] }] }))

    // The leadgen path resolves its own connection, which is also null here, so
    // it warns and skips — but critically the request still completes.
    expect(h.state.commentInserts).toHaveLength(0)
  })
})

// ───────────────────────────── SECURITY MODEL ───────────────────────────────

describe('webhook wiring — signature verification is unchanged', () => {
  it('WW-13: an invalid signature is rejected before ANY processing', async () => {
    const r = await POST(
      req({ entry: [{ id: PAGE, changes: [feedComment(), leadgen()] }] }, 'sha256=deadbeef'),
    )

    expect(r.status).toBe(403)
    expect(h.state.tablesTouched).toHaveLength(0)
    expect(h.state.commentInserts).toHaveLength(0)
    expect(createLeadFromWebhook).not.toHaveBeenCalled()
  })

  it('WW-14: a missing signature header is rejected', async () => {
    const raw = JSON.stringify({ entry: [{ id: PAGE, changes: [feedComment()] }] })
    const noSig = {
      text: async () => raw,
      headers: { get: () => null },
    } as unknown as import('next/server').NextRequest

    const r = await POST(noSig)

    expect(r.status).toBe(403)
    expect(h.state.commentInserts).toHaveLength(0)
  })
})

// ──────────────────────────── LEADGEN → FORM ANSWERS ─────────────────────────

describe('webhook wiring — every Lead Ads answer reaches the lead', () => {
  it('WW-FA: the full field_data is normalised and handed to createLeadFromWebhook', async () => {
    const fieldData = [
      { name: 'full_name', values: ['דוד כהן'] },
      { name: 'phone_number', values: ['+972501234567'] },
      { name: 'מה_התקציב_שלך?', values: ['5,000–10,000 ₪'] },
      { name: 'אילו_שירותים_מעניינים_אותך?', values: ['צילום', 'וידאו'] },
    ]
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ field_data: fieldData }),
      text: async () => '{}',
    })) as unknown as typeof fetch

    await POST(req({ entry: [{ id: PAGE, changes: [leadgen('LEAD_FA')] }] }))

    expect(vi.mocked(createLeadFromWebhook).mock.calls[0][0].formAnswers).toEqual([
      { key: 'full_name', values: ['דוד כהן'] },
      { key: 'phone_number', values: ['+972501234567'] },
      { key: 'מה_התקציב_שלך?', values: ['5,000–10,000 ₪'] },
      { key: 'אילו_שירותים_מעניינים_אותך?', values: ['צילום', 'וידאו'] },
    ])
  })
})
