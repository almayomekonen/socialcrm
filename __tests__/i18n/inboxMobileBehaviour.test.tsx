// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { CLOSED_THREAD, LIST_ROWS, NOW, SELECTED_LEAD, TEMPLATES, inboxEnv, resetInboxEnv } from './inboxEnv'
import { inboxSpies as S, resetInboxSpies } from './inboxMocks'
import { mobileInboxPage, mobileShell, withMobileEnv } from './inboxMobileHarness'

/**
 * The MOBILE inbox BEHAVES identically in every language: send / delete /
 * mark-read / load-more / ready-message send receive the same arguments (load
 * more adds only the display locale outside Hebrew, as the desktop list does),
 * the composer value is never touched, sheets close on Escape and the close
 * button and give focus back, icon-only controls are named in the interface
 * language, and no layout class or touch target changes between languages.
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

async function mount(locale: Loc, overrides: Partial<typeof inboxEnv> = {}, sp: Record<string, string> = {}) {
  S.prefs.userLocale = locale
  return render(await mobileShell(locale, await withMobileEnv(overrides, () => mobileInboxPage(sp))))
}
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null
const longPress = (el: Element) => {
  fireEvent.pointerDown(el, { pointerType: 'touch', button: 0, clientX: 8, clientY: 8 })
  fireEvent.pointerUp(el, { pointerType: 'touch', button: 0, clientX: 8, clientY: 8 })
  fireEvent.contextMenu(el)
}
/** Per locale: [Delete, Mark as read, Choose a ready message, Send message, Cancel]. */
const L: Record<Loc, { del: string; read: string; choose: string; send: string; cancel: string; close: string }> = {
  he: { del: 'מחק', read: 'סמן כנקרא', choose: 'בחר הודעה מוכנה', send: 'שלח הודעה', cancel: 'ביטול', close: 'סגירה' },
  en: { del: 'Delete', read: 'Mark as read', choose: 'Choose a ready message', send: 'Send message', cancel: 'Cancel', close: 'Close' },
  ar: { del: 'حذف', read: 'وضع علامة «مقروءة»', choose: 'اختر رسالة جاهزة', send: 'إرسال الرسالة', cancel: 'إلغاء', close: 'إغلاق' },
}

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

