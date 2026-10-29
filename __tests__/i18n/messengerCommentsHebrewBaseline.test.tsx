// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import type { ReactNode } from 'react'
import {
  EXPIRED,
  MC_USER,
  NOW,
  PAGE_MESSENGER,
  PAGE_NO_MESSENGER,
  PAGE_NO_REPLIES,
  PAGE_REPLIES,
  resetMessengerCommentsEnv,
} from './messengerCommentsEnv'
import { commentsScreen, messengerScreen, routeChrome } from './messengerCommentsHarness'
import { resetMcSpies } from './messengerCommentsMocks'

/**
 * HEBREW BASELINE for the Messenger and Comments inbox (`/inbox/messenger`,
 * `/inbox/comments`): the REAL server pages (async server components resolved in
 * place) in every page-level state, the thread with every bubble / event /
 * receipt, the composer states, the comments feed under each filter, the reply
 * permission prompts, the locked states, the phone branches, loading.tsx and
 * error.tsx. Recorded against the code BEFORE the Phase D Messenger/Comments
 * package; every Hebrew render must still match byte-for-byte afterwards.
 * Interactions: messengerCommentsHebrewBaselineInteractions; label producers:
 * messengerCommentsHebrewBaselineProducers.
 *
 * Only I/O is mocked. Rendered with NO i18n provider, i.e. exactly what a Hebrew
 * user receives today. Normalized: React's `<!-- -->` separators and `useId` values.
 */

vi.mock('next/navigation', async () => (await import('./messengerCommentsMocks')).navigationModule())
vi.mock('next/server', async () => (await import('./messengerCommentsMocks')).nextServerModule())
vi.mock('next/cache', async () => (await import('./inboxMocks')).cacheModule())
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./messengerCommentsEnv')).messengerEnv.user }))
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: null, agencyLocale: null }) }))
vi.mock('@/config/db', async () => (await import('./messengerCommentsMocks')).dbModule())
vi.mock('@/lib/device', async () => (await import('./messengerCommentsMocks')).deviceModule())
vi.mock('@/lib/facebook/permissions', async () => (await import('./messengerCommentsMocks')).permissionsModule())
vi.mock('@/lib/facebook/comments/capability', async () => (await import('./messengerCommentsMocks')).capabilityModule())
vi.mock('@/modules/messenger/queries', async () => (await import('./messengerCommentsMocks')).messengerQueriesModule())
vi.mock('@/db/messengerSavedReplies', async () => (await import('./messengerCommentsMocks')).savedRepliesModule())
vi.mock('@/lib/facebook/messenger/deliveryCheck', async () => (await import('./messengerCommentsMocks')).deliveryModule())
vi.mock('@/lib/facebook/messenger/profile', async () => (await import('./messengerCommentsMocks')).profileModule())
vi.mock('@/modules/messenger/actions', async () => (await import('./messengerCommentsMocks')).messengerActionsModule())
vi.mock('@/modules/messenger/leadActions', async () => (await import('./messengerCommentsMocks')).messengerLeadActionsModule())
vi.mock('@/modules/messenger/profileActions', async () => (await import('./messengerCommentsMocks')).messengerProfileActionsModule())
vi.mock('@/modules/facebookComments/queries', async () => (await import('./messengerCommentsMocks')).commentsQueriesModule())
vi.mock('@/modules/facebookComments/feed', async () => (await import('./messengerCommentsMocks')).feedModule())
vi.mock('@/lib/facebook/comments/enrich', async () => (await import('./messengerCommentsMocks')).enrichModule())
vi.mock('@/modules/facebookComments/actions', async () => (await import('./messengerCommentsMocks')).commentsActionsModule())
vi.mock('@/modules/facebookComments/replyActions', async () => (await import('./messengerCommentsMocks')).replyActionsModule())
vi.mock('@/modules/facebookComments/listActions', async () => (await import('./messengerCommentsMocks')).listActionsModule())
vi.mock('@/actions/clients', () => ({ searchLeads: async () => [] }))
vi.mock('@/lib/toast', async () => (await import('./messengerCommentsMocks')).toastModule())

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const renderToString = (node: ReactNode) => normalizeIds(renderRaw(<>{node}</>).replaceAll('<!-- -->', ''))
type M = Parameters<typeof messengerScreen>[1]
type C = Parameters<typeof commentsScreen>[1]
const messenger = async (o: M = {}, sp: Record<string, string> = {}, ent?: typeof EXPIRED) =>
  renderToString(await messengerScreen(null, o, sp, ent))
const comments = async (o: C = {}, sp: Record<string, string> = {}, ent?: typeof EXPIRED) =>
  renderToString(await commentsScreen(null, o, sp, ent))
const REP = { ...MC_USER, role: 'REP' }
const HOUR = 3_600_000

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  resetMessengerCommentsEnv()
  resetMcSpies()
})

