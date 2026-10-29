// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { cleanup, render } from '@testing-library/react'
import {
  CLOSED_THREAD,
  EXPIRED,
  NOW,
  OPERATOR_TAKE,
  SELECTED_LEAD,
  SELECTED_LEADLESS,
  inboxEnv,
  resetInboxEnv,
} from './inboxEnv'
import { inboxPage, inboxShell, withInboxEnv } from './inboxHarness'
import { inboxSpies as S, resetInboxSpies } from './inboxMocks'

/**
 * The desktop WhatsApp inbox (`/inbox`): server/client hydration agreement in
 * he / en / ar, a language switch in the same session, and the catalog pin
 * for the shared health notices. Content and direction: inboxLocales.test.tsx.
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
vi.mock('@/lib/device', () => ({ isMobileRequest: async () => false, isMobileWorkspaceRequest: async () => false }))
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
vi.mock('@/db/conversationAiState', async () => (await import('./inboxMocks')).aiStateModule())
vi.mock('@/db/conversationIntelligence', async () => (await import('./inboxMocks')).conversationIntelligenceModule())
vi.mock('@/db/autoResponseSettings', async () => (await import('./inboxMocks')).autoResponseSettingsModule())
vi.mock('@/db/questionnaireSessions', async () => (await import('./inboxMocks')).questionnaireSessionsModule())
vi.mock('@/lib/inbox/autoresponse/reliability/entitlement', async () => (await import('./inboxMocks')).replyEntitlementModule())
vi.mock('@/actions/inbox/agentOwnership', async () => (await import('./inboxMocks')).ownershipActionsModule())
vi.mock('@/actions/whatsapp/promoteConversationToLead', async () => (await import('./inboxMocks')).promoteActionsModule())
vi.mock('@/actions/whatsapp/markConversationPersonal', async () => ({ markConversationPersonal: (await import('./inboxMocks')).inboxSpies.markPersonal }))
vi.mock('@/actions/whatsapp/sendWhatsappReply', async () => ({ sendWhatsappReply: (await import('./inboxMocks')).inboxSpies.sendReply }))
vi.mock('@/actions/ai/whatsappReplyDraft', async () => ({ generateWhatsappReplyDraft: (await import('./inboxMocks')).inboxSpies.generateDraft }))
vi.mock('@/actions/whatsapp/templates/sendTemplateToLead', async () => ({ sendTemplateToLead: (await import('./inboxMocks')).inboxSpies.sendTemplate }))
vi.mock('@/actions/analytics/recordOperatorTakeEvent', async () => {
  const { inboxSpies } = await import('./inboxMocks')
  return { recordOperatorTakeEvent: async (...a: unknown[]) => inboxSpies.operatorEvents.push(a) }
})
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: async () => {} }))
vi.mock('@/modules/leads/contactEvents', () => ({ contactClicked: () => {}, contactSucceeded: () => {} }))
vi.mock('@/actions/ai/leadIntelligence', async () => (await import('./inboxMocks')).leadIntelligenceModule())
vi.mock('@/actions/ai/leadIntelligenceRefresh', () => ({ refreshLeadIntelligence: async () => ({ ok: true }) }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: async () => ({ hasAccess: true }) }))
vi.mock('@/lib/toast', async () => (await import('./inboxMocks')).toastModule())

vi.mock('@/lib/analytics/track', () => ({ track: () => {} }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Loc = 'he' | 'en' | 'ar'

async function tree(locale: Loc, overrides: Partial<typeof inboxEnv> = {}, ent?: typeof EXPIRED) {
  S.prefs.userLocale = locale
  return inboxShell(locale, await withInboxEnv(overrides, () => inboxPage()), ent)
}

const textOf = (el: Element) => (el.textContent ?? '').replace(/[‎‏]/g, '').replace(/\s+/g, ' ')
const regionOf = (el: Element | null) => [el?.getAttribute('lang') ?? null, el?.getAttribute('dir') ?? null]
const pageRoot = (c: Element) => c.querySelector('.flex.h-\\[calc\\(100dvh-6rem\\)\\]')

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

describe('hydration — server and client agree in every language', () => {
  for (const locale of ['he', 'en', 'ar'] as const) {
    for (const [name, overrides] of [
      ['list', {}],
      ['lead thread', { selected: SELECTED_LEAD, ownership: 'handoff', operatorTake: OPERATOR_TAKE, intel: 'fresh' }],
      ['leadless thread', { selected: SELECTED_LEADLESS }],
      ['window closed', { selected: SELECTED_LEAD, messages: CLOSED_THREAD }],
    ] as const) {
      test(`${locale} · ${name}`, async () => {
        const node = await tree(locale, overrides as Partial<typeof inboxEnv>)
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
  test('the same user re-renders in the new language without signing out', async () => {
    const first = render(await tree('en', { selected: SELECTED_LEAD }))
    expect(textOf(first.container)).toContain('Lead profile')
    first.unmount()
    // The same session user; only the stored preference changed (what refresh() re-reads).
    const again = render(await tree('ar', { selected: SELECTED_LEAD }))
    expect(textOf(again.container)).toContain('ملف العميل المحتمل')
    expect(textOf(again.container)).not.toContain('Lead profile')
    expect(regionOf(pageRoot(again.container))).toEqual(['ar', 'rtl'])
  })
})

describe('catalog pin — the composer health notices are the shared settings copy', () => {
  test('he `inbox.health.*` equals WHATSAPP_NOTICES; non-Hebrew keeps tone and actions', async () => {
    const { WHATSAPP_NOTICES, SHARED } = await import('@/lib/connections/messages')
    const { he } = await import('@/lib/i18n/messages/he')
    const { noticeForComposerHealth } = await import('@/lib/inbox/whatsappComposerDecision')
    expect(he.inbox.health.reasonsLabel).toBe(SHARED.reasonsLabel)
    for (const code of ['not_ready', 'restricted', 'expired', 'webhook', 'throttled', 'needs_verification'] as const) {
      const n = WHATSAPP_NOTICES[code]
      const c = he.inbox.health[code] as Record<string, string>
      expect([c.title, c.explanation, c.nextStep], code).toEqual([n.title, n.explanation, n.nextStep])
      expect([c.reason1, c.reason2].filter(Boolean), code).toEqual(n.reasons ?? [])
    }
    const en = noticeForComposerHealth('token', 'en')!
    expect(en.tone).toBe(WHATSAPP_NOTICES.expired.tone)
    expect(en.action).toBe(WHATSAPP_NOTICES.expired.action)
    expect(noticeForComposerHealth('token')).toBe(WHATSAPP_NOTICES.expired)
  })
})
