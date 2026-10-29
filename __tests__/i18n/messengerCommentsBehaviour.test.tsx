// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { UiLocale } from '@/lib/i18n/config'
import { NOW, resetMessengerCommentsEnv } from './messengerCommentsEnv'
import { commentsScreen, messengerScreen } from './messengerCommentsHarness'
import { FakeXhr, mcSpies as S, resetMcSpies, resetXhr, xhr } from './messengerCommentsMocks'

/**
 * Behaviour is the same in every language: each action sends the same arguments
 * in he / en / ar, the composer and reply values are what the rep typed, the
 * saved-reply picker and search keep their keyboard paths, icon-only controls
 * have a name in the interface language, and the filter links are unchanged.
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
// The shared lead picker (out of scope) as a stub that picks lead 55; its trigger label is ours.
vi.mock('@/components/billing/lead-picker/LeadPicker', () => ({
  default: (p: { currentLeadName: string; onPick: (id: number) => void }) => (
    <button type='button' data-testid='lead-picker' onClick={() => p.onPick(55)}>
      {p.currentLeadName}
    </button>
  ),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const HOUR = 3_600_000
const OPEN = { lastInboundAt: new Date(NOW - 2 * HOUR) }
const savedEnv = { ...process.env }
const LOCALES = ['he', 'en', 'ar'] as const

const NAMES: Record<UiLocale, Record<string, string>> = {
  he: { send: 'שלח הודעה', attach: 'צרף קובץ', saved: 'תשובות שמורות', remove: 'הסר את הקובץ', clear: 'נקה חיפוש', create: 'צור ליד', import: 'ייבא שיחות קיימות מהדף', older: 'טען הודעות קודמות', reply: 'ענה לתגובה', publish: 'פרסם תשובה', convert: 'המר לליד', more: 'טען עוד תגובות', cancel: 'ביטול' },
  en: { send: 'Send message', attach: 'Attach a file', saved: 'Saved replies', remove: 'Remove the file', clear: 'Clear search', create: 'Create lead', import: 'Import existing conversations from the Page', older: 'Load earlier messages', reply: 'Reply to comment', publish: 'Post reply', convert: 'Convert to lead', more: 'Load more comments', cancel: 'Cancel' },
  ar: { send: 'إرسال الرسالة', attach: 'إرفاق ملف', saved: 'الردود المحفوظة', remove: 'إزالة الملف', clear: 'مسح البحث', create: 'إنشاء عميل محتمل', import: 'استيراد المحادثات الحالية من الصفحة', older: 'تحميل الرسائل السابقة', reply: 'الرد على التعليق', publish: 'نشر الرد', convert: 'التحويل إلى عميل محتمل', more: 'تحميل المزيد من التعليقات', cancel: 'إلغاء' },
}

async function messenger(locale: UiLocale, o: Parameters<typeof messengerScreen>[1] = {}, sp: Record<string, string> = {}) {
  S.prefs.userLocale = locale
  return render(await messengerScreen(locale, o, sp))
}
async function comments(locale: UiLocale, o: Parameters<typeof commentsScreen>[1] = {}, sp: Record<string, string> = {}) {
  S.prefs.userLocale = locale
  return render(await commentsScreen(locale, o, sp))
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
})
beforeEach(() => {
  Object.assign(process.env, { UI_LOCALE_ENABLED: '1', UI_LOCALE_AGENCY_ALLOWLIST: '103' })
})
afterAll(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  process.env = { ...savedEnv }
})
afterEach(() => {
  cleanup()
  sessionStorage.clear()
  resetMessengerCommentsEnv()
  resetMcSpies()
  resetXhr()
})

/** Run one scenario per locale; return what each recorded. */
async function perLocale(run: (locale: UiLocale, n: Record<string, string>) => Promise<unknown>) {
  const out: Record<string, unknown> = {}
  for (const locale of LOCALES) {
    out[locale] = await run(locale, NAMES[locale])
    cleanup()
    sessionStorage.clear()
    resetMcSpies()
    resetXhr()
  }
  return out
}

