/**
 * Comment context against a real Postgres: what the webhook stores, what the
 * bounded Graph enrichment adds, and that neither ever crosses a tenant.
 *
 * Graph is a fetch stub; the database, the upserts and the tenant predicates
 * are real. Run: npm run test:db -- __tests__/facebookComments/commentContext.db.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.FACEBOOK_COMMENTS_ENABLED = '1'
})
vi.mock('@/lib/notifications/emit', () => ({ notifyEvent: vi.fn(async () => ({ enqueued: false })) }))

import { db } from '@/config/db'
import { ingestFacebookComment } from '@/lib/system/ingestFacebookComment'
import { POST_REFRESH_BATCH, refreshCommentContext } from '@/lib/facebook/comments/enrich'
import { listCommentPosts } from '@/modules/facebookComments/queries'
import { loadCommentsFeedPage } from '@/modules/facebookComments/feed'

const PAGE = '__cc_page__'
const OTHER_PAGE = '__cc_other_page__'
const TOKEN = 'cc-token-agency-a'
const OTHER_TOKEN = 'cc-token-agency-b'
let agency = 0
let otherAgency = 0

const comment = (over: Record<string, unknown> = {}) => ({
  item: 'comment',
  verb: 'add',
  comment_id: '700_1',
  post_id: `${PAGE}_700`,
  parent_id: `${PAGE}_700`,
  from: { id: 'PSID_DANA', name: 'דנה לוי' },
  message: 'כמה זה עולה?',
  created_time: 1_790_000_000,
  ...over,
})

type Call = { path: string; auth: string }
function graph(handlers: { post?: () => Response; picture?: () => Response } = {}) {
  const calls: Call[] = []
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url)
    calls.push({ path: u.pathname, auth: String((init?.headers as Record<string, string>)?.Authorization) })
    if (u.pathname.endsWith('/picture')) {
      return handlers.picture?.() ?? Response.json({ data: { url: 'https://scontent.xx.fbcdn.net/dana.jpg', is_silhouette: false } })
    }
    return (
      handlers.post?.() ??
      Response.json({ message: 'מבצע סוף עונה', full_picture: 'https://scontent.xx.fbcdn.net/post.jpg', permalink_url: 'https://www.facebook.com/x/posts/700' })
    )
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

const rowIds = async (pageId = PAGE) =>
  (await db('facebook_page_comments').where({ pageId }).select('id')).map((r) => Number(r.id))

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__test_comment_context__' }).returning('id')
  const [b] = await db('agencies').insert({ name: '__test_comment_context_other__' }).returning('id')
  agency = Number(a.id)
  otherAgency = Number(b.id)
  process.env.FACEBOOK_COMMENTS_AGENCY_ALLOWLIST = `${agency},${otherAgency}`
  const [u] = await db('users').insert({ firstName: 'A', role: 'ADMIN', agencyId: agency }).returning('id')
  const [u2] = await db('users').insert({ firstName: 'B', role: 'ADMIN', agencyId: otherAgency }).returning('id')
  await db('facebook_pages').insert([
    { user_id: Number(u.id), agency_id: agency, page_id: PAGE, page_name: 'העסק', page_access_token: TOKEN },
    { user_id: Number(u2.id), agency_id: otherAgency, page_id: OTHER_PAGE, page_name: 'אחר', page_access_token: OTHER_TOKEN },
  ])
})

beforeEach(async () => {
  await db('facebook_page_comments').whereIn('pageId', [PAGE, OTHER_PAGE]).del()
  await db('facebook_page_posts').whereIn('pageId', [PAGE, OTHER_PAGE]).del()
})

afterAll(async () => {
  await db('facebook_page_comments').whereIn('pageId', [PAGE, OTHER_PAGE]).del()
  await db('facebook_page_posts').whereIn('pageId', [PAGE, OTHER_PAGE]).del()
  await db('facebook_pages').whereIn('page_id', [PAGE, OTHER_PAGE]).del()
  await db('users').whereIn('agencyId', [agency, otherAgency]).del()
  await db('agencies').whereIn('id', [agency, otherAgency]).del()
})

describe('webhook → stored context (no Graph call)', () => {
  it('keeps an attached photo and the post permalink the webhook carried', async () => {
    await ingestFacebookComment(
      PAGE,
      comment({
        photo: 'https://scontent.xx.fbcdn.net/attached.jpg',
        post: { permalink_url: 'https://www.facebook.com/x/posts/700', status_type: 'added_photos' },
      }),
    )
    const row = await db('facebook_page_comments').where({ pageId: PAGE }).first()
    expect(row).toMatchObject({ attachmentType: 'photo', attachmentUrl: 'https://scontent.xx.fbcdn.net/attached.jpg' })
    const post = await db('facebook_page_posts').where({ agencyId: agency, pageId: PAGE, postId: `${PAGE}_700` }).first()
    expect(post).toMatchObject({ permalinkUrl: 'https://www.facebook.com/x/posts/700', statusType: 'added_photos', fetchStatus: null })
  })

  it('a redelivery without the attachment or permalink never blanks them', async () => {
    await ingestFacebookComment(
      PAGE,
      comment({ photo: 'https://scontent.xx.fbcdn.net/attached.jpg', post: { permalink_url: 'https://www.facebook.com/x/posts/700' } }),
    )
    await ingestFacebookComment(PAGE, comment({ verb: 'edited', message: 'עודכן' }))
    const row = await db('facebook_page_comments').where({ pageId: PAGE }).first()
    expect(row).toMatchObject({ message: 'עודכן', attachmentUrl: 'https://scontent.xx.fbcdn.net/attached.jpg' })
    const post = await db('facebook_page_posts').where({ pageId: PAGE }).first()
    expect(post.permalinkUrl).toBe('https://www.facebook.com/x/posts/700')
  })
})

describe('refreshCommentContext — enrichment', () => {
  it('fills post context and the commenter picture, once per post and once per commenter', async () => {
    await ingestFacebookComment(PAGE, comment())
    await ingestFacebookComment(PAGE, comment({ comment_id: '700_2', message: 'גם אני' }))
    const g = graph()

    expect(await refreshCommentContext({ agencyId: agency, commentRowIds: await rowIds(), fetchImpl: g.fetchImpl })).toEqual({
      posts: 1,
      authors: 1,
    })
    expect(g.calls).toHaveLength(2)
    expect(g.calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true)

    const [post] = await listCommentPosts(agency, [{ pageId: PAGE, postId: `${PAGE}_700` }])
    expect(post).toMatchObject({ message: 'מבצע סוף עונה', pictureUrl: 'https://scontent.xx.fbcdn.net/post.jpg', fetchStatus: 'ok' })
    const pics = await db('facebook_page_comments').where({ pageId: PAGE }).pluck('authorPictureUrl')
    expect(pics).toEqual(['https://scontent.xx.fbcdn.net/dana.jpg', 'https://scontent.xx.fbcdn.net/dana.jpg'])
  })

  it('within the TTL a second pass makes no Graph call at all', async () => {
    await ingestFacebookComment(PAGE, comment())
    await refreshCommentContext({ agencyId: agency, commentRowIds: await rowIds(), fetchImpl: graph().fetchImpl })
    const again = graph()
    await refreshCommentContext({ agencyId: agency, commentRowIds: await rowIds(), fetchImpl: again.fetchImpl })
    expect(again.calls).toHaveLength(0)
  })

  it("Meta's silhouette is recorded as 'none' with no URL", async () => {
    await ingestFacebookComment(PAGE, comment())
    const g = graph({ picture: () => Response.json({ data: { url: 'https://scontent.xx.fbcdn.net/s.jpg', is_silhouette: true } }) })
    await refreshCommentContext({ agencyId: agency, commentRowIds: await rowIds(), fetchImpl: g.fetchImpl })
    expect(await db('facebook_page_comments').where({ pageId: PAGE }).first()).toMatchObject({
      authorPictureUrl: null,
      authorPictureStatus: 'none',
    })
  })

  it('a deleted post is recorded as unavailable and never asked about again', async () => {
    await ingestFacebookComment(PAGE, comment({ post: { permalink_url: 'https://www.facebook.com/x/posts/700' } }))
    const gone = graph({ post: () => Response.json({ error: { code: 100, error_subcode: 33, message: 'x' } }, { status: 400 }) })
    await refreshCommentContext({ agencyId: agency, commentRowIds: await rowIds(), fetchImpl: gone.fetchImpl })
    const post = await db('facebook_page_posts').where({ pageId: PAGE }).first()
    // The status is recorded; what the webhook already told us is kept.
    expect(post).toMatchObject({ fetchStatus: 'unavailable', permalinkUrl: 'https://www.facebook.com/x/posts/700' })

    const later = graph()
    await refreshCommentContext({ agencyId: agency, commentRowIds: await rowIds(), now: new Date(Date.now() + 30 * 86_400_000), fetchImpl: later.fetchImpl })
    expect(later.calls.filter((c) => !c.path.endsWith('/picture'))).toHaveLength(0)
  })

  it('a Graph outage records nothing, throws nothing, and leaves the comment intact', async () => {
    await ingestFacebookComment(PAGE, comment())
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    await expect(refreshCommentContext({ agencyId: agency, commentRowIds: await rowIds(), fetchImpl: down })).resolves.toEqual({
      posts: 0,
      authors: 0,
    })
    expect(await db('facebook_page_posts').where({ pageId: PAGE }).whereNotNull('fetchStatus').first()).toBeUndefined()
    expect(await db('facebook_page_comments').where({ pageId: PAGE }).first()).toMatchObject({ message: 'כמה זה עולה?', authorPictureStatus: null })
  })

  it('is bounded: one pass reads at most POST_REFRESH_BATCH posts', async () => {
    for (let i = 0; i < POST_REFRESH_BATCH + 3; i++) {
      await ingestFacebookComment(PAGE, comment({ comment_id: `80${i}_1`, post_id: `${PAGE}_80${i}`, parent_id: `${PAGE}_80${i}` }))
    }
    const g = graph()
    await refreshCommentContext({ agencyId: agency, commentRowIds: await rowIds(), fetchImpl: g.fetchImpl })
    expect(g.calls.filter((c) => !c.path.endsWith('/picture'))).toHaveLength(POST_REFRESH_BATCH)
  })
})

describe('tenant isolation', () => {
  it("another agency's comments are neither read nor written, and its token is never sent", async () => {
    await ingestFacebookComment(PAGE, comment())
    await ingestFacebookComment(OTHER_PAGE, comment({ post_id: `${OTHER_PAGE}_700`, parent_id: `${OTHER_PAGE}_700` }))
    const g = graph()

    // Agency A asks about agency B's row ids: nothing happens.
    await refreshCommentContext({ agencyId: agency, commentRowIds: await rowIds(OTHER_PAGE), fetchImpl: g.fetchImpl })
    expect(g.calls).toHaveLength(0)

    await refreshCommentContext({ agencyId: agency, commentRowIds: [...(await rowIds()), ...(await rowIds(OTHER_PAGE))], fetchImpl: g.fetchImpl })
    expect(g.calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true)
    // Same commenter id on B's Page: untouched.
    expect(await db('facebook_page_comments').where({ pageId: OTHER_PAGE }).first()).toMatchObject({ authorPictureUrl: null })
    expect(await db('facebook_page_posts').where({ pageId: OTHER_PAGE, agencyId: agency }).first()).toBeUndefined()
  })

  it("listCommentPosts never returns another agency's post", async () => {
    await db('facebook_page_posts').insert({ agencyId: otherAgency, pageId: OTHER_PAGE, postId: 'P', message: 'סוד' })
    expect(await listCommentPosts(agency, [{ pageId: OTHER_PAGE, postId: 'P' }])).toEqual([])
    expect(await listCommentPosts(otherAgency, [{ pageId: OTHER_PAGE, postId: 'P' }])).toHaveLength(1)
  })
})

describe('legacy rows', () => {
  it('a comment stored before any of this renders with empty context, not an error', async () => {
    await db('facebook_page_comments').insert({
      agencyId: agency,
      pageId: PAGE,
      commentId: 'LEGACY_1',
      postId: `${PAGE}_LEGACY`,
      parentId: `${PAGE}_LEGACY`,
      authorName: 'ישן',
      message: '',
      messageAvailable: false,
    })
    const page = await loadCommentsFeedPage(agency, { status: 'all' })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({ authorPictureUrl: null, attachmentUrl: null, messageAvailable: false })
    expect(page.posts).toEqual([])
  })
})
