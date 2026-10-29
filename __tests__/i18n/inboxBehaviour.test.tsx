// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CLOSED_THREAD, NOW, SELECTED_LEAD, SELECTED_LEADLESS, inboxEnv, resetInboxEnv } from './inboxEnv'
import { inboxPage, inboxShell, withInboxEnv } from './inboxHarness'
import { inboxSpies as S, resetInboxSpies } from './inboxMocks'

/**
 * The desktop WhatsApp inbox (`/inbox`) BEHAVES the same in every interface
 * language: every action receives identical arguments, the composer value is
 * the rep's own text untouched by the language, and the keyboard paths
 * (Escape, focus return, accessible names of icon-only controls) hold in
 * he / en / ar. The ONE intended difference — the list's follow-up reads
 * carry the page's locale for their display strings, and only when it is not
 * Hebrew — is pinned at the end. Copy and direction: inboxLocales*.test.tsx.
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
// The sync loop's poll runs once on mount (its scheduling is not under test here).
vi.mock('@/modules/inbox/client/useAdaptivePoll', async () => {
  const { useEffect } = await import('react')
  return { useAdaptivePoll: (poll: () => Promise<unknown>) => useEffect(() => void poll(), [poll]) }
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Loc = 'he' | 'en' | 'ar'
const LOCALES: Loc[] = ['he', 'en', 'ar']

async function mount(locale: Loc, overrides: Partial<typeof inboxEnv> = {}) {
  S.prefs.userLocale = locale
  return render(await inboxShell(locale, await withInboxEnv(overrides, () => inboxPage())))
}

/** The accessible names of the controls these flows use, per language (from the catalog). */
const NAMES = {
  he: { send: 'שלח הודעה', ai: 'נסח טיוטה עם AI', emoji: 'הוספת אימוג׳י', copy: 'העתק טיוטה', menu: 'פעולות שיחה', del: 'מחק שיחה', take: 'אני עונה מכאן', create: '+ צור ליד', link: 'קשר לליד קיים', personal: 'סמן כאישי', ready: 'בחר הודעה מוכנה', readySend: 'שלח הודעה', play: 'נגן הקלטה', seek: 'מיקום בהקלטה', image: /^הצג את התמונה/ },
  en: { send: 'Send message', ai: 'Draft with AI', emoji: 'Add emoji', copy: 'Copy draft', menu: 'Conversation actions', del: 'Delete conversation', take: "I'll answer from here", create: '+ Create lead', link: 'Link to an existing lead', personal: 'Mark as personal', ready: 'Choose a ready message', readySend: 'Send message', play: 'Play recording', seek: 'Position in the recording', image: /^View the photo/ },
  ar: { send: 'إرسال الرسالة', ai: 'صياغة مسودة بالذكاء الاصطناعي', emoji: 'إضافة رمز تعبيري', copy: 'نسخ المسودة', menu: 'إجراءات المحادثة', del: 'حذف المحادثة', take: 'سأردّ من هنا', create: '+ إنشاء عميل محتمل', link: 'ربط بعميل محتمل موجود', personal: 'وضع علامة شخصية', ready: 'اختر رسالة جاهزة', readySend: 'إرسال الرسالة', play: 'تشغيل التسجيل', seek: 'الموضع في التسجيل', image: /^عرض الصورة/ },
} as const

const calls = (fn: { mock: { calls: unknown[][] } }) => fn.mock.calls.map((c) => [...c])

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  process.env.UI_LOCALE_ENABLED = '1'
  process.env.UI_LOCALE_AGENCY_ALLOWLIST = '103'
})
afterAll(() => {
  vi.useRealTimers()
  delete process.env.UI_LOCALE_ENABLED
  delete process.env.UI_LOCALE_AGENCY_ALLOWLIST
})
afterEach(() => {
  cleanup()
  resetInboxEnv()
  resetInboxSpies()
})

