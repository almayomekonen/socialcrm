import type { Surface } from './surfaces'
import type { Allowance } from './leakScan'
import {
  CONVERSATIONS,
  COMMENTS,
  EVENTS,
  EXPIRED,
  MC_CUSTOMER_DATA,
  MESSAGES,
  NOW,
  PAGE_MESSENGER,
  PAGE_NO_MESSENGER,
  PAGE_NO_REPLIES,
  PAGE_REPLIES,
  POSTS,
  REPLIES,
} from './messengerCommentsEnv'
import { commentsScreen, messengerScreen, routeChrome } from './messengerCommentsHarness'
import { inboxShell } from './inboxHarness'

/**
 * Leak-gate registrations for `/inbox/messenger` and `/inbox/comments` (desktop,
 * Phase D). Spread into SURFACES (surfaces.tsx); rendering relies on the mocks in
 * leakGate.test.tsx. Interactions (toasts, failures, the picker, the reply form)
 * are opened and scanned in messengerCommentsLocales.test.tsx.
 */

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
const INITIALS = [
  ...CONVERSATIONS.map((c) => c.leadName ?? c.customerName),
  ...COMMENTS.map((c) => c.authorName),
]
  .filter((n): n is string => typeof n === 'string')
  .map(initials)

/** Only declared fixture data — the customer's or the Page's own text — may be allowed. */
function mcData(...texts: (string | null | undefined)[]): Allowance[] {
  return [...new Set(texts.filter((t): t is string => typeof t === 'string' && /[֐-׿]/.test(t)))].map((text) => {
    if (MC_CUSTOMER_DATA.includes(text) || INITIALS.includes(text)) return { text, reason: 'customer-data' as const }
    throw new Error(`not declared as Messenger/Comments fixture data: ${text}`)
  })
}

const HOUR = 3_600_000
const OPEN = { lastInboundAt: new Date(NOW - 2 * HOUR) }
const ROWS = CONVERSATIONS.flatMap((c) => [c.customerName, c.leadName, c.lastMessageText])
const ROW_INITIALS = ['נב', 'אש']
const THREAD = [...MESSAGES.map((m) => m.text), ...EVENTS.map((e) => e.title), 'המבצע של החודש']
const FEED = [
  ...COMMENTS.flatMap((c) => [c.authorName, c.message]),
  ...INITIALS.filter((i) => COMMENTS.some((c) => c.authorName && initials(c.authorName) === i)),
  ...POSTS.map((p) => p.message),
  ...REPLIES.flatMap((r) => [r.authorName, r.message]),
]
const REP = { id: 7, name: 'דנה כהן', role: 'REP', agencyId: 103 }

const messenger = (o: Parameters<typeof messengerScreen>[1] = {}, sp: Record<string, string> = {}, ent?: typeof EXPIRED) =>
  async (locale: 'he' | 'en' | 'ar') => messengerScreen(locale, o, sp, ent)
const comments = (o: Parameters<typeof commentsScreen>[1] = {}, sp: Record<string, string> = {}, ent?: typeof EXPIRED) =>
  async (locale: 'he' | 'en' | 'ar') => commentsScreen(locale, o, sp, ent)
const all = (...renders: ((l: 'he' | 'en' | 'ar') => Promise<React.ReactElement>)[]) => async (locale: 'he' | 'en' | 'ar') => {
  // Built one after another: each build sets the shared fixture state.
  const out = []
  for (const r of renders) out.push(await r(locale))
  return <>{out.map((node, i) => <div key={i}>{node}</div>)}</>
}