describe('identical action arguments in every language', () => {
  test('send (success and refused, value kept), delete, mark read, ready-message send', async () => {
    const calls: Record<string, unknown> = {}
    for (const l of LOCALES) {
      const { container } = await mount(l, { selected: SELECTED_LEAD })
      const box = container.querySelector('#composer') as HTMLTextAreaElement
      fireEvent.change(box, { target: { value: '  שלום רב  ' } })
      await act(async () => fireEvent.submit(box.closest('form')!))
      S.sendReply.mockResolvedValueOnce({ ok: false, reason: 'send-failed', category: 'generic' })
      fireEvent.change(box, { target: { value: 'נוסח שנשמר' } })
      await act(async () => fireEvent.submit(box.closest('form')!))
      expect(box.value).toBe('נוסח שנשמר')
      cleanup()

      await mount(l)
      const rows = screen.getAllByTestId('conversation-row')
      await act(async () => fireEvent.contextMenu(rows[0]))
      await act(async () => fireEvent.click(rows[1]))
      await act(async () => fireEvent.click(screen.getByText(L[l].read)))
      await act(async () => fireEvent.click(screen.getByText(L[l].del)))
      await act(async () => fireEvent.click(within(dialog()!).getAllByRole('button').at(-2)!))
      cleanup()

      await mount(l, { selected: SELECTED_LEAD, messages: CLOSED_THREAD })
      await act(async () => fireEvent.click(screen.getByText(L[l].choose)))
      await act(async () => fireEvent.click(screen.getAllByRole('radio')[0]))
      await act(async () => fireEvent.click(screen.getByText(L[l].send)))
      cleanup()

      calls[l] = {
        send: S.sendReply.mock.calls,
        markRead: S.markRead.mock.calls,
        delete: S.deleteConversation.mock.calls,
        template: S.sendTemplate.mock.calls,
      }
      resetInboxSpies()
    }
    expect(calls.en).toEqual(calls.he)
    expect(calls.ar).toEqual(calls.he)
    expect(calls.he).toMatchObject({
      send: [[41, 'שלום רב', 1], [41, 'נוסח שנשמר', 1]],
      // Opening each thread marks it read (the read marker), then the list's own mark-as-read.
      markRead: [[1], [1], [1]],
      delete: [[1], [2]],
      template: [[41, TEMPLATES[0].id, 1]],
    })
  })

  test('load more: the same cursor and filters; only a non-Hebrew display locale is added', async () => {
    const { default: List } = await import('@/modules/inbox/mobile/ConversationListMobile')
    const { mapInboxRow } = await import('@/modules/inbox/mapInboxRow')
    const items = LIST_ROWS.slice(0, 2).map((r) => mapInboxRow(r, NOW))
    const cursor = { lastMessageAt: 'x', id: 1 } as never
    const out: Record<string, unknown[]> = {}
    for (const l of LOCALES) {
      S.prefs.userLocale = l
      render(await mobileShell(l, <List items={items} q='יוסי' nextCursor={cursor} formatWhen={() => ''} />))
      await act(async () => fireEvent.click(screen.getByRole('button', { name: /שיחות|conversations|المحادثات/ })))
      out[l] = S.loadMore.mock.calls.at(-1)!
      cleanup()
    }
    const { locale: _en, ...enRest } = out.en[0] as Record<string, unknown>
    const { locale: _ar, ...arRest } = out.ar[0] as Record<string, unknown>
    expect(out.he[0]).not.toHaveProperty('locale')
    expect(enRest).toEqual(out.he[0])
    expect(arRest).toEqual(out.he[0])
    expect([_en, _ar]).toEqual(['en', 'ar'])
  })
})

describe('sheets: Escape and the close button, focus return', () => {
  for (const l of ['en', 'ar'] as const) {
    test(`${l}: ready-message sheet closes on Escape and on its named close button; focus goes back to the trigger`, async () => {
      await mount(l, { selected: SELECTED_LEAD, messages: CLOSED_THREAD })
      const trigger = screen.getByText(L[l].choose) as HTMLButtonElement
      trigger.focus()
      await act(async () => fireEvent.click(trigger))
      expect(dialog()).not.toBeNull()
      await act(async () => fireEvent.keyDown(dialog()!, { key: 'Escape' }))
      expect(dialog()).toBeNull()
      expect(document.activeElement).toBe(trigger)
      await act(async () => fireEvent.click(trigger))
      await act(async () => fireEvent.click(within(dialog()!).getByLabelText(L[l].close)))
      expect(dialog()).toBeNull()
      expect(document.activeElement).toBe(trigger)
    })
  }

  test('message action sheet and delete confirmation close on Escape in every language', async () => {
    for (const l of LOCALES) {
      await mount(l, { selected: SELECTED_LEAD })
      await act(async () => longPress(screen.getAllByTestId('message-bubble')[0]))
      await act(async () => fireEvent.keyDown(dialog()!, { key: 'Escape' }))
      expect(dialog()).toBeNull()
      cleanup()
      await mount(l)
      await act(async () => fireEvent.contextMenu(screen.getAllByTestId('conversation-row')[0]))
      await act(async () => fireEvent.click(screen.getByText(L[l].del)))
      await act(async () => fireEvent.keyDown(dialog()!, { key: 'Escape' }))
      expect(dialog()).toBeNull()
      expect(screen.getByTestId('inbox-selection-bar')).toBeTruthy()
      cleanup()
    }
  })
})

