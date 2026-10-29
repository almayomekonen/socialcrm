// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MESSAGES, NOW, resetMessengerCommentsEnv } from './messengerCommentsEnv'
import { messengerScreen } from './messengerCommentsHarness'
import { FakeXhr, mcSpies as S, resetMcSpies, resetXhr, xhr } from './messengerCommentsMocks'

/**
 * HEBREW BASELINE — `/inbox/messenger` INTERACTIONS on the REAL page: the composer
 * (send success / every failure reason / detail precedence, the attachment tray
 * and every attachment-rule and upload failure), the saved-reply picker (open,
 * keyboard, insert vs send), "load earlier", the lead actions (create / link and
 * every failure), the history import (every outcome) and search. Recorded BEFORE
 * the Phase D Messenger/Comments package: the Hebrew text, the toasts and the
 * action arguments must stay identical. Comments: …CommentsInteractions.
 */

vi.mock('next/navigation', async () => (await import('./messengerCommentsMocks')).navigationModule())
vi.mock('next/server', async () => (await import('./messengerCommentsMocks')).nextServerModule())
vi.mock('next/cache', async () => (await import('./inboxMocks')).cacheModule())
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./messengerCommentsEnv')).messengerEnv.user }))
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: null, agencyLocale: null }) }))
vi.mock('@/config/db', async () => (await import('./messengerCommentsMocks')).dbModule())
vi.mock('@/lib/device', async () => (await import('./messengerCommentsMocks')).deviceModule())
vi.mock('@/lib/facebook/permissions', async () => (await import('./messengerCommentsMocks')).permissionsModule())
vi.mock('@/modules/messenger/queries', async () => (await import('./messengerCommentsMocks')).messengerQueriesModule())
vi.mock('@/db/messengerSavedReplies', async () => (await import('./messengerCommentsMocks')).savedRepliesModule())
vi.mock('@/lib/facebook/messenger/deliveryCheck', async () => (await import('./messengerCommentsMocks')).deliveryModule())
vi.mock('@/lib/facebook/messenger/profile', async () => (await import('./messengerCommentsMocks')).profileModule())
vi.mock('@/modules/messenger/actions', async () => (await import('./messengerCommentsMocks')).messengerActionsModule())
vi.mock('@/modules/messenger/leadActions', async () => (await import('./messengerCommentsMocks')).messengerLeadActionsModule())
vi.mock('@/modules/messenger/profileActions', async () => (await import('./messengerCommentsMocks')).messengerProfileActionsModule())
vi.mock('@/actions/clients', () => ({ searchLeads: async () => [] }))
vi.mock('@/lib/toast', async () => (await import('./messengerCommentsMocks')).toastModule())
// The shared lead picker (out of scope, still Hebrew) as a stub that picks lead 55.
vi.mock('@/components/billing/lead-picker/LeadPicker', () => ({
  default: (p: { currentLeadName: string; onPick: (id: number) => void }) => (
    <button type='button' data-testid='lead-picker' onClick={() => p.onPick(55)}>
      {p.currentLeadName}
    </button>
  ),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const HOUR = 3_600_000
const OPEN = { lastInboundAt: new Date(NOW - HOUR) }
const mount = async (o: Parameters<typeof messengerScreen>[1] = {}) => render(await messengerScreen(null, o))
const alertText = () => screen.queryByRole('alert')?.textContent ?? null
const deferred = () => {
  let resolve!: (v: Record<string, unknown>) => void
  const promise = new Promise<Record<string, unknown>>((r) => (resolve = r))
  return { promise, resolve }
}
const file = (name: string, type: string, size: number) => {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
})
afterAll(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
afterEach(() => {
  cleanup()
  sessionStorage.clear()
  resetMessengerCommentsEnv()
  resetMcSpies()
  resetXhr()
})

const REASONS = ['not_enabled', 'not_found', 'empty', 'too_long', 'invalid_file', 'window_closed', 'permission_missing',
  'reconnect_required', 'recipient_unavailable', 'rate_limited', 'meta_error', 'unmapped'] as const

describe('Hebrew baseline — Messenger composer', () => {
  test('text: success, every failure reason, detail wins, value kept on failure', async () => {
    const { container } = await mount({ selectedId: 1, selectedOverrides: OPEN })
    const box = container.querySelector('#messenger-reply') as HTMLTextAreaElement
    const out: Record<string, unknown> = { sendTitleEmpty: screen.getByLabelText('שלח הודעה').getAttribute('title') }
    fireEvent.change(box, { target: { value: 'שלום' } })
    out.sendTitleReady = screen.getByLabelText('שלח הודעה').getAttribute('title')
    for (const reason of REASONS) {
      S.sendReply.mockResolvedValueOnce({ ok: false, reason })
      await act(async () => fireEvent.click(screen.getByLabelText('שלח הודעה')))
      out[reason] = alertText()
    }
    S.sendReply.mockResolvedValueOnce({ ok: false, reason: 'empty', detail: 'פירוט מהשרת' })
    await act(async () => fireEvent.click(screen.getByLabelText('שלח הודעה')))
    out.detail = alertText()
    out.valueAfterFailures = box.value
    const pending = deferred()
    S.sendReply.mockReturnValueOnce(pending.promise)
    await act(async () => fireEvent.click(screen.getByLabelText('שלח הודעה')))
    out.pendingLabel = container.querySelector('button[aria-label^="שולח"]')?.getAttribute('aria-label') ?? null
    await act(async () => pending.resolve({ ok: true }))
    out.valueAfterSuccess = box.value
    out.calls = S.sendReply.mock.calls
    out.toasts = S.toasts
    out.refreshes = S.refreshes
    expect(out).toMatchSnapshot()
  })

  test('attachments: tray, caption label, rule rejections, upload success / server refusal / network failure, remove', async () => {
    const { container } = await mount({ selectedId: 1, selectedOverrides: OPEN })
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const box = container.querySelector('#messenger-reply') as HTMLTextAreaElement
    const pick = (f: File) => act(async () => fireEvent.change(input, { target: { files: [f] } }))
    const send = () => act(async () => fireEvent.click(screen.getByLabelText('שלח הודעה')))
    const out: Record<string, unknown> = {}
    await pick(file('תמונה.png', 'image/png', 2 * 1024 * 1024))
    // The local preview's object URL is random per run.
    out.tray = container.querySelector('.mb-2')?.outerHTML.replace(/blob:[^"]+/, 'blob:«url»') ?? null
    out.captionLabel = container.querySelector('label[for="messenger-reply"]')?.textContent
    out.captionPlaceholder = box.getAttribute('placeholder')
    for (const [name, f] of [
      ['tooLarge', file('big.mp4', 'video/mp4', 30 * 1024 * 1024)],
      ['empty', file('empty.txt', 'text/plain', 0)],
      ['blocked', file('run.exe', 'application/x-msdownload', 100)],
    ] as const) {
      await pick(f)
      await send()
      out[name] = alertText()
    }
    await pick(file('doc.pdf', 'application/pdf', 5000))
    fireEvent.change(box, { target: { value: 'כיתוב' } })
    xhr.respond = { status: 413, body: { ok: false, reason: 'invalid_file', detail: 'הקובץ גדול מדי. המגבלה היא 25MB.' }, network: false }
    await send()
    out.serverDetail = alertText()
    xhr.respond = { status: 403, body: { ok: false, reason: 'permission_missing' }, network: false }
    await send()
    out.serverNoDetail = alertText()
    xhr.respond = { status: 0, body: null, network: true }
    await send()
    out.network = alertText()
    xhr.respond = { status: 200, body: { ok: true }, network: false }
    await send()
    out.afterSuccess = { tray: container.querySelector('.mb-2') !== null, value: box.value }
    await pick(file('a.png', 'image/png', 10))
    await act(async () => fireEvent.click(screen.getByLabelText('הסר את הקובץ')))
    out.afterRemove = container.querySelector('.mb-2') !== null
    out.sent = xhr.sent
    out.toasts = S.toasts
    expect(out).toMatchSnapshot()
  })

  test('tray phases (idle size, indeterminate, percent, sending) and their remove labels', async () => {
    const { default: Tray } = await import('@/modules/messenger/components/MessengerAttachmentTray')
    const f = file('report.pdf', 'application/pdf', 3 * 1024 * 1024)
    const out: Record<string, string> = {}
    for (const [k, upload] of [
      ['idle', { phase: 'idle' }],
      ['indeterminate', { phase: 'uploading', progress: null }],
      ['percent', { phase: 'uploading', progress: 42 }],
      ['sending', { phase: 'sending' }],
      ['smallKb', { phase: 'idle' }],
    ] as const) {
      const { container, unmount } = render(<Tray file={k === 'smallKb' ? file('x.txt', 'text/plain', 3000) : f} upload={upload} onRemove={() => {}} />)
      out[k] = container.innerHTML
      unmount()
    }
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — saved replies, earlier messages, closed-window composer', () => {
  test('picker: open, keyboard, Escape returns focus, insert (plain) vs send (structured), send failure', async () => {
    const { container } = await mount({ selectedId: 1, selectedOverrides: OPEN })
    const trigger = screen.getAllByLabelText('תשובות שמורות')[0]
    const out: Record<string, unknown> = {}
    await act(async () => fireEvent.click(trigger))
    const list = screen.getByRole('listbox')
    out.listbox = list.outerHTML
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    out.activeAfterDown = screen.getAllByRole('option').map((o) => o.getAttribute('aria-selected'))
    fireEvent.keyDown(list, { key: 'Escape' })
    out.closed = screen.queryByRole('listbox') === null
    out.focusReturned = document.activeElement === trigger
    await act(async () => fireEvent.click(trigger))
    await act(async () => fireEvent.click(screen.getAllByRole('option')[0]))
    out.inserted = (container.querySelector('#messenger-reply') as HTMLTextAreaElement).value
    await act(async () => fireEvent.click(trigger))
    await act(async () => fireEvent.click(screen.getAllByRole('option')[1]))
    S.sendSaved.mockResolvedValueOnce({ ok: false, reason: 'rate_limited' })
    await act(async () => fireEvent.click(trigger))
    await act(async () => fireEvent.click(screen.getAllByRole('option')[1]))
    out.failure = alertText()
    out.calls = S.sendSaved.mock.calls
    out.toasts = S.toasts
    expect(out).toMatchSnapshot()
  })

  test('load earlier: pending label, failure (result and thrown), success merges', async () => {
    await mount({ selectedId: 1, hasMore: true, selectedOverrides: OPEN })
    const out: Record<string, unknown> = {}
    const pending = deferred()
    S.loadOlder.mockReturnValueOnce(pending.promise)
    await act(async () => fireEvent.click(screen.getByText('טען הודעות קודמות')))
    out.pending = screen.getByText('טוען הודעות קודמות…').outerHTML
    await act(async () => pending.resolve({ ok: false }))
    out.failed = alertText()
    S.loadOlder.mockRejectedValueOnce(new Error('x'))
    await act(async () => fireEvent.click(screen.getByText('טען הודעות קודמות')))
    out.thrown = alertText()
    S.loadOlder.mockResolvedValueOnce({ ok: true, hasMore: false, messages: [{ ...MESSAGES[0], id: 0, text: 'הודעה ישנה', timestamp: new Date(NOW - 50 * HOUR) }] })
    await act(async () => fireEvent.click(screen.getByText('טען הודעות קודמות')))
    out.merged = screen.queryByText('הודעה ישנה') !== null
    out.calls = S.loadOlder.mock.calls
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — Messenger lead actions, history import, search', () => {
  test('create (pending, success, every failure), link (success, failure)', async () => {
    await mount({ selectedId: 2, selectedOverrides: OPEN })
    const out: Record<string, unknown> = {}
    const pending = deferred()
    S.createLead.mockReturnValueOnce(pending.promise)
    await act(async () => fireEvent.click(screen.getByText('צור ליד')))
    out.pending = screen.getByText('יוצר ליד...').closest('button')?.outerHTML
    await act(async () => pending.resolve({ ok: true, leadId: 90 }))
    for (const reason of ['not_enabled', 'not_found', 'quota_exceeded', 'create_failed', 'unmapped']) {
      S.createLead.mockResolvedValueOnce({ ok: false, reason })
      await act(async () => fireEvent.click(screen.getByText('צור ליד')))
    }
    await act(async () => fireEvent.click(screen.getByTestId('lead-picker')))
    S.linkLead.mockResolvedValueOnce({ ok: false, reason: 'not_found' })
    await act(async () => fireEvent.click(screen.getByTestId('lead-picker')))
    out.createCalls = S.createLead.mock.calls
    out.linkCalls = S.linkLead.mock.calls
    out.toasts = S.toasts
    expect(out).toMatchSnapshot()
  })

  test('import history: pending, imported (more / none), every failure reason', async () => {
    await mount({ conversations: [] })
    const out: Record<string, unknown> = {}
    const click = () => act(async () => fireEvent.click(screen.getByText('ייבא שיחות קיימות מהדף')))
    const pending = deferred()
    S.importHistory.mockReturnValueOnce(pending.promise)
    await act(async () => fireEvent.click(screen.getByText('ייבא שיחות קיימות מהדף')))
    out.pending = screen.getByText('מייבא שיחות…').closest('button')?.outerHTML
    await act(async () => pending.resolve({ conversations: 3, messages: 12, hasMore: true }))
    out.more = screen.getByRole('status').textContent
    S.importHistory.mockResolvedValueOnce({ conversations: 0, messages: 0, hasMore: false })
    await click()
    out.none = screen.getByRole('status').textContent
    S.importHistory.mockResolvedValueOnce({ conversations: 1, messages: 2, hasMore: false })
    await click()
    out.one = screen.getByRole('status').textContent
    for (const reason of ['not_enabled', 'forbidden', 'not_found', 'permission_missing', 'invalid', 'rate_limited', 'meta_error', 'unmapped']) {
      S.importHistory.mockResolvedValueOnce({ reason })
      await click()
      out[reason] = alertText()
    }
    out.calls = S.importHistory.mock.calls
    out.refreshes = S.refreshes
    expect(out).toMatchSnapshot()
  })

  test('search: typing updates the URL, Escape and the clear button empty it', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(NOW)
    await mount()
    const input = screen.getByLabelText('חיפוש בשיחות Messenger') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'נועה' } })
    await act(async () => vi.advanceTimersByTime(300))
    const clear = screen.getByLabelText('נקה חיפוש').outerHTML
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.change(input, { target: { value: 'אורי' } })
    await act(async () => fireEvent.click(screen.getByLabelText('נקה חיפוש')))
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    expect({ clear, value: input.value, replaces: S.replaces, placeholder: input.placeholder }).toMatchSnapshot()
  })
})
