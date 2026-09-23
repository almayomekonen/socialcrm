/**
 * Message paging and conversation search, against a real Postgres.
 *
 * These are the two places where an off-by-one or a bad escape is invisible in
 * a unit test and obvious to a rep: a message silently skipped at a page
 * boundary, or a search that cannot find a customer whose name contains a
 * wildcard character.
 *
 * Run: npm run test:db -- __tests__/messenger/messengerPagingSearch.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.FACEBOOK_MESSENGER_ENABLED = '1'
})

import { db } from '@/config/db'
import {
  listMessengerConversations,
  listMessengerMessagePage,
  MESSENGER_LIST_LIMIT,
} from '@/modules/messenger/queries'

const PAGE = '__paging_page__'
let agencyId = 0
let userId = 0
let conversationId = 0

/** Message ids in the order they were created (oldest first). */
const created: number[] = []

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__test_paging__' }).returning('id')
  agencyId = Number(a.id)
  const [u] = await db('users').insert({ firstName: 'P', role: 'ADMIN', agencyId }).returning('id')
  userId = Number(u.id)
  await db('facebook_pages').insert({
    user_id: userId,
    agency_id: agencyId,
    page_id: PAGE,
    page_name: 'P',
    page_access_token: 'x',
    granted_scopes: JSON.stringify(['pages_messaging']),
  })

  const [c] = await db('messenger_conversations')
    .insert({ agencyId, pageId: PAGE, psid: '__paging_psid__', customerName: 'דנה לוי' })
    .returning('id')
  conversationId = Number(c.id)

  // 120 messages. Several deliberately SHARE a channelTimestamp: Meta's
  // resolution is seconds, so a timestamp-only cursor would skip or repeat one.
  const base = Date.parse('2026-09-20T08:00:00Z')
  for (let i = 0; i < 120; i++) {
    const [row] = await db('messenger_messages')
      .insert({
        conversationId,
        agencyId,
        pageId: PAGE,
        mid: `m_${i}`,
        direction: 'inbound',
        source: 'customer',
        text: `הודעה ${i}`,
        attachments: JSON.stringify([]),
        // Every pair shares a second.
        channelTimestamp: new Date(base + Math.floor(i / 2) * 1000),
      })
      .returning('id')
    created.push(Number(row.id))
  }
})

afterAll(async () => {
  await db('messenger_messages').where({ agencyId }).delete()
  await db('messenger_conversations').where({ agencyId }).delete()
  await db('facebook_pages').where({ agency_id: agencyId }).delete()
  await db('users').where({ agencyId }).delete()
  await db('agencies').where({ id: agencyId }).delete()
})

describe('message paging', () => {
  it('returns the NEWEST page first, oldest-first for reading, and reports more exist', async () => {
    const page = await listMessengerMessagePage(agencyId, conversationId, { limit: 50 })
    expect(page.messages).toHaveLength(50)
    expect(page.hasMore).toBe(true)
    // Oldest-first within the page: the last item is the newest message overall.
    expect(page.messages.at(-1)!.id).toBe(created.at(-1))
    expect(page.messages[0].id).toBe(created[created.length - 50])
  })

  it('walks the whole history with no duplicate and no gap, despite shared timestamps', async () => {
    const seen: number[] = []
    let cursor: number | undefined
    let guard = 0
    for (;;) {
      const page = await listMessengerMessagePage(agencyId, conversationId, { beforeId: cursor, limit: 50 })
      seen.unshift(...page.messages.map((m) => m.id))
      if (!page.hasMore || page.messages.length === 0) break
      cursor = page.messages[0].id
      if (++guard > 10) throw new Error('paging did not terminate')
    }

    expect(seen).toHaveLength(120)
    expect(new Set(seen).size).toBe(120)
    // Exactly the rows that exist, in creation order.
    expect(seen).toEqual(created)
  })

  it('hasMore is false on the last page rather than offering an empty one', async () => {
    const page = await listMessengerMessagePage(agencyId, conversationId, { beforeId: created[1], limit: 50 })
    expect(page.messages.map((m) => m.id)).toEqual([created[0]])
    expect(page.hasMore).toBe(false)
  })

  it('a cursor from another conversation positions nothing, rather than leaking its place', async () => {
    // The cursor row is resolved inside the same agency AND conversation, so a
    // foreign id cannot be used to probe where another thread's messages sit.
    const [other] = await db('messenger_conversations')
      .insert({ agencyId, pageId: PAGE, psid: '__cursor_probe__' })
      .returning('id')
    const otherConv = Number(other.id)
    const [foreign] = await db('messenger_messages')
      .insert({
        conversationId: otherConv,
        agencyId,
        pageId: PAGE,
        mid: 'm_foreign',
        direction: 'inbound',
        source: 'customer',
        text: 'x',
        attachments: JSON.stringify([]),
        channelTimestamp: new Date('2026-09-20T08:00:30Z'),
      })
      .returning('id')

    const page = await listMessengerMessagePage(agencyId, conversationId, { beforeId: Number(foreign.id), limit: 50 })
    expect(page.messages).toEqual([])

    await db('messenger_messages').where({ conversationId: otherConv }).delete()
    await db('messenger_conversations').where({ id: otherConv }).delete()
  })

  it('never reads across tenants, even with a valid conversation id', async () => {
    const [other] = await db('agencies').insert({ name: '__test_paging_other__' }).returning('id')
    const page = await listMessengerMessagePage(Number(other.id), conversationId, { limit: 50 })
    expect(page.messages).toEqual([])
    await db('agencies').where({ id: Number(other.id) }).delete()
  })
})

