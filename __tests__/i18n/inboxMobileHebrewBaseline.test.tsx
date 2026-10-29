// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  CLOSED_THREAD,
  EXPIRED,
  NOW,
  SELECTED_LEAD,
  SELECTED_LEADLESS,
  UNKNOWN_THREAD,
  inboxEnv,
  resetInboxEnv,
} from './inboxEnv'
import { resetInboxSpies } from './inboxMocks'
import { AGE_ROWS, RECENT_THREAD, mobileInboxPage, mobileShell, withMobileEnv } from './inboxMobileHarness'

/**
 * HEBREW BASELINE for the MOBILE inbox (`/inbox` on a phone): the REAL server
 * page down its phone branch (`MobileInboxRoute`, async server components
 * resolved in place) — the list (unread, waiting, outbound prefix, leadless, no
 * messages, every relative-time bucket, search), the empty states, the thread
 * (header + recency, every bubble, failures, every composer state, leadless
 * actions, locked), the missing conversation, and the phone loading / error
 * boundaries of `/inbox`, `/inbox/messenger` and `/inbox/comments`. Recorded
 * against the code BEFORE the mobile Phase D package; every Hebrew render must
 * match byte-for-byte afterwards. Interactions + producers:
 * inboxMobileHebrewBaselineInteractions.test.tsx. The Messenger / Comments
 * phone PAGES are pinned by messengerCommentsHebrewBaseline ("phone branch").
 *
 * Only I/O is mocked; the device gate answers "phone". Rendered with NO i18n
 * provider, i.e. exactly what a Hebrew user receives today.
 *
 * Normalized before comparing, and only these:
 *  · React's invisible `<!-- -->` text separators.
 *  · React `useId` values (tree shape, not text).
 */

vi.mock('next/navigation', async () => (await import('./inboxMocks')).navigationModule())
vi.mock('next/dynamic', async () => ({ default: (await import('./leadTabsHarness')).nextDynamicMock }))
vi.mock('next/cache', async () => (await import('./inboxMocks')).cacheModule())
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => null }), headers: () => ({ get: () => null }) }))
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./inboxEnv')).inboxEnv.user }))
vi.mock('@/lib/requireUser', async () => ({ requireAgencyUser: async () => (await import('./inboxEnv')).inboxEnv.user }))
vi.mock('@/db/uiLocale', async () => {
  const { inboxSpies } = await import('./inboxMocks')
  return { getUiLocalePrefs: async () => ({ userLocale: inboxSpies.prefs.userLocale, agencyLocale: null }) }
})
vi.mock('@/lib/device', () => ({ isMobileRequest: async () => true, isMobileWorkspaceRequest: async () => true }))
vi.mock('@/lib/flags/mobileFlags', () => ({ canEnterMobileWorkspace: () => true }))
vi.mock('@/lib/flags/inboxFlags', () => ({ isInboxDeltaSyncEnabled: () => false, getInboxRefreshIntervalMs: () => null }))
vi.mock('@/lib/facebook/permissions', async () => {
  const { inboxEnv: env } = await import('./inboxEnv')
  return { isFacebookMessengerEnabledForAgency: () => env.messengerEnabled }
})
vi.mock('@/modules/messenger/queries', async () => {
  const { inboxEnv: env } = await import('./inboxEnv')
  return { countUnreadMessengerConversations: async () => env.messengerUnread }
})
vi.mock('@/modules/inbox/queries', async () => (await import('./inboxMocks')).queriesModule())
vi.mock('@/modules/inbox/actions', async () => (await import('./inboxMocks')).inboxActionsModule())
vi.mock('@/db/inboxMessages', async () => {
  const { inboxEnv: env } = await import('./inboxEnv')
  return { listConversationMessages: async () => structuredClone(env.messages) }
})
vi.mock('@/lib/inbox/whatsappComposerContext', async () => {
  const { inboxEnv: env } = await import('./inboxEnv')
  return { loadWhatsappComposerContext: async () => env.composer }
})
vi.mock('@/actions/whatsapp/promoteConversationToLead', async () => (await import('./inboxMocks')).promoteActionsModule())
vi.mock('@/actions/whatsapp/markConversationPersonal', async () => ({ markConversationPersonal: (await import('./inboxMocks')).inboxSpies.markPersonal }))
vi.mock('@/actions/whatsapp/sendWhatsappReply', async () => ({ sendWhatsappReply: (await import('./inboxMocks')).inboxSpies.sendReply }))
vi.mock('@/actions/whatsapp/templates/sendTemplateToLead', async () => ({ sendTemplateToLead: (await import('./inboxMocks')).inboxSpies.sendTemplate }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: async () => {} }))
vi.mock('@/modules/leads/contactEvents', () => ({ contactClicked: () => {}, contactSucceeded: () => {} }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: async () => ({ hasAccess: true }) }))
vi.mock('@/lib/toast', async () => (await import('./inboxMocks')).toastModule())

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const renderToString = (node: ReactNode) => normalizeIds(renderRaw(<>{node}</>).replaceAll('<!-- -->', ''))
const page = async (overrides: Partial<typeof inboxEnv> = {}, sp: Record<string, string> = {}, ent?: typeof EXPIRED) =>
  renderToString(await mobileShell(null, await withMobileEnv(overrides, () => mobileInboxPage(sp)), ent))