export const MESSENGER_COMMENTS_SURFACES: Surface[] = [
  {
    name: 'messenger — not enabled, no Page, permission missing / declined, rep',
    route: '/inbox/messenger',
    render: all(
      messenger({ enabled: false }),
      messenger({ pages: [] }),
      messenger({ pages: [PAGE_NO_MESSENGER] }),
      messenger({ pages: [PAGE_NO_MESSENGER] }, { permission: 'missing' }),
      messenger({ pages: [PAGE_NO_MESSENGER], user: REP }),
    ),
    allowed: [],
  },
  {
    name: 'messenger — connected, no conversations: import offer, granted, not subscribed, reconnect; search without results',
    route: '/inbox/messenger',
    render: all(
      messenger({ conversations: [] }, { permission: 'granted' }),
      messenger({ conversations: [], delivery: 'not_subscribed' }),
      messenger({ conversations: [], delivery: 'reconnect' }),
      messenger({ conversations: [] }, { q: 'x' }),
    ),
    allowed: [],
  },
  {
    name: 'messenger — populated list (unread, sent, nameless), profile-access notice, nothing selected',
    route: '/inbox/messenger',
    render: messenger(),
    allowed: mcData(...ROWS, ...ROW_INITIALS),
  },
  {
    name: 'messenger — thread: every bubble, attachment, receipt, source, event line, reaction; composer; saved replies; earlier',
    route: '/inbox/messenger',
    render: messenger({ selectedId: 1, hasMore: true, selectedOverrides: OPEN }),
    allowed: mcData(...ROWS, ...ROW_INITIALS, ...THREAD),
  },
  {
    name: 'messenger — window closed / last hour, Page cannot send, nameless contact (create / link lead)',
    route: '/inbox/messenger',
    render: all(
      messenger({ selectedId: 1, messages: [], events: [], selectedOverrides: { lastInboundAt: new Date(NOW - 30 * HOUR) } }),
      messenger({ selectedId: 1, messages: [], events: [], selectedOverrides: { lastInboundAt: new Date(NOW - 23.5 * HOUR) } }),
      messenger({
        selectedId: 1,
        messages: [],
        events: [],
        pages: [PAGE_MESSENGER, PAGE_NO_MESSENGER],
        selectedOverrides: { pageId: 'p2', lastInboundAt: new Date(NOW - HOUR) },
      }),
      messenger({ selectedId: 3, messages: [], events: [], savedReplies: [], selectedOverrides: { lastInboundAt: new Date(NOW - HOUR) } }),
    ),
    allowed: mcData(...ROWS, ...ROW_INITIALS),
  },
  {
    name: 'messenger — expired subscription: composer and lead actions locked',
    route: '/inbox/messenger',
    render: messenger({ selectedId: 2, messages: [], events: [], selectedOverrides: { lastInboundAt: new Date(NOW - HOUR) } }, {}, EXPIRED),
    allowed: mcData(...ROWS, ...ROW_INITIALS),
  },
  {
    name: 'comments — not enabled, no Page, no comments, filtered empty (open / converted)',
    route: '/inbox/comments',
    render: all(
      comments({ enabled: false }),
      comments({ pages: [] }),
      comments({ items: [] }),
      comments({ items: [] }, { status: 'open' }),
      comments({ items: [] }, { status: 'converted' }),
    ),
    allowed: [],
  },
  {
    name: 'comments — feed: every status badge, body, attachment, post context, thread, convert / open lead, reply, filter, load more',
    route: '/inbox/comments',
    render: comments({ nextCursor: { receivedAt: '2026-10-27T00:00:00.000Z', id: 1 } }),
    allowed: mcData(...FEED),
  },
  {
    name: 'comments — reply permission prompt / declined / granted; expired subscription',
    route: '/inbox/comments',
    render: all(
      comments({ pages: [PAGE_REPLIES, PAGE_NO_REPLIES] }),
      comments({ pages: [PAGE_REPLIES, PAGE_NO_REPLIES] }, { permission: 'missing' }),
      comments({}, { permission: 'granted' }, EXPIRED),
    ),
    allowed: mcData(...FEED),
  },
  {
    name: 'messenger + comments — route loading and error boundaries',
    route: '/inbox/messenger, /inbox/comments (loading, error)',
    render: async (locale) => {
      const m = await routeChrome('messenger')
      const c = await routeChrome('comments')
      return inboxShell(
        locale,
        <>
          <m.Loading />
          <m.ErrorBoundary error={new Error('x')} reset={() => {}} />
          <c.Loading />
          <c.ErrorBoundary error={new Error('x')} reset={() => {}} />
        </>,
      )
    },
    allowed: [],
  },
]
