// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  CLOSED_THREAD,
  EXPIRED,
  INBOX_CUSTOMER_DATA,
  NOW,
  OPERATOR_TAKE,
  SELECTED_LEAD,
  SELECTED_LEADLESS,
  THREAD,
  UNKNOWN_THREAD,
  inboxEnv,
  resetInboxEnv,
} from './inboxEnv'
import { inboxLoading, inboxPage, inboxShell, withInboxEnv } from './inboxHarness'
import { inboxSpies as S, resetInboxSpies } from './inboxMocks'
import { findHebrewLeaks, type Allowance } from './leakScan'
import { INTELLIGENCE } from './leadDetailEnv'

/**
 * The desktop WhatsApp inbox (`/inbox`) in en / ar: key strings, region
 * direction (nothing declared for Hebrew), portalled menus / dialogs / the
 * failure tooltip, toasts, and message bubbles kept verbatim. Hydration, the
 * language switch and the catalog pin: inboxLocalesHydration.test.tsx.
 * Behaviour: inboxBehaviour.test.tsx. Hebrew output is pinned by the
 * inboxHebrewBaseline* tests.
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
const has = (text: string, ...parts: string[]) => {
  for (const p of parts) expect(text, p).toContain(p)
}
const regionOf = (el: Element | null) => [el?.getAttribute('lang') ?? null, el?.getAttribute('dir') ?? null]
const pageRoot = (c: Element) => c.querySelector('.flex.h-\\[calc\\(100dvh-6rem\\)\\]')
const DATA: Allowance[] = [
  ...INBOX_CUSTOMER_DATA.map((text) => ({ text, reason: 'customer-data' as const })),
  // The lead intelligence card's AI text (D3).
  ...[INTELLIGENCE.summary, ...INTELLIGENCE.keyInsights, INTELLIGENCE.suggestedNextAction.title, INTELLIGENCE.suggestedNextAction.reason].map(
    (text) => ({ text, reason: 'external' as const }),
  ),
]

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

describe('English and Arabic content', () => {
  test('list pane: toolbar, smart sections, channel switch, rows (waiting copy from the server mapper), empty workspace', async () => {
    const { container } = render(await tree('en'))
    const en = textOf(container)
    has(en, 'Conversations', 'Comments', 'Messenger', 'Hot conversations', 'Demo opportunities', 'Unread', 'Awaiting reply')
    has(en, 'Waiting for your reply · 2 hours', '22 hours left in the WhatsApp window', 'WhatsApp window closed', 'Sent:')
    has(en, 'Next step: Send a quote', 'Hot lead', 'Interested in pricing', 'Select a conversation from the list to get started')
    expect(screen.getByLabelText('Search conversations').getAttribute('placeholder')).toBe('Search name, phone or message')
    expect(screen.getByLabelText('4 unread conversations')).toBeTruthy()
    const sort = screen.getByLabelText('Sort') as HTMLSelectElement
    expect([...sort.options].map((o) => [o.value, o.textContent])).toEqual([
      ['latest', 'Latest activity'],
      ['oldest', 'Oldest activity'],
      ['unread', 'Unread first'],
      ['temperature', 'Hot leads first'],
      ['intent', 'By lead intent'],
      ['action', 'By suggested step'],
    ])
    cleanup()
    const ar = textOf(render(await tree('ar')).container)
    has(ar, 'المحادثات', 'التعليقات', 'محادثات ساخنة', 'بانتظار ردّك · ساعتان', 'الخطوة التالية: أرسل عرض سعر', 'اختر محادثة من القائمة للبدء')
    expect(screen.getByLabelText('4 محادثات غير مقروءة')).toBeTruthy()
  })

  test('thread: header, bubble labels, delivery states, failures by category, reactions, quotes, media, composer', async () => {
    const { container } = render(await tree('en', { selected: SELECTED_LEAD }))
    const en = textOf(container)
    has(en, 'Last activity', 'Needs a reply', 'Call', 'Lead profile', 'Incoming message', 'Message sent from the system')
    has(en, 'Sent — awaiting delivery confirmation', 'Delivered', 'Read', 'on an earlier message', 'Reply to an earlier message')
    has(en, 'The message was not sent — this number is not active on WhatsApp.', 'The message was not sent. Try again.')
    has(en, 'This message type is not supported yet', 'Photo', 'File from WhatsApp', 'PDF', 'Open')
    expect(screen.getByLabelText('Conversation messages')).toBeTruthy()
    expect(screen.getAllByLabelText('Reactions to the message').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Play recording')).toBeTruthy()
    expect(screen.getByLabelText('Open the file מפרט_טכני.pdf')).toBeTruthy()
    expect(screen.getByLabelText('Add emoji')).toBeTruthy()
    expect(screen.getByLabelText('Copy draft')).toBeTruthy()
    expect(screen.getByLabelText('Send message')).toBeTruthy()
    expect(screen.getByLabelText('WhatsApp reply draft').getAttribute('placeholder')).toBe('Write a draft reply...')
    expect(findHebrewLeaks(container, DATA)).toEqual([])
    cleanup()
    const ar = textOf(render(await tree('ar', { selected: SELECTED_LEAD })).container)
    has(ar, 'آخر نشاط', 'رسالة واردة', 'تم التسليم', 'لم تُرسل الرسالة — هذا الرقم غير نشط على واتساب.', 'على رسالة سابقة', 'رد على رسالة سابقة')
  })

  test('composer states: window closed (ready message), window unknown, blocked health with reasons, expired', async () => {
    const closed = textOf(render(await tree('en', { selected: SELECTED_LEAD, messages: CLOSED_THREAD })).container)
    has(closed, 'The WhatsApp messaging window has closed', 'Choose a ready message')
    cleanup()
    const unknown = textOf(render(await tree('en', { selected: SELECTED_LEAD, messages: UNKNOWN_THREAD })).container)
    has(unknown, "A text message can't be sent.", 'Open the conversation in WhatsApp')
    cleanup()
    const token = textOf(
      render(await tree('en', { selected: SELECTED_LEAD, messages: UNKNOWN_THREAD, composer: { ...inboxEnv.composer, health: 'token' } })).container,
    )
    has(token, 'The WhatsApp connection has expired', 'Usually because:', 'Time has passed since connecting', 'Go to connection settings')
    cleanup()
    const off = textOf(
      render(await tree('ar', { selected: SELECTED_LEAD, messages: UNKNOWN_THREAD, composer: { ...inboxEnv.composer, health: 'disconnected' } })).container,
    )
    has(off, 'لإرسال الرسائل،', 'اربط واتساب')
    cleanup()
    const expired = textOf(render(await tree('en', { selected: SELECTED_LEADLESS }, EXPIRED)).container)
    has(expired, 'Renewing your subscription restores conversation management')
  })

  test('ownership line, operator take, conversation analysis', async () => {
    const handoff = textOf(render(await tree('en', { selected: SELECTED_LEAD, messages: UNKNOWN_THREAD, ownership: 'handoff', operatorTake: OPERATOR_TAKE })).container)
    has(handoff, 'Waiting for a rep', 'Urgency: גבוהה', 'Business type:', 'This request was handed to you.', 'Hand back to the AI agent', 'Hide')
    expect(handoff).toContain(OPERATOR_TAKE.data.actionMessage)
    cleanup()
    const agent = textOf(render(await tree('ar', { selected: SELECTED_LEAD, messages: UNKNOWN_THREAD, ownership: 'agent', intel: 'stale' })).container)
    has(agent, 'الوكيل الذكي يردّ في هذه المحادثة.', 'سأردّ من هنا', 'تحليل المحادثة', 'قيد التحديث', 'عميل محتمل مهتم جدًا', 'ثقة عالية')
  })

  test('loading skeleton', async () => {
    S.prefs.userLocale = 'en'
    const { container } = render(await inboxShell('en', await inboxLoading()))
    expect(screen.getByRole('status').textContent).toBe('Loading…')
    expect(regionOf(container.firstElementChild)).toEqual(['en', 'ltr'])
  })
})

describe('direction: translated regions declare the locale, Hebrew declares nothing new', () => {
  test('page root, skeleton', async () => {
    for (const [locale, expected] of [
      ['en', ['en', 'ltr']],
      ['ar', ['ar', 'rtl']],
      ['he', [null, null]],
    ] as const) {
      const { container } = render(await tree(locale, { selected: SELECTED_LEAD }))
      expect(regionOf(pageRoot(container)), locale).toEqual(expected)
      cleanup()
    }
    S.prefs.userLocale = 'he'
    const { container } = render(await inboxShell('he', await inboxLoading()))
    expect(regionOf(container.firstElementChild)).toEqual([null, 'rtl'])
  })

  test('AI-written text re-declares Hebrew inside an English pane', async () => {
    const { container } = render(await tree('en', { selected: SELECTED_LEAD, messages: UNKNOWN_THREAD, operatorTake: OPERATOR_TAKE, intel: 'fresh' }))
    const take = screen.getByText(OPERATOR_TAKE.data.actionMessage).parentElement
    expect(regionOf(take)).toEqual(['he', 'rtl'])
    const summary = [...container.querySelectorAll('p')].find((p) => p.textContent === 'הלקוח שואל על מחיר החבילה השנתית ומבקש פרטים.')
    expect(regionOf(summary ?? null)).toEqual(['he', 'rtl'])
  })
})

describe('message bubbles are the stored text, byte for byte, in every language', () => {
  test('every bubble body has identical inner HTML in he / en / ar; dir="auto" only where the pane is translated', async () => {
    const bodies: Record<string, Record<number, string>> = {}
    const dirs: Record<string, (string | null)[]> = {}
    for (const locale of ['he', 'en', 'ar'] as const) {
      const { container } = render(await tree(locale, { selected: SELECTED_LEAD }))
      bodies[locale] = {}
      dirs[locale] = []
      for (const m of THREAD.filter((x) => x.type !== 'reaction')) {
        const p = container.querySelector(`#msg-${m.id} .whitespace-pre-wrap`)
        if (!p) continue
        if (typeof m.text === 'string' && m.text) bodies[locale][m.id as number] = p.innerHTML
        dirs[locale].push(p.getAttribute('dir'))
      }
      cleanup()
    }
    expect(Object.keys(bodies.he).length).toBeGreaterThan(8)
    expect(bodies.en).toEqual(bodies.he)
    expect(bodies.ar).toEqual(bodies.he)
    expect(new Set(dirs.he)).toEqual(new Set([null]))
    expect(new Set(dirs.en)).toEqual(new Set(['auto']))
    expect(new Set(dirs.ar)).toEqual(new Set(['auto']))
  })
})

describe('portalled menus, dialogs, tooltip and toasts', () => {
  test('conversation menu + delete confirmation declare the locale; toasts translated', async () => {
    render(await tree('en', { selected: SELECTED_LEAD }))
    await act(async () => fireEvent.click(screen.getAllByLabelText('Conversation actions')[0]))
    const menu = document.querySelector('[role="menu"]')!
    expect(regionOf(menu)).toEqual(['en', 'ltr'])
    expect(menu.textContent).toBe('Delete conversation')
    await act(async () => fireEvent.click(screen.getByRole('menuitem')))
    const dialog = document.querySelector('[role="dialog"]')!
    expect(regionOf(dialog)).toEqual(['en', 'ltr'])
    expect(findHebrewLeaks(dialog, [])).toEqual([])
    expect(textOf(dialog)).toContain('This will not delete the contact or the lead in the CRM.')
    S.deleteConversation.mockResolvedValueOnce({ ok: false, deleted: false })
    await act(async () => fireEvent.click(screen.getAllByText('Delete conversation').at(-1)!))
    await act(async () => fireEvent.click(screen.getAllByText('Delete conversation').at(-1)!))
    expect(S.toasts).toEqual([
      ['error', 'Deleting the conversation failed. Try again.'],
      ['success', 'Conversation deleted'],
    ])
  })

  test('failure tooltip and image viewer declare the locale (ar)', async () => {
    render(await tree('ar', { selected: SELECTED_LEAD }))
    const trigger = screen.getAllByText(/^تعذّر إرسال الرسالة\./)[0].parentElement as HTMLElement
    await act(async () => fireEvent.focus(trigger))
    await waitFor(() => expect(document.querySelector('[role="tooltip"]')).not.toBeNull())
    const tip = document.querySelector('[role="tooltip"]')!
    expect(regionOf(tip)).toEqual(['ar', 'rtl'])
    expect(findHebrewLeaks(tip, [])).toEqual([])
    fireEvent.blur(trigger)
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: /^عرض الصورة/ })[0]))
    const viewer = document.querySelector('[role="dialog"]')!
    expect(viewer.getAttribute('aria-label')).toBe('عارض الصور')
    expect(regionOf(viewer)).toEqual(['ar', 'rtl'])
  })

  test('composer toasts and inline errors; app-wide arrival toasts', async () => {
    const { container } = render(await tree('en', { selected: SELECTED_LEAD }))
    const box = container.querySelector('#wa-reply-draft') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'hello' } })
    await act(async () => fireEvent.click(screen.getByLabelText('Send message')))
    S.sendReply.mockResolvedValueOnce({ ok: false, reason: 'send-failed', category: 'window_expired' })
    fireEvent.change(box, { target: { value: 'again' } })
    await act(async () => fireEvent.click(screen.getByLabelText('Send message')))
    S.generateDraft.mockResolvedValueOnce({ ok: false })
    await act(async () => fireEvent.click(screen.getByTitle('Draft with AI')))
    expect(textOf(container)).toContain("Couldn't draft a reply right now. Try again.")
    expect(S.toasts).toEqual([
      ['success', 'Message sent — awaiting delivery confirmation'],
      ['error', 'The message was not sent — more than 24 hours have passed since the lead wrote. You can call them.'],
    ])
    cleanup()
    S.toasts.length = 0
    const { AwarenessProvider, useAwareness } = await import('@/modules/inbox/awareness/AwarenessContext')
    const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
    let merge: ReturnType<typeof useAwareness>['mergeAwareness'] = () => {}
    function Probe() {
      merge = useAwareness().mergeAwareness
      return null
    }
    render(
      <I18nProvider locale='ar'>
        <AwarenessProvider enabled={false} initialUnread={0}>
          <Probe />
        </AwarenessProvider>
      </I18nProvider>,
    )
    const later = new Date(NOW + 60_000).toISOString()
    act(() => merge({ whatsappUnread: 1 }, [{ type: 'whatsapp_message', conversationId: 9, contactName: 'יוסי לוי', at: later }]))
    act(() =>
      merge({ whatsappUnread: 3 }, [
        { type: 'whatsapp_message', conversationId: 10, contactName: 'רונית', at: later },
        { type: 'whatsapp_message', conversationId: 11, contactName: 'משה', at: later },
      ]),
    )
    expect(S.toasts.map((t) => t[1])).toEqual(['رسالة جديدة من יוסי לוי', 'رسالتان جديدتان'])
  })
})
