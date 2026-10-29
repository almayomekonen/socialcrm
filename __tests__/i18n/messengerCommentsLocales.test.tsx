// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { UiLocale } from '@/lib/i18n/config'
import { MESSAGES, NOW, resetMessengerCommentsEnv } from './messengerCommentsEnv'
import { commentsScreen, messengerScreen } from './messengerCommentsHarness'
import { mcSpies as S, resetMcSpies } from './messengerCommentsMocks'
import { findHebrewLeaks } from './leakScan'

/**
 * `/inbox/messenger` and `/inbox/comments` in en / ar: translated chrome, the
 * region (lang/dir) on the page roots, customer text untouched (byte-identical
 * inner HTML in every language, `dir="auto"` only outside Hebrew), the phone
 * branches following the interface language too (mobile Phase D), and the interaction copy (toasts, failures, picker,
 * import outcomes with plurals) scanned for leaks. Hydration and the language
 * switch: messengerCommentsLocalesHydration. Arguments: …Behaviour.
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

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const HOUR = 3_600_000
const OPEN = { lastInboundAt: new Date(NOW - 2 * HOUR) }
const savedEnv = { ...process.env }

/** The server reads the stored preference; the client provider gets the same locale. */
async function mountMessenger(locale: UiLocale, o: Parameters<typeof messengerScreen>[1] = {}, sp: Record<string, string> = {}) {
  S.prefs.userLocale = locale
  return render(await messengerScreen(locale, o, sp))
}
async function mountComments(locale: UiLocale, o: Parameters<typeof commentsScreen>[1] = {}, sp: Record<string, string> = {}) {
  S.prefs.userLocale = locale
  return render(await commentsScreen(locale, o, sp))
}
const region = (el: Element | null) => [el?.getAttribute('lang') ?? null, el?.getAttribute('dir') ?? null]
const text = (el: Element) => el.textContent ?? ''
/** Customer text blocks: their inner HTML, with the attributes that may differ by locale. */
const blocks = (root: Element, selector: string) =>
  [...root.querySelectorAll(selector)].map((el) => ({ inner: el.innerHTML, dir: el.getAttribute('dir') }))

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
beforeEach(() => {
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

describe('Messenger — translated chrome and region', () => {
  test.each([
    ['en', 'ltr', ['Messenger conversations', 'Messenger contact', 'Sent: ', 'Came from an ad (summer)', 'Chose: לקבוע תור', 'Started the conversation', 'Agreed to receive messages', 'You can reply for about 22 more hours', 'Delivered', 'Load earlier messages']],
    ['ar', 'rtl', ['محادثات Messenger', 'جهة اتصال من Messenger', 'وصل من إعلان (summer)', 'اختار: לקבוע תור', 'بدأ المحادثة', 'يمكنك الرد خلال 22 ساعة تقريبًا', 'تم التسليم', 'تحميل الرسائل السابقة']],
  ] as const)('%s: thread page', async (locale, dir, expected) => {
    const { container } = await mountMessenger(locale, { selectedId: 1, hasMore: true, selectedOverrides: OPEN })
    const root = container.querySelector('.h-\\[calc\\(100dvh-6rem\\)\\]')
    expect(region(root)).toEqual([locale, dir])
    for (const s of expected) expect(text(container), s).toContain(s)
    expect(container.querySelector('#messenger-reply')?.getAttribute('placeholder')).not.toMatch(/[֐-׿]/)
  })

  test('list: unread, sent prefix, lead marker, fallback name (en / ar)', async () => {
    const en = await mountMessenger('en')
    for (const s of ['Unread', 'Sent: ', '· Lead', 'Messenger contact']) expect(text(en.container), s).toContain(s)
    en.unmount()
    const ar = await mountMessenger('ar')
    for (const s of ['غير مقروءة', 'أُرسلت: ', '· عميل محتمل']) expect(text(ar.container), s).toContain(s)
  })

  test('en: every page-level state says what / why / what next in English', async () => {
    const seen: string[] = []
    for (const [o, sp] of [
      [{ enabled: false }, {}],
      [{ pages: [] }, {}],
      [{ pages: [{ page_id: 'p2', granted_scopes: '[]', health_checked_at: null }] }, { permission: 'missing' }],
      [{ conversations: [] }, { permission: 'granted' }],
      [{ conversations: [], delivery: 'not_subscribed' }, {}],
      [{ conversations: [], delivery: 'reconnect' }, {}],
      [{ conversations: [] }, { q: 'x' }],
    ] as const) {
      const { container, unmount } = await mountMessenger('en', o as never, sp)
      expect(region(container.querySelector('.grid'))).toEqual(['en', 'ltr'])
      seen.push(text(container))
      unmount()
    }
    const all = seen.join('\n')
    for (const s of ['Your Facebook Page is not connected', "The Messenger permission wasn't approved", 'Usually because:', 'Import existing conversations from the Page',
      'Permission approved. New Messenger messages will appear here.', "Messenger messages aren't arriving here yet", 'The Facebook connection has expired', 'No conversations match your search.']) {
      expect(all, s).toContain(s)
    }
    expect(all).not.toMatch(/[֐-׿]/)
  })

  test('message text keeps byte-identical inner HTML in every language; dir="auto" only outside Hebrew', async () => {
    const out: Record<string, ReturnType<typeof blocks>> = {}
    for (const locale of ['he', 'en', 'ar'] as const) {
      const { container, unmount } = await mountMessenger(locale, { selectedId: 1, selectedOverrides: OPEN })
      out[locale] = blocks(container, '[role="group"] p.whitespace-pre-wrap')
      unmount()
    }
    const texts = MESSAGES.map((m) => m.text).filter(Boolean)
    expect(out.he.filter((b) => texts.includes(b.inner)).length).toBe(texts.length)
    expect(out.en.map((b) => b.inner).filter((t) => texts.includes(t))).toEqual(out.he.map((b) => b.inner).filter((t) => texts.includes(t)))
    expect(out.ar.map((b) => b.inner).filter((t) => texts.includes(t))).toEqual(out.he.map((b) => b.inner).filter((t) => texts.includes(t)))
    expect(out.he.every((b) => b.dir === null)).toBe(true)
    expect(out.en.filter((b) => texts.includes(b.inner)).every((b) => b.dir === 'auto')).toBe(true)
  })

  test('Hebrew declares nothing; the phone branch follows the interface language for an English user', async () => {
    const he = await mountMessenger('he', { selectedId: 1, selectedOverrides: OPEN })
    expect(he.container.querySelector('[lang]')).toBeNull()
    expect(he.container.querySelector('[dir="auto"]')).toBeNull()
    he.unmount()
    const phone = await mountMessenger('en', { mobile: true })
    expect(text(phone.container)).toContain('Unread')
    expect(text(phone.container)).not.toContain('לא נקרא')
    expect(screen.getByLabelText('Search Messenger conversations')).toBeTruthy()
    expect(phone.container.querySelector('[data-testid="messenger-mobile"]')?.getAttribute('lang')).toBe('en')
  })
})

describe('Messenger — interaction copy in en / ar', () => {
  test('en: send failures, toasts, saved replies, attachment rule, lead toasts — no Hebrew outside customer data', async () => {
    const { container } = await mountMessenger('en', { selectedId: 2, selectedOverrides: OPEN })
    const box = container.querySelector('#messenger-reply') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'hello' } })
    S.sendReply.mockResolvedValueOnce({ ok: false, reason: 'window_closed' })
    await act(async () => fireEvent.click(screen.getByLabelText('Send message')))
    expect(screen.getByRole('alert').textContent).toMatch(/^More than 24 hours/)
    await act(async () => fireEvent.click(screen.getByLabelText('Send message')))
    await act(async () => fireEvent.click(screen.getByLabelText('Saved replies')))
    const list = screen.getByRole('listbox')
    expect(list.getAttribute('aria-label')).toBe('Saved replies')
    expect(text(list)).toContain('Goes into the reply box for editing')
    expect(text(list)).toContain('Sends right away — includes buttons or a file')
    expect(findHebrewLeaks(list, [{ text: 'שעות פעילות', reason: 'customer-data' }, { text: 'אנחנו פתוחים א׳-ה׳ 9:00-18:00', reason: 'customer-data' }, { text: 'קביעת תור', reason: 'customer-data' }, { text: 'רוצה לקבוע תור?', reason: 'customer-data' }])).toEqual([])
    await act(async () => fireEvent.click(screen.getAllByRole('option')[1]))
    const big = new File(['x'], 'big.mp4', { type: 'video/mp4' })
    Object.defineProperty(big, 'size', { value: 30 * 1024 * 1024 })
    await act(async () => fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [big] } }))
    expect(screen.getByLabelText('Remove the file')).toBeTruthy()
    expect(container.querySelector('label[for="messenger-reply"]')?.textContent).toBe('File caption (optional)')
    await act(async () => fireEvent.click(screen.getByLabelText('Send message')))
    expect(screen.getByRole('alert').textContent).toBe('The file is too large. The limit is 25MB.')
    await act(async () => fireEvent.click(screen.getByText('Create lead')))
    S.createLead.mockResolvedValueOnce({ ok: false, reason: 'quota_exceeded' })
    await act(async () => fireEvent.click(screen.getByText('Create lead')))
    expect(S.toasts).toEqual([
      ['success', 'Message sent on Messenger'],
      ['success', 'Reply sent on Messenger'],
      ['success', 'Lead created'],
      ['error', "You've reached your plan's lead limit"],
    ])
  })

  test('ar: import outcomes use every plural the counts reach; failures by code', async () => {
    await mountMessenger('ar', { conversations: [] })
    const out: string[] = []
    for (const [conversations, hasMore] of [[1, false], [2, false], [3, true], [11, false], [100, false]] as const) {
      S.importHistory.mockResolvedValueOnce({ conversations, messages: 5, hasMore })
      await act(async () => fireEvent.click(screen.getByText('استيراد المحادثات الحالية من الصفحة')))
      out.push(screen.getByRole('status').textContent ?? '')
    }
    S.importHistory.mockResolvedValueOnce({ reason: 'forbidden' })
    await act(async () => fireEvent.click(screen.getByText('استيراد المحادثات الحالية من الصفحة')))
    expect(out).toEqual([
      'تم استيراد محادثة واحدة (5 رسالة).',
      'تم استيراد محادثتين (5 رسالة).',
      'تم استيراد 3 محادثات (5 رسالة). توجد محادثات أخرى في الصفحة — يمكنك التشغيل مرة أخرى.',
      'تم استيراد 11 محادثة (5 رسالة).',
      'تم استيراد 100 محادثة (5 رسالة).',
    ])
    expect(screen.getByRole('alert').textContent).toBe('يمكن للمدير فقط استيراد المحادثات')
  })
})

