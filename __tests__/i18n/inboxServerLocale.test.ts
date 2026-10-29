import { afterEach, describe, expect, test, vi } from 'vitest'

/**
 * Server side of the inbox's follow-up list reads: the `locale` a desktop
 * client sends back reaches the row mapper and selects display strings only.
 * Anything outside the registry is Hebrew; omitting it is exactly the old call.
 */

const Q = vi.hoisted(() => ({
  delta: vi.fn(async (..._a: unknown[]) => ({ changed: [], full: false })),
  awareness: vi.fn(async (..._a: unknown[]) => ({ counts: { whatsappUnread: 0 }, items: [] })),
  list: vi.fn(async (..._a: unknown[]) => ({ items: [], nextCursor: null })),
}))

vi.mock('@/db/auth', () => ({ getUser: async () => ({ id: 7, agencyId: 103 }) }))
vi.mock('@/lib/requireUser', () => ({ requireAgencyUser: async () => ({ id: 7, agencyId: 103 }) }))
vi.mock('@/config/db', () => ({ db: () => ({}) }))
vi.mock('@/db/inboxMessages', () => ({ getConversationMessagesAfter: async () => [], getConversationOutboundStatuses: async () => [] }))
vi.mock('@/db/conversationHumanPresence', () => ({ recordHumanTyping: async () => true }))
vi.mock('@/db/inboxConversationReads', () => ({ markConversationRead: async () => true }))
vi.mock('@/db/inboxConversations', () => ({ deleteConversation: async () => ({ deleted: true }) }))
vi.mock('@/lib/inbox/ensureWhatsappConversation', () => ({ ensureWhatsappConversationForLead: async () => ({ ok: false }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/modules/inbox/queries', () => ({
  getInboxDelta: Q.delta,
  getInboxAwareness: Q.awareness,
  listInboxConversations: Q.list,
  getInboxConversationByLeadId: async () => null,
}))

afterEach(() => {
  Q.delta.mockClear()
  Q.list.mockClear()
})

const sync = async (qs: string) => {
  const { GET } = await import('@/app/api/inbox/sync/route')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  await GET(new Request(`http://x.test/api/inbox/sync?${qs}`) as never)
  return Q.delta.mock.calls.at(-1)!
}

describe('/api/inbox/sync', () => {
  test('a registered locale reaches the delta mapper; none / unknown is Hebrew', async () => {
    expect((await sync('since=2026-10-28T09:00:00.000Z&locale=ar')).at(-1)).toBe('ar')
    expect((await sync('since=2026-10-28T09:00:00.000Z')).at(-1)).toBe('he')
    expect((await sync('since=2026-10-28T09:00:00.000Z&locale=fr')).at(-1)).toBe('he')
  })

  test('the filters read from the URL are the same with or without the locale', async () => {
    const withLocale = await sync('since=s&status=open&unread=1&intel=hot&locale=en')
    const without = await sync('since=s&status=open&unread=1&intel=hot')
    expect(withLocale.slice(0, 4)).toEqual(without.slice(0, 4))
  })
})

describe('loadMoreInboxConversations', () => {
  test('passes a registered locale; drops anything else to Hebrew; same cursor and filters', async () => {
    const { loadMoreInboxConversations } = await import('@/modules/inbox/actions')
    const cursor = { lastMessageAt: '2026-10-27T09:00:00.000Z', id: 3, unread: false }
    await loadMoreInboxConversations({ cursor, filters: { status: 'open' } })
    await loadMoreInboxConversations({ cursor, filters: { status: 'open' }, locale: 'en' })
    await loadMoreInboxConversations({ cursor, filters: { status: 'open' }, locale: 'xx' })
    expect(Q.list.mock.calls).toEqual([
      [103, 7, { cursor, filters: { status: 'open' }, locale: 'he' }],
      [103, 7, { cursor, filters: { status: 'open' }, locale: 'en' }],
      [103, 7, { cursor, filters: { status: 'open' }, locale: 'he' }],
    ])
  })
})

describe('mapInboxRow', () => {
  test('only the two presentation strings follow the locale', async () => {
    const { mapInboxRow } = await import('@/modules/inbox/mapInboxRow')
    const { LIST_ROWS, NOW } = await import('./inboxEnv')
    for (const row of LIST_ROWS) {
      const he = mapInboxRow(row, NOW)
      const en = mapInboxRow(row, NOW, 'en')
      const strip = ({ waitingTitle: _a, waitingWindowHint: _b, ...rest }: typeof he) => rest
      expect(strip(en)).toEqual(strip(he))
      expect(mapInboxRow(row, NOW, 'he')).toEqual(he)
    }
    expect(mapInboxRow(LIST_ROWS[0], NOW, 'en')).toMatchObject({
      waitingTitle: 'Waiting for your reply · 2 hours',
      waitingWindowHint: '22 hours left in the WhatsApp window',
    })
  })
})
