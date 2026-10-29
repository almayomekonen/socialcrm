// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { cleanup, render } from '@testing-library/react'
import type { UiLocale } from '@/lib/i18n/config'
import { EXPIRED, NOW, resetMessengerCommentsEnv } from './messengerCommentsEnv'
import { commentsScreen, messengerScreen } from './messengerCommentsHarness'
import { mcSpies as S, resetMcSpies } from './messengerCommentsMocks'

/**
 * `/inbox/messenger` and `/inbox/comments`: server/client hydration agreement in
 * he / en / ar (the locale is a server-resolved prop, so the two cannot differ),
 * a language switch in the same session, and the catalog pin for the shared
 * Meta notices. Content and direction: messengerCommentsLocales.test.tsx.
 */

vi.mock('next/navigation', async () => (await import('./messengerCommentsMocks')).navigationModule())
vi.mock('next/server', async () => (await import('./messengerCommentsMocks')).nextServerModule())
vi.mock('next/cache', async () => (await import('./inboxMocks')).cacheModule())
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./messengerCommentsEnv')).messengerEnv.user }))
vi.mock('@/db/uiLocale', async () => (await import('./messengerCommentsMocks')).uiLocaleModule())
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
vi.mock('@/lib/analytics/track', () => ({ track: () => {} }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const HOUR = 3_600_000
const OPEN = { lastInboundAt: new Date(NOW - 2 * HOUR) }
const savedEnv = { ...process.env }

async function tree(route: 'messenger' | 'comments', locale: UiLocale, overrides: Record<string, unknown> = {}, ent?: typeof EXPIRED) {
  S.prefs.userLocale = locale
  return route === 'messenger' ? messengerScreen(locale, overrides, {}, ent) : commentsScreen(locale, overrides, {}, ent)
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  Object.assign(process.env, { UI_LOCALE_ENABLED: '1', UI_LOCALE_AGENCY_ALLOWLIST: '103' })
})
afterAll(() => {
  vi.useRealTimers()
  process.env = { ...savedEnv }
})
afterEach(() => {
  cleanup()
  resetMessengerCommentsEnv()
  resetMcSpies()
})

describe('hydration — server and client agree in every language', () => {
  for (const locale of ['he', 'en', 'ar'] as const) {
    for (const [name, route, overrides, ent] of [
      ['messenger list', 'messenger', {}, undefined],
      ['messenger thread', 'messenger', { selectedId: 1, hasMore: true, selectedOverrides: OPEN }, undefined],
      ['messenger empty + import', 'messenger', { conversations: [] }, undefined],
      ['messenger expired', 'messenger', { selectedId: 2, selectedOverrides: OPEN }, EXPIRED],
      ['comments feed', 'comments', { nextCursor: { receivedAt: '2026-10-27T00:00:00.000Z', id: 1 } }, undefined],
      ['comments expired', 'comments', {}, EXPIRED],
    ] as const) {
      test(`${locale} · ${name}`, async () => {
        const node = await tree(route, locale, overrides as Record<string, unknown>, ent)
        const container = document.createElement('div')
        container.innerHTML = renderToString(node)
        document.body.appendChild(container)
        const errors: unknown[] = []
        const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a))
        let root: ReturnType<typeof hydrateRoot> | undefined
        await act(async () => {
          root = hydrateRoot(container, node, { onRecoverableError: (e) => errors.push(e) })
        })
        spy.mockRestore()
        act(() => root?.unmount())
        container.remove()
        expect(errors).toEqual([])
      })
    }
  }
})

describe('switching language in the same session', () => {
  test('the same user re-renders Messenger and Comments in the new language', async () => {
    const first = render(await tree('messenger', 'en', { selectedId: 1, selectedOverrides: OPEN }))
    expect(first.container.textContent).toContain('Messenger reply')
    first.unmount()
    const again = render(await tree('messenger', 'ar', { selectedId: 1, selectedOverrides: OPEN }))
    expect(again.container.textContent).toContain('رد عبر Messenger')
    expect(again.container.textContent).not.toContain('Messenger reply')
    again.unmount()
    const back = render(await tree('comments', 'he'))
    expect(back.container.textContent).toContain('המר לליד')
    expect(back.container.querySelector('[lang]')).toBeNull()
  })
})

describe('catalog pin — the Meta notices are the shared settings copy', () => {
  test('he `inbox.metaNotice.*` equals FACEBOOK_NOTICES; the attachment rules and the reasons label too', async () => {
    const { FACEBOOK_NOTICES, SHARED } = await import('@/lib/connections/messages')
    const { ATTACHMENT_REJECTION_COPY } = await import('@/lib/facebook/messenger/attachmentRules')
    const { META_INBOX_NOTICE_CODES } = await import('@/lib/connections/metaNoticeCopy')
    const { he } = await import('@/lib/i18n/messages/he')
    expect(he.inbox.health.reasonsLabel).toBe(SHARED.reasonsLabel)
    for (const code of META_INBOX_NOTICE_CODES) {
      const n = FACEBOOK_NOTICES[code]
      const c = he.inbox.metaNotice[code] as Record<string, string>
      expect([c.title, c.explanation, c.nextStep, c.action], code).toEqual([n.title, n.explanation, n.nextStep, n.action])
      expect([c.reason1, c.reason2].filter(Boolean), code).toEqual(n.reasons ?? [])
    }
    expect({ empty: he.inbox.messenger.attachment.empty, too_large: he.inbox.messenger.attachment.too_large, blocked_type: he.inbox.messenger.attachment.blocked_type }).toEqual(ATTACHMENT_REJECTION_COPY)
  })
})
