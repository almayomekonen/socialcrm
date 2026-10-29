// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { cleanup, render } from '@testing-library/react'
import { CLOSED_THREAD, EXPIRED, NOW, SELECTED_LEAD, SELECTED_LEADLESS, inboxEnv, resetInboxEnv } from './inboxEnv'
import { inboxSpies as S, resetInboxSpies } from './inboxMocks'
import { AGE_ROWS, mobileInboxPage, mobileShell, withMobileEnv } from './inboxMobileHarness'

/**
 * The MOBILE inbox: server/client hydration agreement in he / en / ar (list with
 * every relative-time bucket, lead thread, leadless thread, window closed,
 * locked, empty) and a language switch in the same session. Relative times are
 * server-made strings, so the client never recomputes them during hydration.
 * Content: inboxMobileLocales.test.tsx.
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

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ counts: {} }))) as typeof fetch

type Loc = 'he' | 'en' | 'ar'

async function tree(locale: Loc, overrides: Partial<typeof inboxEnv> = {}, sp: Record<string, string> = {}, ent?: typeof EXPIRED) {
  S.prefs.userLocale = locale
  return mobileShell(locale, await withMobileEnv(overrides, () => mobileInboxPage(sp)), ent)
}
const textOf = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ')

const savedEnv = { ...process.env }
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
  resetInboxEnv()
  resetInboxSpies()
})

describe('hydration — server and client agree in every language (phone)', () => {
  for (const locale of ['he', 'en', 'ar'] as const) {
    for (const [name, overrides, sp, ent] of [
      ['list (every relative time)', { rows: AGE_ROWS }, {}, undefined],
      ['search, no results', { rows: [] }, { q: 'zzz' }, undefined],
      ['lead thread', { selected: SELECTED_LEAD }, {}, undefined],
      ['leadless thread', { selected: SELECTED_LEADLESS }, {}, undefined],
      ['window closed', { selected: SELECTED_LEAD, messages: CLOSED_THREAD }, {}, undefined],
      ['locked', { selected: SELECTED_LEAD }, {}, EXPIRED],
    ] as const) {
      test(`${locale} · ${name}`, async () => {
        const node = await tree(locale, overrides as Partial<typeof inboxEnv>, sp as Record<string, string>, ent)
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

describe('switching language in the same session (phone)', () => {
  test('the same user re-renders the list and thread in the new language', async () => {
    const first = render(await tree('en', { selected: SELECTED_LEAD }))
    expect(textOf(first.container)).toContain('Incoming message')
    first.unmount()
    // The same session user; only the stored preference changed (what refresh() re-reads).
    const again = render(await tree('ar', { selected: SELECTED_LEAD }))
    expect(textOf(again.container)).not.toContain('Incoming message')
    expect(again.container.firstElementChild?.getAttribute('lang')).toBe('ar')
    again.unmount()
    const back = render(await tree('he'))
    expect(back.container.querySelector('[lang]')).toBeNull()
    expect(textOf(back.container)).toContain('חיפוש שיחות')
  })
})