describe('Comments — translated chrome, region, customer text', () => {
  test.each([
    ['en', 'ltr', ['Facebook comments', 'All', 'Open', 'Converted to lead', 'Ignored', 'Deleted on Facebook', 'Reply to a comment', "The comment text wasn't received from Facebook", 'Watch the video attached to the comment', 'Show more', 'The post is no longer available on Facebook', 'Comment in a thread on the post', 'Open the post on Facebook', 'הסטודיו של דנה (your Page)', 'The Page (your Page)', 'Sent from SocialCRM', 'Convert to lead', 'Open lead', 'Reply to comment', 'Load more comments']],
    ['ar', 'rtl', ['تعليقات فيسبوك', 'الكل', 'مفتوحة', 'تم التجاهل', 'حُذف على فيسبوك', 'لم يصل نص التعليق من فيسبوك', 'عرض المزيد', 'فتح المنشور على فيسبوك', 'الصفحة (صفحتك)', 'أُرسل من SocialCRM', 'التحويل إلى عميل محتمل', 'الرد على التعليق']],
  ] as const)('%s: feed', async (locale, dir, expected) => {
    const { container } = await mountComments(locale, { nextCursor: { receivedAt: '2026-10-27T00:00:00.000Z', id: 1 } })
    expect(region(container.firstElementChild)).toEqual([locale, dir])
    for (const s of expected) expect(text(container), s).toContain(s)
    expect(container.querySelector('[data-comment-id="9009"] [aria-hidden]')?.textContent).toBe(locale === 'en' ? 'L' : 'ع')
  })

  test('comment, reply and post text: identical inner HTML in he / en / ar', async () => {
    const out: Record<string, ReturnType<typeof blocks>> = {}
    for (const locale of ['he', 'en', 'ar'] as const) {
      const { container, unmount } = await mountComments(locale)
      // The post excerpt only where it is the Page's text ("no longer available" is ours).
      out[locale] = blocks(container, 'p.whitespace-pre-wrap, p.line-clamp-2.text-gray-700')
      unmount()
    }
    expect(out.he.length).toBeGreaterThan(8)
    expect(out.en.map((b) => b.inner)).toEqual(out.he.map((b) => b.inner))
    expect(out.ar.map((b) => b.inner)).toEqual(out.he.map((b) => b.inner))
    expect(out.he.every((b) => b.dir === null)).toBe(true)
    expect(out.ar.every((b) => b.dir === 'auto')).toBe(true)
  })

  test('en: reply form, reply failure, convert toast — and the phone feed follows the interface language', async () => {
    const { container } = await mountComments('en', {}, { status: 'open' })
    const card = within(container.querySelector('[data-comment-id="9001"]') as HTMLElement)
    await act(async () => fireEvent.click(card.getByText('Reply to comment')))
    const box = container.querySelector('[data-comment-id="9001"] textarea') as HTMLTextAreaElement
    expect(box.placeholder).toBe('Write a reply as the Page...')
    expect(container.querySelector(`label[for="${box.id}"]`)?.textContent).toBe('Reply as the Page to מיכל דוד')
    expect(card.getByText('Post reply').closest('button')?.getAttribute('title')).toBe('Write a reply to post it')
    fireEvent.change(box, { target: { value: 'thanks' } })
    S.reply.mockResolvedValueOnce({ ok: false, reason: 'blocked' })
    await act(async () => fireEvent.click(card.getByText('Post reply')))
    expect(card.getByRole('alert').textContent).toMatch(/^Facebook has temporarily blocked/)
    await act(async () => fireEvent.click(card.getByText('Convert to lead')))
    expect(S.toasts.map((t) => t.slice(0, 2))).toEqual([['success', 'Lead created · Open lead']])
    cleanup()
    const phone = await mountComments('en', { mobile: true })
    expect(text(phone.container)).toContain('Convert to lead')
    expect(text(phone.container)).not.toContain('המר לליד')
    expect(phone.container.querySelector('[data-testid="facebook-comments-mobile"]')?.getAttribute('lang')).toBe('en')
  })
})