describe('icon-only controls are named in the interface language; classes never change', () => {
  test('back, open lead, send, clear search, sheet close', async () => {
    const names = {
      en: ['Back to conversations', 'Open the lead יוסי לוי', 'Send', 'Clear search', 'Close'],
      ar: ['العودة إلى المحادثات', 'فتح العميل المحتمل יוסי לוי', 'إرسال', 'مسح البحث', 'إغلاق'],
    }
    for (const l of ['en', 'ar'] as const) {
      const [back, lead, send, clear, close] = names[l]
      await mount(l, { selected: SELECTED_LEAD })
      expect(screen.getByRole('link', { name: back })).toBeTruthy()
      expect(screen.getByRole('link', { name: lead })).toBeTruthy()
      expect(screen.getByRole('button', { name: send })).toBeTruthy()
      await act(async () => longPress(screen.getAllByTestId('message-bubble')[0]))
      expect(within(dialog()!).getByRole('button', { name: close })).toBeTruthy()
      cleanup()
      await mount(l, {}, { q: 'יוסי' })
      expect(screen.getByRole('button', { name: clear })).toBeTruthy()
      cleanup()
    }
  })

  test('rows, header controls, composer, search and selection buttons keep their classes (touch targets) in every language', async () => {
    const classes: Record<string, string[]> = {}
    for (const l of LOCALES) {
      const thread = await mount(l, { selected: SELECTED_LEAD })
      const header = [...thread.container.querySelectorAll('[data-testid="wa-thread-header"] a, form button, form textarea')].map((e) => e.className)
      cleanup()
      const list = await mount(l, {}, { q: 'יוסי' })
      const listCls = [...list.container.querySelectorAll('[data-testid="conversation-row"], input, button')].map((e) => e.className)
      await act(async () => fireEvent.contextMenu(screen.getAllByTestId('conversation-row')[0]))
      const selection = [...document.querySelectorAll('[data-testid="inbox-selection-bar"] button, .flex.w-full.flex-col.gap-2 button')].map((e) => e.className)
      classes[l] = [...header, ...listCls, ...selection]
      cleanup()
    }
    expect(classes.he.length).toBeGreaterThan(10)
    expect(classes.he.some((c) => c.includes('min-h-11') || c.includes('size-11'))).toBe(true)
    expect(classes.en).toEqual(classes.he)
    expect(classes.ar).toEqual(classes.he)
  })
})

describe('thread direction: sent right, received left, back arrow points where reading starts', () => {
  test('RTL keeps the Hebrew classes; LTR swaps bubble alignment and mirrors the back arrow', async () => {
    const seen: Record<string, { out: string[]; inn: string[]; arrow: string }> = {}
    for (const l of LOCALES) {
      await mount(l, { selected: SELECTED_LEAD })
      const side = (d: string) =>
        [...document.querySelectorAll(`[data-testid="message-bubble"][data-direction="${d}"]`)].map((b) => b.closest('li')!.className)
      const back = document.querySelector('[data-testid="wa-thread-header"] a')!
      seen[l] = { out: side('outbound'), inn: side('inbound'), arrow: back.querySelector('[class*="size-5"]')!.getAttribute('class')! }
      cleanup()
    }
    expect(seen.he.out.length).toBeGreaterThan(0)
    expect(seen.he.inn.length).toBeGreaterThan(0)
    // RTL: unchanged from the Hebrew baseline (items-start is the right edge).
    expect(seen.he.out.every((c) => c.includes('items-start'))).toBe(true)
    expect(seen.he.inn.every((c) => c.includes('items-end'))).toBe(true)
    expect(seen.ar).toEqual(seen.he)
    // LTR: the same physical sides, so the logical classes swap; the arrow is mirrored.
    expect(seen.en.out.every((c) => c.includes('items-end') && !c.includes('items-start'))).toBe(true)
    expect(seen.en.inn.every((c) => c.includes('items-start') && !c.includes('items-end'))).toBe(true)
    expect(seen.he.arrow).not.toContain('-scale-x-100')
    expect(seen.en.arrow).toContain('-scale-x-100')
  })
})