/** The composer region only (variants differ there; the full thread is pinned once). */
const composer = async (overrides: Partial<typeof inboxEnv>, ent?: typeof EXPIRED) => {
  const html = await page({ selected: SELECTED_LEAD, ...overrides }, {}, ent)
  const start = html.indexOf('<div class="shrink-0 border-t border-[#e0e0e0]')
  return start < 0 ? '(no composer)' : html.slice(start)
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  resetInboxEnv()
  resetInboxSpies()
})

describe('Hebrew baseline — mobile inbox list (server HTML)', () => {
  test('populated: channel switch + Messenger badge, search bar + count, rows (unread, waiting + window hint, outbound prefix, leadless number, no messages yet)', async () => {
    const html = await page()
    expect(html).toContain('חיפוש שיחה')
    expect(html).toMatchSnapshot()
  })

  test('relative times: future, seconds, a minute, minutes, an hour, hours, yesterday, days, older (date), none', async () => {
    expect(await page({ rows: AGE_ROWS })).toMatchSnapshot()
  })

  test('active search with results, Messenger off', async () => {
    expect(await page({ messengerEnabled: false }, { q: 'יוסי' })).toMatchSnapshot()
  })

  test('empty: no conversations (connect / settings guidance); search with no results', async () => {
    const out = {
      none: await page({ rows: [] }),
      noResults: await page({ rows: [] }, { q: 'אין כזה' }),
    }
    expect(out.none).toContain('אין עדיין שיחות')
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — mobile thread (server HTML)', () => {
  test('lead thread: header (back, channel, name, status · recency, lead link), every bubble kind, delivery state and failure, text composer', async () => {
    expect(await page({ selected: SELECTED_LEAD })).toMatchSnapshot()
  })

  test('header recency (minutes ago), unknown status falls back; leadless contact header with its actions, no composer', async () => {
    const out = {
      recent: await page({ selected: { ...SELECTED_LEAD, leadStatus: 'interested' }, messages: RECENT_THREAD }),
      unknownStatus: await page({ selected: { ...SELECTED_LEAD, leadStatus: 'legacy_value' }, messages: RECENT_THREAD }),
      leadless: await page({ selected: SELECTED_LEADLESS }),
    }
    expect(out).toMatchSnapshot()
  })

  test('empty thread (lead / leadless); conversation missing', async () => {
    const out = {
      lead: await page({ selected: SELECTED_LEAD, messages: [] }),
      leadless: await page({ selected: SELECTED_LEADLESS, messages: [] }),
      missing: await page({}, { conversation: '999' }),
    }
    expect(out.missing).toContain('השיחה לא נמצאה')
    expect(out).toMatchSnapshot()
  })

  test('composer states: window closed (ready-message sheet button / no template / no manage), window unknown, blocked health, no facts', async () => {
    const out: Record<string, string> = {}
    out.closedTemplate = await composer({ messages: CLOSED_THREAD })
    out.closedNoTemplate = await composer({ messages: CLOSED_THREAD, composer: { ...inboxEnv.composer, templates: [] } })
    out.closedNoManage = await composer({ messages: CLOSED_THREAD, composer: { ...inboxEnv.composer, templates: [], canManageTemplates: false } })
    out.unknown = await composer({ messages: UNKNOWN_THREAD })
    for (const health of ['disconnected', 'token', 'restricted', 'registration_pending']) {
      out[`health_${health}`] = await composer({ messages: UNKNOWN_THREAD, composer: { ...inboxEnv.composer, health } })
    }
    expect(out.closedTemplate).toContain('בחר הודעה מוכנה')
    expect(out).toMatchSnapshot()
  })

  test('expired subscription: composer and leadless actions are locked', async () => {
    const out = {
      lead: await composer({}, EXPIRED),
      leadless: await page({ selected: SELECTED_LEADLESS }, {}, EXPIRED),
    }
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — phone loading and error boundaries', () => {
  test('/inbox loading (list, thread); Messenger and Comments loading + error inside the mobile workspace', async () => {
    const { default: InboxLoading } = await import('@/app/(app)/inbox/loading')
    const routes = {
      messenger: [(await import('@/app/(app)/inbox/messenger/loading')).default, (await import('@/app/(app)/inbox/messenger/error')).default],
      comments: [(await import('@/app/(app)/inbox/comments/loading')).default, (await import('@/app/(app)/inbox/comments/error')).default],
    } as const
    // Client-rendered: the loading boundary picks list vs thread from `location.search` after mount.
    const client = async (node: ReactNode) => {
      const r = render(await mobileShell(null, node))
      const out = normalizeIds(r.container.innerHTML)
      cleanup()
      return out
    }
    const out: Record<string, string> = {}
    out.inboxListServer = renderToString(await mobileShell(null, <InboxLoading />))
    out.inboxList = await client(<InboxLoading />)
    window.history.pushState({}, '', '/inbox?conversation=1')
    out.inboxThread = await client(<InboxLoading />)
    window.history.pushState({}, '', '/inbox')
    for (const [route, [Loading, ErrorBoundary]] of Object.entries(routes)) {
      out[`${route}Loading`] = renderToString(await mobileShell(null, <Loading />))
      out[`${route}Error`] = renderToString(await mobileShell(null, <ErrorBoundary error={new Error('x')} reset={() => {}} />))
    }
    expect(out.inboxList).toContain('טוען…')
    expect(out.inboxThread).toContain('inbox-thread-skeleton-mobile')
    expect(out).toMatchSnapshot()
  })
})