describe('producers — locale argument, Hebrew default', () => {
  test('window hint, event lines, attachment rejections, notices', async () => {
    const { messengerWindow, messengerWindowHint } = await import('@/lib/facebook/messenger/rules')
    const { describeMessengerEvent } = await import('@/modules/messenger/components/MessengerEventLine')
    const { attachmentRejectionCopy, ATTACHMENT_REJECTION_COPY } = await import('@/lib/facebook/messenger/attachmentRules')
    const { metaInboxNotice, META_INBOX_NOTICE_CODES } = await import('@/lib/connections/metaNoticeCopy')
    const { FACEBOOK_NOTICES } = await import('@/lib/connections/messages')
    const now = new Date(NOW)
    const hint = (h: number, l?: UiLocale) => messengerWindowHint(messengerWindow(new Date(NOW - h * HOUR), now), now, l)
    expect([hint(22.5, 'en'), hint(1, 'en'), hint(23.5, 'en')]).toEqual(['You can reply for about 1 more hour', 'You can reply for about 23 more hours', 'The reply window closes in less than an hour'])
    expect([hint(22.5, 'ar'), hint(21.5, 'ar'), hint(20.5, 'ar'), hint(1, 'ar')]).toEqual(['يمكنك الرد خلال ساعة تقريبًا', 'يمكنك الرد خلال ساعتين تقريبًا', 'يمكنك الرد خلال 3 ساعات تقريبًا', 'يمكنك الرد خلال 23 ساعة تقريبًا'])
    expect(hint(1)).toBe('אפשר להשיב עוד כ-23 שעות')
    const ev = { id: 1, kind: 'referral', title: 'ODD', payload: 'ref', targetMessageId: null, occurredAt: now } as const
    expect(describeMessengerEvent(ev, 'en')).toBe('Came from a link (ref)')
    expect(describeMessengerEvent(ev)).toBe('הגיע מקישור (ref)')
    for (const r of ['empty', 'too_large', 'blocked_type'] as const) {
      expect(attachmentRejectionCopy(r)).toBe(ATTACHMENT_REJECTION_COPY[r])
      expect(attachmentRejectionCopy(r, 'ar')).not.toMatch(/[֐-׿]/)
    }
    for (const code of META_INBOX_NOTICE_CODES) {
      expect(metaInboxNotice(code)).toBe(FACEBOOK_NOTICES[code])
      const ar = metaInboxNotice(code, 'ar')
      expect(ar.tone).toBe(FACEBOOK_NOTICES[code].tone)
      expect(JSON.stringify(ar), code).not.toMatch(/[֐-׿]/)
      expect(Boolean(ar.reasons), code).toBe(Boolean(FACEBOOK_NOTICES[code].reasons))
    }
  })
})