describe('conversation search', () => {
  it('matches the contact name and the last message, and is case-insensitive', async () => {
    await db('messenger_conversations')
      .where({ id: conversationId })
      .update({ lastMessageText: 'מתעניין בחבילת PREMIUM', lastMessageAt: new Date() })

    expect((await listMessengerConversations(agencyId, userId, 'דנה')).map((c) => c.id)).toEqual([conversationId])
    expect((await listMessengerConversations(agencyId, userId, 'premium')).map((c) => c.id)).toEqual([conversationId])
    expect(await listMessengerConversations(agencyId, userId, 'לא-קיים')).toEqual([])
  })

  it('treats % and _ as literal characters, not wildcards', async () => {
    const [c] = await db('messenger_conversations')
      .insert({ agencyId, pageId: PAGE, psid: '__wild__', customerName: '100% דיסקונט' })
      .returning('id')
    const wildId = Number(c.id)

    // A bare '%' must not match every conversation.
    const bare = await listMessengerConversations(agencyId, userId, '%')
    expect(bare.map((x) => x.id)).toEqual([wildId])
    // And the literal string still finds it.
    expect((await listMessengerConversations(agencyId, userId, '100%')).map((x) => x.id)).toEqual([wildId])

    await db('messenger_conversations').where({ id: wildId }).delete()
  })

  it('an empty or whitespace query is not a filter', async () => {
    const all = await listMessengerConversations(agencyId, userId, '')
    const blank = await listMessengerConversations(agencyId, userId, '   ')
    expect(all.length).toBeGreaterThan(0)
    expect(blank.map((c) => c.id)).toEqual(all.map((c) => c.id))
  })

  it('searches the agency\'s whole history, not only what a page would show', async () => {
    // The list page is 50. Bury the target under MORE than that many newer
    // conversations, so a filter applied over the loaded page (rather than in
    // SQL) would genuinely fail to find it — which is the bug this guards.
    const filler: number[] = []
    for (let i = 0; i < MESSENGER_LIST_LIMIT + 10; i++) {
      const [row] = await db('messenger_conversations')
        .insert({
          agencyId,
          pageId: PAGE,
          psid: `__filler_${i}__`,
          customerName: `ממלא ${i}`,
          lastMessageAt: new Date(Date.parse('2026-09-21T00:00:00Z') + i * 1000),
        })
        .returning('id')
      filler.push(Number(row.id))
    }

    const [old] = await db('messenger_conversations')
      .insert({
        agencyId,
        pageId: PAGE,
        psid: '__ancient__',
        customerName: 'אברהם קדומי',
        lastMessageAt: new Date('2020-01-01T00:00:00Z'),
      })
      .returning('id')
    const oldId = Number(old.id)

    // Not on the first unfiltered page...
    const firstPage = await listMessengerConversations(agencyId, userId, '')
    expect(firstPage).toHaveLength(MESSENGER_LIST_LIMIT)
    expect(firstPage.map((c) => c.id)).not.toContain(oldId)

    // ...but the search still finds it.
    const found = await listMessengerConversations(agencyId, userId, 'קדומי')
    expect(found.map((c) => c.id)).toEqual([oldId])

    await db('messenger_conversations').whereIn('id', [...filler, oldId]).delete()
  })
})
