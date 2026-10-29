import type { ReactElement } from 'react'
import type { Surface } from './surfaces'
import type { Allowance } from './leakScan'
import type { UiLocale } from '@/lib/i18n/config'
import { CLOSED_THREAD, EXPIRED, INBOX_CUSTOMER_DATA, LIST_ROWS, SELECTED_LEAD, SELECTED_LEADLESS, THREAD_CONTENT, UNKNOWN_THREAD, inboxEnv } from './inboxEnv'
import { AGE_ROWS, RECENT_THREAD, mobileInboxPage, mobileShell, withMobileEnv } from './inboxMobileHarness'
import { CONVERSATIONS, COMMENTS, EVENTS, MC_CUSTOMER_DATA, MESSAGES, NOW, POSTS, REPLIES } from './messengerCommentsEnv'
import { commentsScreen, messengerScreen } from './messengerCommentsHarness'

/**
 * Leak-gate registrations for the MOBILE inbox (mobile Phase D): `/inbox` on a
 * phone (list, relative times, empty states, thread, composer states, locked,
 * missing conversation), the Messenger and Comments phone branches, and the
 * phone loading / error boundaries. Spread into SURFACES (surfaces.tsx);
 * rendering relies on the mocks in leakGate.test.tsx (the phone gate is
 * `dashboardEnv.mobile` for `/inbox`, the fixtures' `mobile` flag for Messenger
 * and Comments). Sheets, toasts and refusals are opened and scanned in
 * inboxMobileLocales.test.tsx.
 */

/** Hebrew customer data only the mobile fixtures add (names / previews / bodies, rendered verbatim). */
export const MOBILE_CUSTOMER_DATA = [
  ...AGE_ROWS.flatMap((r) => [r.customerName, r.lastMessageText]),
  ...RECENT_THREAD.map((m) => m.text),
].filter((v): v is string => typeof v === 'string')

function mobileData(...texts: string[]): Allowance[] {
  return [...new Set(texts)].map((text) => {
    if (INBOX_CUSTOMER_DATA.includes(text) || MOBILE_CUSTOMER_DATA.includes(text)) return { text, reason: 'customer-data' as const }
    throw new Error(`not declared as mobile inbox fixture data: ${text}`)
  })
}

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
/** Messenger / Comments customer data, as their desktop registrations declare it. */
function mcData(...texts: (string | null | undefined)[]): Allowance[] {
  const known = [...MC_CUSTOMER_DATA, ...[...CONVERSATIONS.map((c) => c.leadName ?? c.customerName), ...COMMENTS.map((c) => c.authorName)].filter((n): n is string => typeof n === 'string').map(initials)]
  return [...new Set(texts.filter((t): t is string => typeof t === 'string' && /[֐-׿]/.test(t)))].map((text) => {
    if (known.includes(text)) return { text, reason: 'customer-data' as const }
    throw new Error(`not declared as Messenger/Comments fixture data: ${text}`)
  })
}

const NAMES = ['יוסי לוי', 'רונית כהן', 'משה אברהם', 'שרה מזרחי']
const PREVIEWS = LIST_ROWS.map((r) => r.lastMessageText).filter((v): v is string => typeof v === 'string')

type Render = (locale: UiLocale) => Promise<ReactElement>

/** `/inbox` on a phone (the leak gate's device mock reads `dashboardEnv.mobile`). */
const phone = (overrides: Partial<typeof inboxEnv> = {}, sp: Record<string, string> = {}, ent?: typeof EXPIRED): Render => async (locale) => {
  const { dashboardEnv } = await import('./dashboardFixtures')
  dashboardEnv.mobile = true
  try {
    return await mobileShell(locale, await withMobileEnv(overrides, () => mobileInboxPage(sp)), ent)
  } finally {
    dashboardEnv.mobile = false
  }
}
const all = (...renders: Render[]): Render => async (locale) => {
  // Built one after another: each build sets the shared fixture state.
  const out = []
  for (const r of renders) out.push(await r(locale))
  return <>{out.map((node, i) => <div key={i}>{node}</div>)}</>
}

const HOUR = 3_600_000
const MC_ROWS = CONVERSATIONS.flatMap((c) => [c.customerName, c.leadName, c.lastMessageText])
const MC_ROW_INITIALS = ['נב', 'אש']
const MC_THREAD = [...MESSAGES.map((m) => m.text), ...EVENTS.map((e) => e.title), 'המבצע של החודש']
const FEED = [
  ...COMMENTS.flatMap((c) => [c.authorName, c.message]),
  ...COMMENTS.map((c) => c.authorName).filter((n): n is string => typeof n === 'string').map(initials),
  ...POSTS.map((p) => p.message),
  ...REPLIES.flatMap((r) => [r.authorName, r.message]),
]

