// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CLOSED_THREAD, EXPIRED, LIST_ROWS, NOW, SELECTED_LEAD, SELECTED_LEADLESS, inboxEnv, resetInboxEnv } from './inboxEnv'
import { inboxSpies as S, resetInboxSpies } from './inboxMocks'
import { AGES, AGE_ROWS, SLUG_TEMPLATES, mobileInboxPage, mobileShell, withMobileEnv } from './inboxMobileHarness'

/**
 * HEBREW BASELINE — MOBILE inbox INTERACTIONS and PRODUCERS: what the rep sees
 * after acting on a phone (selection mode + its bar, the delete confirmation,
 * mark-as-read, load more, every send refusal, the message action sheet, the
 * ready-message sheet, the leadless actions) with the exact arguments each
 * action receives, plus the relative-time and ready-message-title producers as
 * data. Recorded BEFORE the mobile Phase D package, with NO i18n provider.
 * Server HTML: inboxMobileHebrewBaseline.test.tsx.
 *
 * Normalized before comparing, and only these: React `useId` values.
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

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const html = (el: Element | null | undefined) => {
  if (!el) throw new Error('element not found')
  return normalizeIds(el.outerHTML)
}
const mount = async (overrides: Partial<typeof inboxEnv> = {}, sp: Record<string, string> = {}, ent?: typeof EXPIRED) =>
  render(await mobileShell(null, await withMobileEnv(overrides, () => mobileInboxPage(sp)), ent))
const rows = () => screen.getAllByTestId('conversation-row')
const dialog = () => document.querySelector('[role="dialog"]')
/** A fresh long press: a touch down/up resets the hook, then the platform's context-menu gesture. */
const longPress = (el: Element) => {
  fireEvent.pointerDown(el, { pointerType: 'touch', button: 0, clientX: 8, clientY: 8 })
  fireEvent.pointerUp(el, { pointerType: 'touch', button: 0, clientX: 8, clientY: 8 })
  fireEvent.contextMenu(el)
}

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// The read marker refreshes the unread badge over fetch; answer it without a network.
globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ counts: { whatsappUnread: 2 } }))) as typeof fetch

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetInboxEnv()
  resetInboxSpies()
})

