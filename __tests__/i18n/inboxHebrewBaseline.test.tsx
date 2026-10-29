// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import type { ReactNode } from 'react'
import {
  CLOSED_THREAD,
  EXPIRED,
  NOW,
  OPERATOR_TAKE,
  QUESTIONNAIRE_FIELDS,
  SELECTED_LEAD,
  SELECTED_LEADLESS,
  UNKNOWN_THREAD,
  inboxEnv,
  resetInboxEnv,
} from './inboxEnv'
import { inboxLoading, inboxPage, inboxShell, withInboxEnv } from './inboxHarness'
import { resetInboxSpies } from './inboxMocks'

/**
 * HEBREW BASELINE for the desktop WhatsApp inbox (`/inbox`): the REAL server
 * page (async server components resolved in place) with its list, toolbar,
 * workspace, thread, ownership line, operator take, composer states,
 * intelligence cards and the route loading state. Recorded against the code
 * BEFORE the Phase D inbox package; every Hebrew render must still match
 * byte-for-byte afterwards. Interactions: inboxHebrewBaselineInteractions;
 * label producers: inboxHebrewBaselineProducers.
 *
 * Only I/O is mocked (db reads, server actions, flags, toasts). Rendered with
 * NO i18n provider, i.e. exactly what a Hebrew user receives today.
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

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const renderToString = (node: ReactNode) => normalizeIds(renderRaw(<>{node}</>).replaceAll('<!-- -->', ''))
const page = async (overrides: Partial<typeof inboxEnv> = {}, ent?: typeof EXPIRED) =>
  renderToString(await inboxShell(null, await withInboxEnv(overrides, () => inboxPage()), ent))
/** Only the conversation pane (variants differ there; the list pane is pinned once above). */
const workspace = async (overrides: Partial<typeof inboxEnv> = {}, ent?: typeof EXPIRED) => {
  const html = await page(overrides, ent)
  const start = html.indexOf('<section aria-label=')
  return html.slice(start, html.indexOf('</section>', start) + '</section>'.length)
}
/** Only the intelligence column. */
const side = async (overrides: Partial<typeof inboxEnv>) => {
  const html = await page(overrides)
  return html.slice(html.indexOf('<aside class="hidden w-80'))
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

describe('Hebrew baseline — /inbox list pane (server HTML)', () => {
  test('populated list, nothing selected: toolbar (smart sections, filters), rows (waiting, window open/closed, replied, leadless, empty thread), empty workspace', async () => {
    expect(await page()).toMatchSnapshot()
  })

  test('system empty: no conversations, no smart counts, no Messenger', async () => {
    expect(await page({ rows: [], smartCounts: { hot: 0, attention: 0, demo: 0, escalation: 0 }, messengerEnabled: false })).toMatchSnapshot()
  })

  test('filters applied from the URL: search, status, sort, smart filter, unread, needs reply; filtered empty', async () => {
    const { default: Toolbar } = await import('@/modules/inbox/components/InboxToolbar')
    const filters = { q: 'יוסי', status: 'closed', unread: true, needsReply: true, intel: 'hot', sort: 'temperature' } as const
    const out = {
      toolbar: renderToString(<Toolbar filters={filters} selectedConversation={null} smartCounts={inboxEnv.smartCounts} showMessenger messengerUnread={120} />),
      filteredEmpty: await page({ rows: [] }),
    }
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — selected conversation (server HTML)', () => {
  test('lead thread: every bubble kind, status and failure; text composer; intelligence cards (fresh)', async () => {
    expect(await page({ selected: SELECTED_LEAD, intel: 'fresh' })).toMatchSnapshot()
  })

  test('leadless contact: header actions, no composer', async () => {
    expect(await workspace({ selected: SELECTED_LEADLESS })).toMatchSnapshot()
  })

  test('empty thread (no messages yet), lead and leadless', async () => {
    const out = {
      lead: await workspace({ selected: SELECTED_LEAD, messages: [] }),
      leadless: await workspace({ selected: SELECTED_LEADLESS, messages: [] }),
    }
    expect(out).toMatchSnapshot()
  })

  test('composer states: window closed (template / no template / templates hidden), window unknown, every blocked health, no facts', async () => {
    const out: Record<string, string> = {}
    out.closedTemplate = await workspace({ selected: SELECTED_LEAD, messages: CLOSED_THREAD })
    out.closedNoTemplate = await workspace({ selected: SELECTED_LEAD, messages: CLOSED_THREAD, composer: { ...inboxEnv.composer, templates: [] } })
    out.closedNoManage = await workspace({
      selected: SELECTED_LEAD,
      messages: CLOSED_THREAD,
      composer: { ...inboxEnv.composer, templates: [], canManageTemplates: false },
    })
    out.unknown = await workspace({ selected: SELECTED_LEAD, messages: UNKNOWN_THREAD })
    for (const health of ['disconnected', 'unknown', 'token', 'webhook', 'registration_pending', 'restricted', 'inbound_only', 'throttled']) {
      out[`health_${health}`] = await workspace({ selected: SELECTED_LEAD, messages: UNKNOWN_THREAD, composer: { ...inboxEnv.composer, health } })
    }
    out.noFacts = await workspace({ selected: SELECTED_LEAD, messages: UNKNOWN_THREAD, composer: null })
    expect(out).toMatchSnapshot()
  })

  test('expired subscription: composer, draft and leadless actions are locked', async () => {
    const out = {
      lead: await workspace({ selected: SELECTED_LEAD }, EXPIRED),
      leadless: await workspace({ selected: SELECTED_LEADLESS }, EXPIRED),
    }
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — ownership line, operator take, intelligence', () => {
  const thread = (overrides: Partial<typeof inboxEnv>) => workspace({ selected: SELECTED_LEAD, messages: UNKNOWN_THREAD, ...overrides })

  test('ownership: paused for plan, agent answering, human answering, handoff (+ urgency, fields), questionnaire running / ended', async () => {
    const out: Record<string, string> = {}
    for (const ownership of ['paused', 'agent', 'human', 'handoff', 'questionnaire', 'questionnaireEnded', 'silent'] as const) {
      out[ownership] = await thread({ ownership })
    }
    out.handoffQuestionnaire = await thread({ ownership: 'handoff', handoff: { ...inboxEnv.handoff!, fields: QUESTIONNAIRE_FIELDS } })
    out.handoffNoUrgency = await thread({ ownership: 'handoff', handoff: { ...inboxEnv.handoff!, urgency: null } })
    expect(out).toMatchSnapshot()
  })

  test('operator take: fresh and stale', async () => {
    const out = {
      fresh: await thread({ operatorTake: OPERATOR_TAKE }),
      stale: await thread({ operatorTake: { ...OPERATOR_TAKE, status: 'stale' } }),
    }
    expect(out).toMatchSnapshot()
  })

  test('conversation intelligence: pending, stale, failed (fresh is in the lead thread)', async () => {
    const out = {
      pending: await side({ selected: SELECTED_LEAD, intel: 'pending' }),
      stale: await side({ selected: SELECTED_LEAD, intel: 'stale' }),
      failed: await side({ selected: SELECTED_LEAD, intel: 'failed' }),
      none: await side({ selected: SELECTED_LEAD, intel: 'none' }),
      leadless: await side({ selected: SELECTED_LEADLESS, intel: 'fresh' }),
    }
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — /inbox loading', () => {
  test('route skeleton', async () => {
    expect(renderToString(await inboxShell(null, await inboxLoading()))).toMatchSnapshot()
  })
})