export const INBOX_MOBILE_SURFACES: Surface[] = [
  {
    name: 'mobile inbox — populated list: channel switch, search, count, rows (unread, waiting, outbound prefix, leadless, no messages)',
    route: '/inbox (phone)',
    render: phone(),
    allowed: mobileData(...NAMES, ...PREVIEWS),
  },
  {
    name: 'mobile inbox — every relative-time bucket (now, minutes, hours, yesterday, days, date)',
    route: '/inbox (phone)',
    render: phone({ rows: AGE_ROWS }),
    allowed: mobileData(...MOBILE_CUSTOMER_DATA.filter((t) => !RECENT_THREAD.some((m) => m.text === t))),
  },
  {
    name: 'mobile inbox — no conversations; search without results; Messenger off',
    route: '/inbox (phone)',
    render: all(phone({ rows: [] }), phone({ rows: [], messengerEnabled: false }, { q: 'zzz' })),
    allowed: [],
  },
  {
    name: 'mobile inbox — lead thread: header (status, recency, lead link), every bubble, delivery state, failure, reaction, quote, media, text composer',
    route: '/inbox (phone)',
    render: all(phone({ selected: SELECTED_LEAD }), phone({ selected: { ...SELECTED_LEAD, leadStatus: 'interested' }, messages: RECENT_THREAD })),
    allowed: mobileData('יוסי לוי', ...THREAD_CONTENT, ...RECENT_THREAD.map((m) => m.text)),
  },
  {
    name: 'mobile inbox — leadless contact (green header actions); empty thread; missing conversation',
    route: '/inbox (phone)',
    render: all(phone({ selected: SELECTED_LEADLESS }), phone({ selected: SELECTED_LEAD, messages: [] }), phone({}, { conversation: '999' })),
    allowed: mobileData('יוסי לוי', ...THREAD_CONTENT),
  },
  {
    name: 'mobile inbox — composer: window closed (ready messages / none / no manage), window unknown, blocked health',
    route: '/inbox (phone)',
    render: all(
      phone({ selected: SELECTED_LEAD, messages: CLOSED_THREAD }),
      phone({ selected: SELECTED_LEAD, messages: CLOSED_THREAD, composer: { ...inboxEnv.composer, templates: [] } }),
      phone({ selected: SELECTED_LEAD, messages: CLOSED_THREAD, composer: { ...inboxEnv.composer, templates: [], canManageTemplates: false } }),
      phone({ selected: SELECTED_LEAD, messages: UNKNOWN_THREAD }),
      phone({ selected: SELECTED_LEAD, messages: UNKNOWN_THREAD, composer: { ...inboxEnv.composer, health: 'disconnected' } }),
      phone({ selected: SELECTED_LEAD, messages: UNKNOWN_THREAD, composer: { ...inboxEnv.composer, health: 'token' } }),
      phone({ selected: SELECTED_LEAD, messages: UNKNOWN_THREAD, composer: { ...inboxEnv.composer, health: 'restricted' } }),
    ),
    allowed: mobileData('יוסי לוי', ...CLOSED_THREAD.map((m) => m.text as string), ...UNKNOWN_THREAD.map((m) => m.text as string)),
  },
  {
    name: 'mobile inbox — expired subscription: composer and contact actions locked',
    route: '/inbox (phone)',
    render: all(phone({ selected: SELECTED_LEAD, messages: UNKNOWN_THREAD }, {}, EXPIRED), phone({ selected: SELECTED_LEADLESS, messages: UNKNOWN_THREAD }, {}, EXPIRED)),
    allowed: mobileData('יוסי לוי', ...UNKNOWN_THREAD.map((m) => m.text as string)),
  },
  {
    name: 'mobile Messenger — list, thread, not enabled',
    route: '/inbox/messenger (phone)',
    render: all(
      async (l) => messengerScreen(l, { mobile: true }),
      async (l) => messengerScreen(l, { mobile: true, selectedId: 1, hasMore: true, selectedOverrides: { lastInboundAt: new Date(NOW - 2 * HOUR) } }),
      async (l) => messengerScreen(l, { mobile: true, enabled: false }),
    ),
    allowed: mcData(...MC_ROWS, ...MC_ROW_INITIALS, ...MC_THREAD),
  },
  {
    name: 'mobile Comments — feed, not enabled, no Page',
    route: '/inbox/comments (phone)',
    render: all(
      async (l) => commentsScreen(l, { mobile: true }),
      async (l) => commentsScreen(l, { mobile: true, enabled: false }),
      async (l) => commentsScreen(l, { mobile: true, pages: [] }),
    ),
    allowed: mcData(...FEED),
  },
  {
    name: 'mobile inbox — phone loading (thread, list) and the Messenger / Comments phone loading + error boundaries',
    route: '/inbox, /inbox/messenger, /inbox/comments (phone loading, error)',
    render: async (locale) => {
      const { default: InboxLoading } = await import('@/app/(app)/inbox/loading')
      const { default: ThreadSkeleton } = await import('@/components/mobile/skeletons/InboxThreadSkeletonMobile')
      const { default: MessengerLoading } = await import('@/app/(app)/inbox/messenger/loading')
      const { default: MessengerError } = await import('@/app/(app)/inbox/messenger/error')
      const { default: CommentsLoading } = await import('@/app/(app)/inbox/comments/loading')
      const { default: CommentsError } = await import('@/app/(app)/inbox/comments/error')
      return mobileShell(
        locale,
        <>
          <InboxLoading />
          <ThreadSkeleton translated />
          <MessengerLoading />
          <MessengerError error={new Error('x')} reset={() => {}} />
          <CommentsLoading />
          <CommentsError error={new Error('x')} reset={() => {}} />
        </>,
      )
    },
    allowed: [],
  },
]