describe('Hebrew baseline — /inbox/messenger page-level states (server HTML)', () => {
  test('not enabled, no Page, permission missing / declined', async () => {
    expect({
      notEnabled: await messenger({ enabled: false }),
      notConnected: await messenger({ pages: [] }),
      permission: await messenger({ pages: [PAGE_NO_MESSENGER] }),
      declined: await messenger({ pages: [PAGE_NO_MESSENGER] }, { permission: 'missing' }),
      repPermission: await messenger({ pages: [PAGE_NO_MESSENGER], user: REP }),
    }).toMatchSnapshot()
  })

  test('connected, no conversations: ready (+ import offer, + granted), not subscribed, reconnect, rep; search without results', async () => {
    expect({
      ready: await messenger({ conversations: [] }),
      granted: await messenger({ conversations: [] }, { permission: 'granted' }),
      notSubscribed: await messenger({ conversations: [], delivery: 'not_subscribed' }),
      reconnect: await messenger({ conversations: [], delivery: 'reconnect' }),
      rep: await messenger({ conversations: [], user: REP }),
      noResults: await messenger({ conversations: [] }, { q: 'משהו' }),
    }).toMatchSnapshot()
  })

  test('populated list, nothing selected (unread, outbound, nameless, profile-access notice); rep sees no notice', async () => {
    expect({ admin: await messenger(), rep: await messenger({ user: REP }), search: await messenger({}, { q: 'מבצע' }) }).toMatchSnapshot()
  })
})

describe('Hebrew baseline — /inbox/messenger selected thread (server HTML)', () => {
  test('every bubble, attachment, receipt, source label, event line and reaction; window open; saved replies; earlier messages', async () => {
    expect(await messenger({ selectedId: 1, hasMore: true, selectedOverrides: { lastInboundAt: new Date(NOW - 2 * HOUR) } })).toMatchSnapshot()
  })

  test('window closed, window closing within the hour, Page cannot send, nameless leadless contact, no saved replies', async () => {
    expect({
      closed: await messenger({ selectedId: 1, selectedOverrides: { lastInboundAt: new Date(NOW - 30 * HOUR) } }),
      lastHour: await messenger({ selectedId: 1, selectedOverrides: { lastInboundAt: new Date(NOW - 23.5 * HOUR) } }),
      cannotSend: await messenger({
        selectedId: 1,
        pages: [PAGE_MESSENGER, PAGE_NO_MESSENGER],
        selectedOverrides: { pageId: 'p2', lastInboundAt: new Date(NOW - HOUR) },
      }),
      nameless: await messenger({ selectedId: 3, savedReplies: [], messages: [], events: [], selectedOverrides: { lastInboundAt: new Date(NOW - HOUR) } }),
    }).toMatchSnapshot()
  })

  test('expired subscription: composer and lead actions locked', async () => {
    expect(await messenger({ selectedId: 2, selectedOverrides: { lastInboundAt: new Date(NOW - HOUR) } }, {}, EXPIRED)).toMatchSnapshot()
  })

  test('phone branch: list, and a selected thread', async () => {
    expect({
      list: await messenger({ mobile: true }),
      thread: await messenger({ mobile: true, selectedId: 1, selectedOverrides: { lastInboundAt: new Date(NOW - HOUR) } }),
      empty: await messenger({ mobile: true, enabled: false }),
    }).toMatchSnapshot()
  })
})

describe('Hebrew baseline — /inbox/comments (server HTML)', () => {
  test('not enabled, no Page, no comments; filtered empty (open, converted)', async () => {
    expect({
      notEnabled: await comments({ enabled: false }),
      notConnected: await comments({ pages: [] }),
      none: await comments({ items: [] }),
      noOpen: await comments({ items: [] }, { status: 'open' }),
      noConverted: await comments({ items: [] }, { status: 'converted' }),
    }).toMatchSnapshot()
  })

  test('feed under each filter: every comment state, post context, thread, convert / open lead, reply, load more', async () => {
    expect({
      all: await comments({ nextCursor: { receivedAt: '2026-10-27T00:00:00.000Z', id: 1 } }),
      open: await comments({}, { status: 'open' }),
      converted: await comments({ openCount: 120 }, { status: 'converted' }),
    }).toMatchSnapshot()
  })

  test('reply permission: prompt, declined, granted, rep; replies not rolled out', async () => {
    const mixed = [PAGE_REPLIES, PAGE_NO_REPLIES]
    expect({
      prompt: await comments({ pages: mixed }),
      declined: await comments({ pages: mixed }, { permission: 'missing' }),
      granted: await comments({}, { permission: 'granted' }),
      repliesOff: await comments({ repliesEnabled: false }),
    }).toMatchSnapshot()
  })

  test('rep prompt; expired subscription (convert locked)', async () => {
    const { messengerEnv } = await import('./messengerCommentsEnv')
    messengerEnv.user = REP
    const rep = await comments({ pages: [PAGE_REPLIES, PAGE_NO_REPLIES] })
    messengerEnv.user = MC_USER
    expect({ rep, expired: await comments({}, {}, EXPIRED) }).toMatchSnapshot()
  })

  test('phone branch: not enabled, no Page, feed', async () => {
    expect({
      notEnabled: await comments({ enabled: false, mobile: true }),
      notConnected: await comments({ pages: [], mobile: true }),
      feed: await comments({ mobile: true }),
    }).toMatchSnapshot()
  })
})

describe('Hebrew baseline — route loading and error boundaries', () => {
  test('loading.tsx (desktop) and error.tsx, Messenger and Comments', async () => {
    const out: Record<string, string> = {}
    for (const route of ['messenger', 'comments'] as const) {
      const { Loading, ErrorBoundary } = await routeChrome(route)
      out[`${route}Loading`] = renderToString(<Loading />)
      out[`${route}Error`] = renderToString(<ErrorBoundary error={new Error('x')} reset={() => {}} />)
    }
    expect(out).toMatchSnapshot()
  })
})