describe('every action receives identical arguments in every language', () => {
  test('reply, AI draft, mark read, ownership, delete', async () => {
    const seen: Record<string, unknown> = {}
    for (const locale of LOCALES) {
      const n = NAMES[locale]
      const { container } = await mount(locale, { selected: SELECTED_LEAD, ownership: 'agent' })
      const box = container.querySelector('#wa-reply-draft') as HTMLTextAreaElement
      fireEvent.change(box, { target: { value: 'שלום Dana 👋 1,200 ₪' } })
      await act(async () => fireEvent.click(screen.getByLabelText(n.send)))
      await act(async () => fireEvent.click(screen.getByTitle(n.ai)))
      await act(async () => fireEvent.click(screen.getByText(n.take)))
      await act(async () => fireEvent.click(screen.getAllByLabelText(n.menu).at(-1)!))
      await act(async () => fireEvent.click(screen.getByRole('menuitem')))
      await act(async () => fireEvent.click(screen.getAllByText(n.del).at(-1)!))
      seen[locale] = {
        send: calls(S.sendReply),
        draft: calls(S.generateDraft),
        read: calls(S.markRead),
        takeOver: calls(S.takeOver),
        delete: calls(S.deleteConversation),
        replaces: [...S.replaces],
      }
      cleanup()
      resetInboxSpies()
    }
    expect(seen.he).toMatchObject({ send: [[41, 'שלום Dana 👋 1,200 ₪', 1]], draft: [[41]], takeOver: [[1]], delete: [[1]] })
    expect(seen.en).toEqual(seen.he)
    expect(seen.ar).toEqual(seen.he)
  })

  test('leadless contact: create, link (several matches → pick), mark personal', async () => {
    const seen: Record<string, unknown> = {}
    for (const locale of LOCALES) {
      const n = NAMES[locale]
      await mount(locale, { selected: SELECTED_LEADLESS })
      await act(async () => fireEvent.click(screen.getByText(n.create)))
      S.listMatches.mockResolvedValueOnce({ ok: true, matches: [{ id: 41, name: 'יוסי לוי' }, { id: 42, name: 'יוסי לוי (2)' }] })
      await act(async () => fireEvent.click(screen.getByText(n.link)))
      await act(async () => fireEvent.click(screen.getByText('יוסי לוי (2)')))
      await act(async () => fireEvent.click(screen.getByText(n.personal)))
      seen[locale] = { promote: calls(S.promote), list: calls(S.listMatches), link: calls(S.link), personal: calls(S.markPersonal) }
      cleanup()
      resetInboxSpies()
    }
    expect(seen.he).toEqual({ promote: [[4]], list: [[4]], link: [[4, 42]], personal: [[4]] })
    expect(seen.en).toEqual(seen.he)
    expect(seen.ar).toEqual(seen.he)
  })

  test('ready message after the window closed', async () => {
    const seen: Record<string, unknown> = {}
    for (const locale of LOCALES) {
      const n = NAMES[locale]
      await mount(locale, { selected: SELECTED_LEAD, messages: CLOSED_THREAD })
      await act(async () => fireEvent.click(screen.getByText(n.ready)))
      const dialog = document.querySelector('[role="dialog"]')!
      fireEvent.click(dialog.querySelector('input[type="radio"]')!)
      const sendBtn = [...dialog.querySelectorAll('button')].find((b) => b.textContent === n.readySend)!
      await act(async () => fireEvent.click(sendBtn))
      seen[locale] = calls(S.sendTemplate)
      cleanup()
      resetInboxSpies()
    }
    expect(seen.he).toEqual([[41, 11, 1]])
    expect(seen.en).toEqual(seen.he)
    expect(seen.ar).toEqual(seen.he)
  })
})

describe('the composer value is the rep\'s own text', () => {
  test('typing, the AI draft and an emoji land unchanged in every language', async () => {
    const values: Record<string, string[]> = {}
    for (const locale of LOCALES) {
      const n = NAMES[locale]
      const { container } = await mount(locale, { selected: SELECTED_LEAD })
      const box = container.querySelector('#wa-reply-draft') as HTMLTextAreaElement
      const out: string[] = []
      fireEvent.change(box, { target: { value: 'Hi יוסי — 09:30?' } })
      out.push(box.value)
      await act(async () => fireEvent.click(screen.getByTitle(n.ai)))
      out.push(box.value)
      expect(box.getAttribute('aria-label'), locale).not.toBe(box.value)
      values[locale] = out
      cleanup()
    }
    expect(values.he).toEqual(['Hi יוסי — 09:30?', 'טיוטה מה-AI'])
    expect(values.en).toEqual(values.he)
    expect(values.ar).toEqual(values.he)
  })
})

