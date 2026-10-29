// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CLOSED_THREAD, LIST_ROWS, NOW, SELECTED_LEAD, THREAD_CONTENT, inboxEnv, resetInboxEnv } from './inboxEnv'
import { inboxSpies as S, resetInboxSpies } from './inboxMocks'
import { AGES, RECENT_THREAD, SLUG_TEMPLATES, mobileInboxPage, mobileShell, withMobileEnv } from './inboxMobileHarness'
import { findHebrewLeaks } from './leakScan'

/**
 * The MOBILE inbox in en / ar: translated chrome on the list, thread, empty and
 * missing states, the region (lang/dir) on the route roots and on every
 * portalled sheet, relative times, refusals and toasts, customer text untouched
 * (byte-identical bubble HTML, `dir="auto"` only outside Hebrew), and Hebrew
 * declaring nothing. Hydration + language switch: inboxMobileLocalesHydration.
 * Arguments, keyboard, accessible names, classes: inboxMobileBehaviour.
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
const LOCALES: Loc[] = ['he', 'en', 'ar']
const rtf = (l: 'en' | 'ar') => new Intl.RelativeTimeFormat(l === 'ar' ? 'ar-u-nu-latn' : 'en', { numeric: 'auto' })

async function mount(locale: Loc, overrides: Partial<typeof inboxEnv> = {}, sp: Record<string, string> = {}) {
  S.prefs.userLocale = locale
  return render(await mobileShell(locale, await withMobileEnv(overrides, () => mobileInboxPage(sp))))
}
const textOf = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ')
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement
const regionOf = (el: Element | null) => [el?.getAttribute('lang') ?? null, el?.getAttribute('dir') ?? null]
const longPress = (el: Element) => {
  fireEvent.pointerDown(el, { pointerType: 'touch', button: 0, clientX: 8, clientY: 8 })
  fireEvent.pointerUp(el, { pointerType: 'touch', button: 0, clientX: 8, clientY: 8 })
  fireEvent.contextMenu(el)
}
const custom = (...texts: string[]) => texts.map((text) => ({ text, reason: 'customer-data' as const }))

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

describe('mobile list — chrome, waiting copy, relative times, region', () => {
  test('en: search, count, outbound prefix, no-messages, waiting copy in English; the route root declares en/ltr', async () => {
    const { mapInboxRow } = await import('@/modules/inbox/mapInboxRow')
    const { container } = await mount('en')
    const text = textOf(container)
    expect(screen.getByPlaceholderText('Search conversations')).toBeTruthy()
    expect(screen.getByLabelText('Search conversations')).toBeTruthy()
    expect(text).toContain('5 conversations')
    expect(text).toContain('You: שלחתי לך את ההצעה במייל')
    expect(text).toContain('No messages yet')
    expect(text).toContain(mapInboxRow(LIST_ROWS[0], NOW, 'en').waitingTitle as string)
    expect(text).toContain(rtf('en').format(-2, 'hour'))
    expect(regionOf(container.firstElementChild)).toEqual(['en', 'ltr'])
  })

  test('ar: the same list in Arabic, rtl; Hebrew declares nothing and is unchanged', async () => {
    const ar = await mount('ar')
    expect(textOf(ar.container)).toContain('أنت:')
    expect(textOf(ar.container)).toContain(rtf('ar').format(-2, 'hour'))
    expect(regionOf(ar.container.firstElementChild)).toEqual(['ar', 'rtl'])
    ar.unmount()
    const he = await mount('he')
    expect(he.container.querySelector('[lang]')).toBeNull()
    expect(he.container.querySelector('[dir="auto"]')).toBeNull()
    expect(textOf(he.container)).toContain('לפני 2 שעות')
  })

  test('empty and no-results states in en and ar', async () => {
    const none = await mount('en', { rows: [] })
    expect(textOf(none.container)).toContain('No conversations yet')
    expect(textOf(none.container)).toContain('WhatsApp settings')
    none.unmount()
    const noResults = await mount('ar', { rows: [] }, { q: 'zzz' })
    expect(textOf(noResults.container)).toContain('لا توجد نتائج لـ "zzz".')
    expect(findHebrewLeaks(noResults.container, [])).toEqual([])
  })
})

describe('relativeTime — the same buckets in every language', () => {
  test('Hebrew is relativeTimeHe; en/ar word each bucket with Intl; the date uses the business time zone', async () => {
    const { relativeTime, relativeTimeHe } = await import('@/modules/inbox/mobile/relativeTime')
    const iso = (ago: number | null) => (ago == null ? null : new Date(NOW - ago).toISOString())
    for (const ago of Object.values(AGES)) expect(relativeTime(iso(ago), NOW, 'he')).toBe(relativeTimeHe(iso(ago), NOW))
    for (const l of ['en', 'ar'] as const) {
      const out = Object.fromEntries(Object.entries(AGES).map(([k, ago]) => [k, relativeTime(iso(ago), NOW, l)]))
      expect(out.future).toBe(l === 'en' ? 'Just now' : 'الآن')
      expect(out.seconds).toBe(out.future)
      expect(out.minute).toBe(rtf(l).format(-1, 'minute'))
      expect(out.minutes).toBe(rtf(l).format(-4, 'minute'))
      expect(out.hour).toBe(rtf(l).format(-1, 'hour'))
      expect(out.hours).toBe(rtf(l).format(-5, 'hour'))
      expect(out.yesterday).toBe(rtf(l).format(-1, 'day'))
      expect(out.days).toBe(rtf(l).format(-3, 'day'))
      expect(out.older).toBe(l === 'en' ? 'Oct 14' : '14 أكتوبر')
      expect(out.none).toBe('')
    }
    // 22:30 UTC is already the next day in Israel: the business day, not the server's.
    expect(relativeTime('2026-10-14T22:30:00Z', NOW, 'en')).toBe('Oct 15')
    expect(rtf('en').format(-1, 'day')).toBe('yesterday')
  })
})

describe('mobile thread — chrome and customer text', () => {
  test('en/ar: header, delivery labels, failures by category, composer; bubble text identical, dir="auto" only outside Hebrew', async () => {
    const bodies: Record<string, { inner: string; dir: string | null }[]> = {}
    for (const l of LOCALES) {
      const { container } = await mount(l, { selected: SELECTED_LEAD })
      bodies[l] = [...container.querySelectorAll('[data-testid="message-bubble"] > p.whitespace-pre-wrap')].map((p) => ({ inner: p.innerHTML, dir: p.getAttribute('dir') }))
      if (l === 'en') {
        const text = textOf(container)
        expect(text).toContain('Delivered')
        expect(text).toContain('Incoming message')
        expect(text).toContain('The message was not sent — this number is not active on WhatsApp.')
        expect(screen.getByLabelText('Write a message')).toBeTruthy()
        expect(screen.getByPlaceholderText('Write a message...')).toBeTruthy()
        expect(screen.getByLabelText('Back to conversations')).toBeTruthy()
        expect(screen.getByLabelText('Open the lead יוסי לוי')).toBeTruthy()
        expect(regionOf(container.firstElementChild)).toEqual(['en', 'ltr'])
      }
      if (l === 'ar') expect(regionOf(container.firstElementChild)).toEqual(['ar', 'rtl'])
      cleanup()
    }
    // The customer's own text (not our notice for an unsupported type) is byte-identical in every language.
    const customer = bodies.he.map((b, i) => (THREAD_CONTENT.some((c) => b.inner.includes(c)) ? i : -1)).filter((i) => i >= 0)
    expect(customer.length).toBeGreaterThan(10)
    for (const l of ['en', 'ar'] as const) {
      expect(bodies[l].length).toBe(bodies.he.length)
      expect(customer.map((i) => bodies[l][i].inner)).toEqual(customer.map((i) => bodies.he[i].inner))
    }
    expect(bodies.he.every((b) => b.dir === null)).toBe(true)
    expect([...bodies.en, ...bodies.ar].every((b) => b.dir === 'auto')).toBe(true)
  })

  test('header line: status label and recency in the interface language', async () => {
    const { container } = await mount('en', { selected: { ...SELECTED_LEAD, leadStatus: 'interested' }, messages: RECENT_THREAD })
    expect(container.querySelector('[data-testid="wa-thread-header"] p')?.textContent).toBe(`Interested · ${rtf('en').format(-4, 'minute')}`)
    cleanup()
    const legacy = await mount('ar', { selected: { ...SELECTED_LEAD, leadStatus: 'legacy_value' }, messages: RECENT_THREAD })
    expect(legacy.container.querySelector('[data-testid="wa-thread-header"] p')?.textContent).toBe(`جديد · ${rtf('ar').format(-4, 'minute')}`)
  })

  test('send refusals in English by reason code; the box keeps the text', async () => {
    const { container } = await mount('en', { selected: SELECTED_LEAD })
    const box = container.querySelector('#composer') as HTMLTextAreaElement
    const out: Record<string, string | null> = {}
    for (const reason of ['no-connection', 'window-closed', 'health-blocked', 'persist-failed', 'unmapped']) {
      S.sendReply.mockResolvedValueOnce({ ok: false, reason })
      fireEvent.change(box, { target: { value: 'hello' } })
      await act(async () => fireEvent.submit(box.closest('form')!))
      out[reason] = screen.getByRole('alert').textContent
    }
    expect(out).toEqual({
      'no-connection': 'There is no active WhatsApp connection. You can connect it in the integrations settings.',
      'window-closed': 'The WhatsApp messaging window has closed',
      'health-blocked': 'Messages cannot be sent right now',
      'persist-failed': "The message was sent but wasn't saved to the conversation. Refresh the screen.",
      unmapped: "We couldn't send the message. Try again.",
    })
    expect(box.value).toBe('hello')
  })
})

describe('portalled sheets declare the language', () => {
  test('delete confirmation, selection bar and toasts in en / ar', async () => {
    for (const l of ['en', 'ar'] as const) {
      await mount(l)
      const rows = screen.getAllByTestId('conversation-row')
      await act(async () => fireEvent.contextMenu(rows[0]))
      await act(async () => fireEvent.click(rows[1]))
      const bar = screen.getByTestId('inbox-selection-bar')
      expect(textOf(bar)).toContain(l === 'en' ? '2 selected' : 'تم تحديد عنصرين')
      await act(async () => fireEvent.click(screen.getByText(l === 'en' ? 'Delete' : 'حذف')))
      expect(regionOf(dialog())).toEqual(l === 'en' ? ['en', 'ltr'] : ['ar', 'rtl'])
      expect(textOf(dialog())).toContain(l === 'en' ? 'Delete 2 conversations?' : 'حذف محادثتين؟')
      expect(findHebrewLeaks(dialog(), [])).toEqual([])
      expect(findHebrewLeaks(document.body, custom('יוסי לוי', 'רונית כהן', 'משה אברהם', 'שרה מזרחי', ...LIST_ROWS.map((r) => r.lastMessageText as string).filter(Boolean)))).toEqual([])
      S.deleteConversation.mockResolvedValueOnce({ ok: false, deleted: false }).mockResolvedValueOnce({ ok: false, deleted: false })
      await act(async () => fireEvent.click(within(dialog()).getByRole('button', { name: l === 'en' ? 'Delete conversations' : 'حذف المحادثتين' })))
      cleanup()
    }
    expect(S.toasts.map((t) => t.slice(0, 2))).toEqual([
      ['error', "The conversations couldn't be deleted. Try again."],
      ['error', 'تعذّر حذف المحادثات. حاول مرة أخرى.'],
    ])
  })

  test('message actions sheet and copy toast in en', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } })
    await mount('en', { selected: SELECTED_LEAD })
    await act(async () => longPress(screen.getAllByTestId('message-bubble')[0]))
    expect(regionOf(dialog())).toEqual(['en', 'ltr'])
    expect(textOf(dialog())).toContain('Message actions')
    expect(screen.getByLabelText('Close')).toBeTruthy()
    expect(findHebrewLeaks(dialog(), [])).toEqual([])
    await act(async () => fireEvent.click(screen.getByText('Copy')))
    expect(S.toasts.map((t) => t.slice(0, 2))).toEqual([['success', 'Message copied']])
  })

  test('ready-message sheet in ar: chrome translated, slug titles labelled, owner titles and bodies untouched', async () => {
    await mount('ar', { selected: SELECTED_LEAD, messages: CLOSED_THREAD, composer: { ...inboxEnv.composer, templates: SLUG_TEMPLATES } })
    await act(async () => fireEvent.click(screen.getByText('اختر رسالة جاهزة')))
    const sheet = dialog()
    expect(regionOf(sheet)).toEqual(['ar', 'rtl'])
    const text = textOf(sheet)
    // Slug titles get our label; an owner's title (Hebrew or not) and every body are shown as stored.
    for (const label of ['التواصل الأول', 'متابعة', 'رسالة جاهزة', 'Hello there', 'תזכורת פגישה']) expect(text).toContain(label)
    expect(screen.getByText('إرسال الرسالة')).toBeTruthy()
    expect(findHebrewLeaks(sheet, custom('תזכורת פגישה', ...SLUG_TEMPLATES.map((t) => t.bodyText)))).toEqual([])
  })
})

describe('phone loading and error boundaries in the interface language', () => {
  test('list / thread skeleton status and region; Messenger and Comments phone errors', async () => {
    const { default: InboxLoading } = await import('@/app/(app)/inbox/loading')
    const shell = (node: ReactNode) => mobileShell('en', node)
    const list = render(await shell(<InboxLoading />))
    expect(regionOf(list.getByTestId('inbox-skeleton-mobile'))).toEqual(['en', 'ltr'])
    expect(list.getByRole('status').textContent).toBe('Loading…')
    list.unmount()
    window.history.pushState({}, '', '/inbox?conversation=1')
    const thread = render(await shell(<InboxLoading />))
    expect(regionOf(thread.getByTestId('inbox-thread-skeleton-mobile'))).toEqual(['en', 'ltr'])
    window.history.pushState({}, '', '/inbox')
    thread.unmount()
    const { default: MessengerError } = await import('@/app/(app)/inbox/messenger/error')
    const { default: CommentsError } = await import('@/app/(app)/inbox/comments/error')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const errors = render(await mobileShell('ar', <><MessengerError error={new Error('x')} reset={() => {}} /><CommentsError error={new Error('x')} reset={() => {}} /></>))
    expect(findHebrewLeaks(errors.container, [])).toEqual([])
    expect([...errors.container.querySelectorAll('[role="alert"]')].map(regionOf)).toEqual([['ar', 'rtl'], ['ar', 'rtl']])
  })
})