describe('Messenger — identical arguments and values in every language', () => {
  test('text send, saved reply insert / send, attachment upload, earlier messages', async () => {
    const out = await perLocale(async (locale, n) => {
      const { container } = await messenger(locale, { selectedId: 1, hasMore: true, selectedOverrides: OPEN })
      const box = container.querySelector('#messenger-reply') as HTMLTextAreaElement
      fireEvent.change(box, { target: { value: 'שלום, hello 1,200' } })
      const typed = box.value
      await act(async () => fireEvent.click(screen.getByLabelText(n.send)))
      await act(async () => fireEvent.click(screen.getByLabelText(n.saved)))
      await act(async () => fireEvent.click(screen.getAllByRole('option')[0]))
      const inserted = box.value
      await act(async () => fireEvent.click(screen.getByLabelText(n.saved)))
      await act(async () => fireEvent.click(screen.getAllByRole('option')[1]))
      const f = new File(['x'], 'doc.pdf', { type: 'application/pdf' })
      await act(async () => fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [f] } }))
      fireEvent.change(box, { target: { value: 'caption' } })
      await act(async () => fireEvent.click(screen.getByLabelText(n.send)))
      await act(async () => fireEvent.click(screen.getByText(n.older)))
      return { typed, inserted, send: S.sendReply.mock.calls, saved: S.sendSaved.mock.calls, upload: xhr.sent, older: S.loadOlder.mock.calls, refreshes: S.refreshes }
    })
    expect(out.en).toEqual(out.he)
    expect(out.ar).toEqual(out.he)
    expect((out.he as { send: unknown[][] }).send).toEqual([[1, 'שלום, hello 1,200']])
  })

  test('lead create / link, history import', async () => {
    const out = await perLocale(async (locale, n) => {
      await messenger(locale, { selectedId: 2, selectedOverrides: OPEN })
      await act(async () => fireEvent.click(screen.getByText(n.create)))
      await act(async () => fireEvent.click(screen.getByTestId('lead-picker')))
      cleanup()
      await messenger(locale, { conversations: [] })
      await act(async () => fireEvent.click(screen.getByText(n.import)))
      return { create: S.createLead.mock.calls, link: S.linkLead.mock.calls, imported: S.importHistory.mock.calls, refreshes: S.refreshes }
    })
    expect(out.en).toEqual(out.he)
    expect(out.ar).toEqual(out.he)
  })

  test('keyboard: picker Escape returns focus to its trigger; search Escape clears; icon-only controls are named', async () => {
    for (const locale of LOCALES) {
      const n = NAMES[locale]
      const { container } = await messenger(locale, { selectedId: 1, selectedOverrides: OPEN })
      const trigger = screen.getByLabelText(n.saved)
      await act(async () => fireEvent.click(trigger))
      fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
      fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
      expect(screen.queryByRole('listbox'), locale).toBeNull()
      expect(document.activeElement, locale).toBe(trigger)
      for (const name of [n.send, n.attach, n.saved]) {
        const el = screen.getByLabelText(name)
        expect(el.tagName, `${locale} ${name}`).toBe('BUTTON')
        expect(el.getAttribute('title'), `${locale} ${name}`).toBeTruthy()
      }
      await act(async () => fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] } }))
      expect(screen.getByLabelText(n.remove).getAttribute('title'), locale).toBe(n.remove)
      cleanup()
      await messenger(locale, {}, { q: 'נועה' })
      const input = screen.getByRole('searchbox') as HTMLInputElement
      expect(screen.getByLabelText(n.clear).tagName, locale).toBe('BUTTON')
      fireEvent.keyDown(input, { key: 'Escape' })
      expect(input.value, locale).toBe('')
      cleanup()
    }
    expect(S.replaces.every((r) => r === '/inbox/messenger')).toBe(true)
  })
})

describe('Comments — identical arguments and values in every language', () => {
  test('reply, cancel, convert, load more; the filter links are unchanged', async () => {
    const out = await perLocale(async (locale, n) => {
      const { container } = await comments(locale, { nextCursor: { receivedAt: '2026-10-27T00:00:00.000Z', id: 1 } })
      const card = within(container.querySelector('[data-comment-id="9001"]') as HTMLElement)
      await act(async () => fireEvent.click(card.getByText(n.reply)))
      const box = container.querySelector('[data-comment-id="9001"] textarea') as HTMLTextAreaElement
      fireEvent.change(box, { target: { value: '  תודה! thanks  ' } })
      S.reply.mockResolvedValueOnce({ ok: false, reason: 'rate_limited' })
      await act(async () => fireEvent.click(card.getByText(n.publish)))
      const keptAfterFailure = box.value
      await act(async () => fireEvent.click(card.getByText(n.publish)))
      const six = within(container.querySelector('[data-comment-id="9006"]') as HTMLElement)
      await act(async () => fireEvent.click(six.getByText(n.reply)))
      await act(async () => fireEvent.click(six.getByText(n.cancel)))
      await act(async () => fireEvent.click(six.getByText(n.convert)))
      await act(async () => fireEvent.click(screen.getByText(n.more)))
      const filters = [...container.querySelectorAll('nav a')].map((a) => [a.getAttribute('href'), a.getAttribute('aria-current')])
      const leadLinks = [...container.querySelectorAll('a[href^="/clients/"]')].map((a) => a.getAttribute('href'))
      return { keptAfterFailure, reply: S.reply.mock.calls, convert: S.convert.mock.calls, more: S.loadMore.mock.calls, filters, leadLinks, refreshes: S.refreshes }
    })
    expect(out.en).toEqual(out.he)
    expect(out.ar).toEqual(out.he)
    expect((out.he as { reply: unknown[][] }).reply).toEqual([['9001', 'תודה! thanks'], ['9001', 'תודה! thanks']])
  })
})