describe('keyboard and accessible names', () => {
  for (const locale of LOCALES) {
    test(`${locale}: Escape closes the actions menu and the emoji panel; focus returns to the trigger`, async () => {
      const n = NAMES[locale]
      await mount(locale, { selected: SELECTED_LEAD })
      const trigger = screen.getAllByLabelText(n.menu).at(-1)!
      trigger.focus()
      await act(async () => fireEvent.click(trigger))
      expect(document.querySelector('[role="menu"]')).not.toBeNull()
      await act(async () => fireEvent.keyDown(document, { key: 'Escape' }))
      expect(document.querySelector('[role="menu"]')).toBeNull()
      expect(document.activeElement).toBe(trigger)

      const emoji = screen.getByLabelText(n.emoji)
      emoji.focus()
      await act(async () => fireEvent.click(emoji))
      expect(emoji.getAttribute('aria-expanded')).toBe('true')
      await act(async () => fireEvent.keyDown(document, { key: 'Escape' }))
      expect(emoji.getAttribute('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(emoji)
    })

    test(`${locale}: icon-only controls carry translated accessible names`, async () => {
      const n = NAMES[locale]
      await mount(locale, { selected: SELECTED_LEAD })
      for (const name of [n.send, n.emoji, n.copy, n.play, n.seek]) {
        expect(screen.getAllByLabelText(name).length, name).toBeGreaterThan(0)
      }
      expect(screen.getAllByLabelText(n.menu).length).toBe(6) // five rows + the open thread's header
      expect(screen.getAllByRole('button', { name: n.image }).length).toBe(2)
      for (const el of document.querySelectorAll('button')) {
        const name = el.getAttribute('aria-label') ?? el.textContent?.trim()
        expect(name, el.outerHTML.slice(0, 80)).toBeTruthy()
      }
    })
  }
})

describe('the one intended difference: follow-up list reads carry a non-Hebrew page locale', () => {
  test('load more: Hebrew sends exactly { cursor, filters }; English adds its locale', async () => {
    const { InboxStoreProvider } = await import('@/modules/inbox/client/inboxStore')
    const { default: List } = await import('@/modules/inbox/components/InboxConversationList')
    const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
    const { DEFAULT_INBOX_FILTERS } = await import('@/modules/inbox/types')
    const cursor = { lastMessageAt: '2026-10-27T09:00:00.000Z', id: 3, unread: false }
    const out: Record<string, unknown> = {}
    // A page with a row and a cursor, so the "load more" control exists.
    const { mapInboxRow } = await import('@/modules/inbox/mapInboxRow')
    const items = inboxEnv.rows.slice(0, 1).map((r) => mapInboxRow(r, NOW))
    for (const [locale, label] of [['he', 'טען עוד'], ['en', 'Load more']] as const) {
      render(
        <I18nProvider locale={locale}>
          <InboxStoreProvider initialItems={items} initialCursor={cursor} filters={DEFAULT_INBOX_FILTERS} filtersKey='k' deltaSyncEnabled={false}>
            <List selectedConversationId={null} />
          </InboxStoreProvider>
        </I18nProvider>,
      )
      await act(async () => fireEvent.click(screen.getByText(label)))
      out[locale] = calls(S.loadMore)
      cleanup()
      resetInboxSpies()
    }
    expect(out.he).toEqual([[{ cursor, filters: DEFAULT_INBOX_FILTERS }]])
    expect(out.en).toEqual([[{ cursor, filters: DEFAULT_INBOX_FILTERS, locale: 'en' }]])
  })

  test('sync loop: Hebrew request carries no locale; Arabic adds locale=ar', async () => {
    const { InboxStoreProvider } = await import('@/modules/inbox/client/inboxStore')
    const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
    const { DEFAULT_INBOX_FILTERS } = await import('@/modules/inbox/types')
    const urls: Record<string, string> = {}
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => ({ counts: { whatsappUnread: 0 }, changed: [], items: [], serverTime: new Date(NOW).toISOString(), full: false }),
      url,
    }))
    vi.stubGlobal('fetch', fetchSpy)
    for (const locale of ['he', 'ar'] as const) {
      await act(async () => {
        render(
          <I18nProvider locale={locale}>
            <InboxStoreProvider initialItems={[]} initialCursor={null} filters={DEFAULT_INBOX_FILTERS} filtersKey='k' deltaSyncEnabled>
              <span />
            </InboxStoreProvider>
          </I18nProvider>,
        )
      })
      urls[locale] = String(fetchSpy.mock.calls.at(-1)?.[0])
      cleanup()
    }
    vi.unstubAllGlobals()
    expect(urls.he).toMatch(/^\/api\/inbox\/sync\?/)
    expect(new URLSearchParams(urls.he.split('?')[1]).has('locale')).toBe(false)
    expect(new URLSearchParams(urls.ar.split('?')[1]).get('locale')).toBe('ar')
    const strip = (u: string) => {
      const p = new URLSearchParams(u.split('?')[1])
      p.delete('locale')
      return p.toString()
    }
    expect(strip(urls.ar)).toBe(strip(urls.he))
  })
})
