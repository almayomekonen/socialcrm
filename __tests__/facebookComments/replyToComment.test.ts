/**
 * Reply to a Facebook comment as the Page — authorization, token hygiene,
 * error mapping and dedup-safe recording.
 *
 * Unit-level: the real action, real graphClient, real replies module; db,
 * session and fetch are faked. The DB-level merge with the webhook echo is
 * covered by facebookCommentReplyDedup.db.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  process.env.SECRETS_ENC_KEY = Buffer.alloc(32, 5).toString('base64')
  process.env.META_APP_SECRET = 'app-secret'
  process.env.FACEBOOK_COMMENTS_ENABLED = '1'
  process.env.FACEBOOK_COMMENTS_AGENCY_ALLOWLIST = '103'
  const state = {
    comment: null as Record<string, unknown> | null,
    page: null as Record<string, unknown> | null,
    wheres: [] as { table: string; w: unknown }[],
    inserts: [] as { table: string; row: Record<string, unknown> }[],
    merges: [] as Record<string, unknown>[],
    updates: [] as unknown[],
    failMerge: false,
    mergeAttempts: 0,
  }
  function qb(table: string) {
    const b: Record<string, unknown> = {}
    b.where = (w: unknown) => {
      state.wheres.push({ table, w })
      return b
    }
    b.whereNot = () => b
    b.first = async () => (table === 'facebook_page_comments' ? state.comment : state.page)
    b.insert = (row: Record<string, unknown>) => {
      state.inserts.push({ table, row })
      return b
    }
    b.onConflict = () => b
    b.merge = async (row: Record<string, unknown>) => {
      state.mergeAttempts++
      if (state.failMerge) throw new Error('db down')
      state.merges.push(row)
      return [1]
    }
    b.update = async (u: unknown) => {
      state.updates.push(u)
      return 1
    }
    return b
  }
  return { state, db: Object.assign((t: string) => qb(t), { raw: (x: string) => x }) }
})

vi.mock('@/config/db', () => ({ db: h.db }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/requireUser', () => ({
  requireProductAccess: vi.fn(async () => ({ id: 7, agencyId: 103, role: 'ADMIN' })),
}))
vi.mock('@/lib/notifications/emit', () => ({ notifyEvent: vi.fn(async () => ({ enqueued: false })) }))

import { replyToComment } from '@/modules/facebookComments/replyActions'
import { sealPageAccessToken } from '@/lib/facebook/pageToken'
import { requireProductAccess } from '@/lib/requireUser'

const PAGE = '1175908668934802'
const ROOT = '122113311069337165_987654321'
const REPLY_OF_USER = '122113311069337165_111'

const graphOk = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const graphErr = (status: number, error: Record<string, unknown>) => ({ ok: false, status, json: async () => ({ error }) })

beforeEach(() => {
  h.state.comment = {
    commentId: ROOT,
    agencyId: 103,
    pageId: PAGE,
    postId: `${PAGE}_122113311069337165`,
    parentId: `${PAGE}_122113311069337165`,
    isTopLevel: true,
    status: 'open',
    authorIsPage: false,
    authorName: 'דוד כהן',
  }
  h.state.page = {
    id: 1,
    agency_id: 103,
    page_id: PAGE,
    page_name: 'העסק של דנה',
    page_access_token: sealPageAccessToken('PAGE-TOKEN-XYZ'),
    granted_scopes: JSON.stringify(['pages_show_list', 'pages_read_user_content', 'pages_manage_engagement']),
  }
  h.state.wheres = []
  h.state.inserts = []
  h.state.merges = []
  h.state.updates = []
  h.state.failMerge = false
  h.state.mergeAttempts = 0
  global.fetch = vi.fn(async () => graphOk({ id: '122113311069337165_555' })) as unknown as typeof fetch
})

describe('replyToComment — authorization and tenancy', () => {
  it('looks the comment up inside the caller\'s agency, and the Page by the COMMENT\'s page inside that agency', async () => {
    await replyToComment(ROOT, 'היי')
    expect(h.state.wheres).toContainEqual({ table: 'facebook_page_comments', w: { commentId: ROOT, agencyId: 103 } })
    expect(h.state.wheres).toContainEqual({ table: 'facebook_pages', w: { page_id: PAGE, agency_id: 103 } })
  })

  it('a comment id from another agency is simply not found — and Meta is never called', async () => {
    h.state.comment = null
    expect(await replyToComment(ROOT, 'היי')).toEqual({ ok: false, reason: 'not_found' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses when the Page grant lacks pages_manage_engagement', async () => {
    h.state.page!.granted_scopes = JSON.stringify(['pages_show_list', 'pages_read_user_content'])
    expect(await replyToComment(ROOT, 'היי')).toEqual({ ok: false, reason: 'permission_missing' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses a comment deleted on Facebook, and the Page\'s own reply', async () => {
    h.state.comment!.status = 'deleted'
    expect(await replyToComment(ROOT, 'היי')).toEqual({ ok: false, reason: 'deleted' })
    h.state.comment!.status = 'open'
    h.state.comment!.authorIsPage = true
    expect(await replyToComment(ROOT, 'היי')).toEqual({ ok: false, reason: 'page_authored' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects empty text without calling Meta', async () => {
    expect(await replyToComment(ROOT, '   ')).toEqual({ ok: false, reason: 'empty' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('an expired subscription propagates the entitlement error (not a misleading retry)', async () => {
    vi.mocked(requireProductAccess).mockRejectedValueOnce(new Error('subscription-required'))
    await expect(replyToComment(ROOT, 'היי')).rejects.toThrow('subscription-required')
  })
})

describe('replyToComment — the Graph call', () => {
  it('POSTs /{root-comment}/comments with the text; the token is in the header, never the URL', async () => {
    const result = await replyToComment(ROOT, '  תודה! שלחנו פרטים  ')
    expect(result).toEqual({ ok: true, replyId: '122113311069337165_555' })

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toContain(`/${encodeURIComponent(ROOT)}/comments?appsecret_proof=`)
    expect(url).not.toContain('PAGE-TOKEN-XYZ')
    expect(url).not.toContain('access_token')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer PAGE-TOKEN-XYZ')
    expect(JSON.parse(String(init.body))).toEqual({ message: 'תודה! שלחנו פרטים' })
  })

  it('a reply to a user REPLY is posted into its top-level thread', async () => {
    h.state.comment = { ...h.state.comment!, commentId: REPLY_OF_USER, parentId: ROOT, isTopLevel: false }
    await replyToComment(REPLY_OF_USER, 'היי')
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain(`/${encodeURIComponent(ROOT)}/comments`)
  })

  it('records the reply as a Page-authored thread entry, sent by this user, keyed by Meta\'s id', async () => {
    await replyToComment(ROOT, 'היי')
    const insert = h.state.inserts.find((i) => i.table === 'facebook_page_comments')!.row
    expect(insert).toMatchObject({
      agencyId: 103,
      pageId: PAGE,
      commentId: '122113311069337165_555',
      parentId: ROOT,
      authorIsPage: true,
      sentByUserId: 7,
      message: 'היי',
      messageAvailable: true,
      isTopLevel: false,
    })
    // Converges with the webhook echo: never rewrites tenancy.
    expect(h.state.merges[0]).not.toHaveProperty('agencyId')
    expect(h.state.merges[0]).not.toHaveProperty('pageId')
    expect(h.state.merges[0]).toMatchObject({ sentByUserId: 7, authorIsPage: true })
  })
})

describe('replyToComment — Meta errors become actionable reasons', () => {
  it.each([
    [graphErr(400, { code: 190, message: 'Error validating access token' }), 'reconnect_required'],
    [graphErr(403, { code: 200, message: 'Permissions error' }), 'permission_missing'],
    [graphErr(400, { code: 10, message: 'Permission denied' }), 'permission_missing'],
    [graphErr(400, { code: 100, error_subcode: 33, message: 'Object does not exist' }), 'comment_unavailable'],
    [graphErr(400, { code: 4, message: 'Application request limit reached' }), 'rate_limited'],
    [graphErr(400, { code: 368, message: 'Temporarily blocked' }), 'blocked'],
    [graphErr(500, { code: 1, message: 'Unknown' }), 'meta_error'],
  ])('%#: → %s, and nothing is recorded', async (response, reason) => {
    global.fetch = vi.fn(async () => response) as unknown as typeof fetch
    expect(await replyToComment(ROOT, 'היי')).toEqual({ ok: false, reason })
    expect(h.state.inserts.filter((i) => i.table === 'facebook_page_comments')).toHaveLength(0)
  })

  it('a dead token marks the Page disconnected so the reconnect banner appears', async () => {
    global.fetch = vi.fn(async () => graphErr(400, { code: 190 })) as unknown as typeof fetch
    await replyToComment(ROOT, 'היי')
    expect(h.state.updates).toContainEqual(expect.objectContaining({ health_status: 'token_expired' }))
  })

  it('a network failure is a retryable Meta error, not a crash', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('ECONNRESET')
    }) as unknown as typeof fetch
    expect(await replyToComment(ROOT, 'היי')).toEqual({ ok: false, reason: 'meta_error' })
  })

  it('published on Facebook but the local write failed → still ok (the webhook echo records it; no duplicate retry)', async () => {
    h.state.failMerge = true
    expect(await replyToComment(ROOT, 'היי')).toEqual({ ok: true, replyId: '122113311069337165_555' })
    expect(h.state.mergeAttempts).toBe(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