describe('Hebrew baseline — mobile list selection, delete, mark read', () => {
  test('selection mode (one, two), selection bar, delete confirmation (one / several), failures, success; mark read failure + success', async () => {
    await mount()
    const out: Record<string, unknown> = {}
    await act(async () => fireEvent.contextMenu(rows()[0]))
    out.selectedOne = html(screen.getByTestId('inbox-selection-bar'))
    out.actionsOne = html(screen.getByText('מחק').parentElement)
    await act(async () => fireEvent.click(screen.getByText('מחק')))
    out.confirmOne = html(dialog())
    await act(async () => fireEvent.click(screen.getAllByText('ביטול').at(-1)!))
    await act(async () => fireEvent.click(rows()[1]))
    out.selectedTwo = html(screen.getByTestId('inbox-selection-bar'))
    await act(async () => fireEvent.click(screen.getByText('מחק')))
    out.confirmTwo = html(dialog())
    S.deleteConversation.mockResolvedValueOnce({ ok: false, deleted: false }).mockResolvedValueOnce({ ok: false, deleted: false })
    await act(async () => fireEvent.click(screen.getByText('מחק שיחות')))
    out.afterAllFailed = rows().length
    await act(async () => fireEvent.click(screen.getByText('מחק')))
    S.deleteConversation.mockResolvedValueOnce({ ok: false, deleted: false })
    await act(async () => fireEvent.click(screen.getByText('מחק שיחות')))
    out.afterSomeFailed = rows().length
    out.selectionAfterPartial = html(screen.getByTestId('inbox-selection-bar'))
    S.markRead.mockResolvedValueOnce({ ok: false })
    await act(async () => fireEvent.click(screen.getByText('סמן כנקרא')))
    await act(async () => fireEvent.click(screen.getByText('סמן כנקרא')))
    await act(async () => fireEvent.click(screen.getByText('מחק')))
    await act(async () => fireEvent.click(screen.getByText('מחק שיחה')))
    out.rowsLeft = rows().map((r) => r.getAttribute('data-conversation-id'))
    out.deleteCalls = S.deleteConversation.mock.calls
    out.markReadCalls = S.markRead.mock.calls
    out.toasts = S.toasts
    expect(out).toMatchSnapshot()
  })

  test('load more: pending label, appended rows with client-formatted times, arguments', async () => {
    const { default: List } = await import('@/modules/inbox/mobile/ConversationListMobile')
    const { mapInboxRow } = await import('@/modules/inbox/mapInboxRow')
    const items = LIST_ROWS.slice(0, 2).map((r) => mapInboxRow(r, NOW))
    S.loadMore.mockResolvedValueOnce({ items: AGE_ROWS.map((r) => mapInboxRow(r, NOW)), nextCursor: null })
    const r = render(await mobileShell(null, <List items={items} q='יוסי' nextCursor={{ lastMessageAt: 'x', id: 1 } as never} formatWhen={() => 'לפני שעה'} />))
    const out: Record<string, unknown> = { button: html(screen.getByText('טען עוד שיחות')) }
    await act(async () => fireEvent.click(screen.getByText('טען עוד שיחות')))
    out.list = normalizeIds(r.container.innerHTML)
    out.calls = S.loadMore.mock.calls
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — mobile thread actions', () => {
  test('send: success clears the box; every refusal reason and a failure category keep the text', async () => {
    const { container } = await mount({ selected: SELECTED_LEAD })
    const out: Record<string, unknown> = {}
    const box = container.querySelector('#composer') as HTMLTextAreaElement
    const send = () => act(async () => fireEvent.submit(box.closest('form')!))
    fireEvent.change(box, { target: { value: 'שלום רב' } })
    await send()
    out.valueAfterSuccess = box.value
    const reasons = ['no-connection', 'no-recipient', 'lead-not-found', 'window-closed', 'window-unknown', 'health-blocked', 'leadless', 'send-failed', 'persist-failed', 'too-long', 'invalid-input', 'empty', 'unmapped']
    for (const reason of reasons) {
      S.sendReply.mockResolvedValueOnce({ ok: false, reason })
      fireEvent.change(box, { target: { value: `ניסיון ${reason}` } })
      await send()
      out[reason] = screen.getByRole('alert').textContent
    }
    S.sendReply.mockResolvedValueOnce({ ok: false, reason: 'send-failed', category: 'recipient' })
    await send()
    out.category = screen.getByRole('alert').textContent
    out.valueAfterFailures = box.value
    out.alertHtml = html(screen.getByRole('alert'))
    out.sendCalls = S.sendReply.mock.calls
    out.refreshes = S.refreshes
    expect(out).toMatchSnapshot()
  })

  test('message action sheet: open on long press, copy success / failure toasts, cancel', async () => {
    await mount({ selected: SELECTED_LEAD })
    const out: Record<string, unknown> = {}
    const bubble = screen.getAllByTestId('message-bubble')[0]
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } })
    await act(async () => longPress(bubble))
    out.sheet = html(dialog())
    await act(async () => fireEvent.click(screen.getByText('העתק')))
    out.closedAfterCopy = dialog() === null
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) } })
    await act(async () => longPress(screen.getAllByTestId('message-bubble')[0]))
    await act(async () => fireEvent.click(screen.getByText('העתק')))
    await act(async () => longPress(screen.getAllByTestId('message-bubble')[0]))
    await act(async () => fireEvent.keyDown(dialog()!, { key: 'Escape' }))
    out.closedAfterEscape = dialog() === null
    out.toasts = S.toasts
    expect(out).toMatchSnapshot()
  })

  test('ready-message sheet: open, slug titles, choose, preview, send failure (server text) then success', async () => {
    const out: Record<string, unknown> = {}
    await mount({ selected: SELECTED_LEAD, messages: CLOSED_THREAD, composer: { ...inboxEnv.composer, templates: SLUG_TEMPLATES } })
    await act(async () => fireEvent.click(screen.getByText('בחר הודעה מוכנה')))
    out.sheet = html(dialog())
    await act(async () => fireEvent.click(screen.getAllByRole('radio')[1]))
    out.withPreview = html(dialog())
    S.sendTemplate.mockResolvedValueOnce({ ok: false, error: 'שגיאת שרת' })
    await act(async () => fireEvent.click(screen.getByText('שלח הודעה')))
    await act(async () => fireEvent.click(screen.getByText('שלח הודעה')))
    out.closedAfterSend = dialog() === null
    out.calls = S.sendTemplate.mock.calls
    out.toasts = S.toasts
    expect(out).toMatchSnapshot()
  })

  test('leadless actions on the green header: create (quota / failure), personal failure', async () => {
    await mount({ selected: SELECTED_LEADLESS })
    const out: Record<string, unknown> = {}
    S.promote.mockResolvedValueOnce({ ok: false, reason: 'quota_exceeded' })
    await act(async () => fireEvent.click(screen.getByText('+ צור ליד')))
    out.quota = screen.getByRole('alert').textContent
    S.promote.mockResolvedValueOnce({ ok: false, reason: 'x' })
    await act(async () => fireEvent.click(screen.getByText('+ צור ליד')))
    out.createFailed = html(screen.getByRole('alert'))
    S.markPersonal.mockResolvedValueOnce({ ok: false })
    await act(async () => fireEvent.click(screen.getByText('סמן כאישי')))
    out.personalFailed = screen.getByRole('alert').textContent
    out.calls = { promote: S.promote.mock.calls, personal: S.markPersonal.mock.calls }
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — mobile producers (fixed clock)', () => {
  test('relativeTimeHe for every bucket and edge; readyMessageTitle for every title shape', async () => {
    const { relativeTimeHe } = await import('@/modules/inbox/mobile/relativeTime')
    const { readyMessageTitle } = await import('@/modules/templates/mobile/readyMessageTitle')
    const MIN = 60_000
    const edges = [0, 59_999, 60_000, 119_999, 120_000, 59 * MIN, 60 * MIN, 119 * MIN, 120 * MIN, 23 * 60 * MIN, 24 * 60 * MIN, 47 * 60 * MIN, 48 * 60 * MIN, 6 * 1440 * MIN, 7 * 1440 * MIN]
    expect({
      buckets: Object.entries(AGES).map(([k, ago]) => [k, relativeTimeHe(ago == null ? null : new Date(NOW - ago).toISOString(), NOW)]),
      edges: edges.map((ago) => [ago, relativeTimeHe(new Date(NOW - ago).toISOString(), NOW)]),
      invalid: [relativeTimeHe('not a date', NOW), relativeTimeHe(undefined, NOW), relativeTimeHe('', NOW)],
      titles: [...SLUG_TEMPLATES.map((t) => t.displayTitle), null, undefined, '  ', 'Lead_First_Contact', 'שלום_1'].map((t) => [String(t), readyMessageTitle(t)]),
    }).toMatchSnapshot()
  })
})
