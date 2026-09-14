/**
 * A reply sent from SocialCRM is recorded from the Graph response AND delivered
 * again on the `feed` webhook. Against a real Postgres, both arrival orders must
 * converge on ONE row that is Page-authored, remembers who sent it, keeps its
 * text, never notifies, and never enters the work list.
 *
 * Run: npm run test:db -- __tests__/facebookComments/replyDedup.db.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.FACEBOOK_COMMENTS_ENABLED = '1'
})
const notify = vi.hoisted(() => vi.fn(async () => ({ enqueued: false })))
vi.mock('@/lib/notifications/emit', () => ({ notifyEvent: notify }))

import { db } from '@/config/db'
import { ingestFacebookComment } from '@/lib/system/ingestFacebookComment'
import { recordPageReply } from '@/lib/facebook/comments/replies'
import { listCommentReplies, listPageComments } from '@/modules/facebookComments/queries'

const PAGE = '__rd_page__'
const OTHER_PAGE = '__rd_other_page__'
const POST = `${PAGE}_900`
const ROOT = '900_1'
const REPLY = '900_2'
let agency = 0
let otherAgency = 0
let user = 0

const userComment = { item: 'comment', verb: 'add', comment_id: ROOT, post_id: POST, parent_id: POST, from: { id: 'U1', name: 'דוד' }, message: 'כמה עולה?', created_time: 1_790_000_000 }
const pageEcho = (message?: string) => ({
  item: 'comment',
  verb: 'add',
  comment_id: REPLY,
  post_id: POST,
  parent_id: ROOT,
  from: { id: PAGE, name: 'העסק' },
  ...(message ? { message } : {}),
  created_time: 1_790_000_100,
})

const rows = () => db('facebook_page_comments').where({ pageId: PAGE }).orderBy('id')

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__test_reply_dedup__' }).returning('id')
  const [b] = await db('agencies').insert({ name: '__test_reply_dedup_other__' }).returning('id')
  agency = Number(a.id)
  otherAgency = Number(b.id)
  process.env.FACEBOOK_COMMENTS_AGENCY_ALLOWLIST = `${agency},${otherAgency}`
  const [u] = await db('users').insert({ firstName: 'R', role: 'ADMIN', agencyId: agency }).returning('id')
  const [u2] = await db('users').insert({ firstName: 'R2', role: 'ADMIN', agencyId: otherAgency }).returning('id')
  user = Number(u.id)
  await db('facebook_pages').insert([
    { user_id: user, agency_id: agency, page_id: PAGE, page_name: 'העסק', page_access_token: 'x' },
    { user_id: Number(u2.id), agency_id: otherAgency, page_id: OTHER_PAGE, page_name: 'אחר', page_access_token: 'x' },
  ])
})

beforeEach(async () => {
  notify.mockClear()
  await db('facebook_page_comments').whereIn('pageId', [PAGE, OTHER_PAGE]).del()
  expect(await ingestFacebookComment(PAGE, userComment)).toBe('ingested')
  notify.mockClear()
})

afterAll(async () => {
  await db('facebook_page_comments').whereIn('pageId', [PAGE, OTHER_PAGE]).del()
  await db('facebook_pages').whereIn('page_id', [PAGE, OTHER_PAGE]).del()
  await db('users').whereIn('agencyId', [agency, otherAgency]).del()
  await db('agencies').whereIn('id', [agency, otherAgency]).del()
  await db.destroy()
})

const reply = () =>
  recordPageReply({ agencyId: agency, pageId: PAGE, replyId: REPLY, postId: POST, rootCommentId: ROOT, message: 'שלחנו לך פרטים', sentByUserId: user, authorName: 'העסק' })

describe('reply recorded from the Graph response, and its webhook echo', () => {
  it('R1: response first, then echo (without text) → one row; sender and text survive; no alert', async () => {
    await reply()
    expect(await ingestFacebookComment(PAGE, pageEcho())).toBe('ingested')

    const replies = (await rows()).filter((r) => r.commentId === REPLY)
    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({ authorIsPage: true, sentByUserId: user, message: 'שלחנו לך פרטים', messageAvailable: true, agencyId: agency })
    expect(notify).not.toHaveBeenCalled()
  })

  it('R2: echo first, then the response → one row, now attributed to the sender', async () => {
    await ingestFacebookComment(PAGE, pageEcho('שלחנו לך פרטים'))
    await reply()

    const replies = (await rows()).filter((r) => r.commentId === REPLY)
    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({ authorIsPage: true, sentByUserId: user })
    expect(notify).not.toHaveBeenCalled()
  })

  it('R3: repeated echoes and repeated records stay one row', async () => {
    await reply()
    await ingestFacebookComment(PAGE, pageEcho('שלחנו לך פרטים'))
    await ingestFacebookComment(PAGE, pageEcho())
    await reply()
    expect((await rows()).filter((r) => r.commentId === REPLY)).toHaveLength(1)
  })

  it('R4: the Page reply is thread context: not in the work list, listed under its root, tenant-scoped', async () => {
    await reply()
    const list = await listPageComments(agency, { status: 'all' })
    expect(list.items.map((c) => c.commentId)).toEqual([ROOT])

    const thread = await listCommentReplies(agency, [{ pageId: PAGE, commentId: ROOT }])
    expect(thread.map((r) => r.commentId)).toEqual([REPLY])

    expect(await listCommentReplies(otherAgency, [{ pageId: PAGE, commentId: ROOT }])).toEqual([])
    expect(await listCommentReplies(agency, [{ pageId: OTHER_PAGE, commentId: ROOT }])).toEqual([])
  })

  it('R5: a comment written by the Page on Facebook itself is flagged and silent too', async () => {
    await ingestFacebookComment(PAGE, { ...pageEcho('תודה!'), comment_id: '900_3' })
    const [row] = (await rows()).filter((r) => r.commentId === '900_3')
    expect(row).toMatchObject({ authorIsPage: true, sentByUserId: null })
    expect(notify).not.toHaveBeenCalled()
  })

  it('R5b: a later event WITHOUT `from` never turns the Page\'s reply back into a work item', async () => {
    await reply()
    const { from: _from, ...withoutFrom } = pageEcho('שלחנו לך פרטים')
    await ingestFacebookComment(PAGE, withoutFrom)
    const [row] = (await rows()).filter((r) => r.commentId === REPLY)
    expect(row.authorIsPage).toBe(true)
    expect((await listPageComments(agency, { status: 'all' })).items.map((c) => c.commentId)).toEqual([ROOT])
  })

  it('R6: a real user comment still alerts once (unchanged behaviour)', async () => {
    await ingestFacebookComment(PAGE, { ...userComment, comment_id: '900_9', from: { id: 'U2', name: 'רות' } })
    expect(notify).toHaveBeenCalledTimes(1)
  })
})
