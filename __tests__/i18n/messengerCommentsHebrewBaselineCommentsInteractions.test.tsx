// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { COMMENTS, NOW, resetMessengerCommentsEnv } from './messengerCommentsEnv'
import { commentsScreen } from './messengerCommentsHarness'
import { mcSpies as S, resetMcSpies } from './messengerCommentsMocks'

/**
 * HEBREW BASELINE — `/inbox/comments` INTERACTIONS on the REAL page: the reply
 * form (open, empty, pending, success with the new reply in the thread, every
 * failure reason, thrown, cancel), convert-to-lead (pending, created / existing,
 * the toast when the row leaves the filter, every failure, thrown), the long
 * comment toggle and "load more" (pending, failure, appended). Recorded BEFORE
 * the Phase D Messenger/Comments package: Hebrew text, toasts and action
 * arguments must stay identical.
 */

vi.mock('next/navigation', async () => (await import('./messengerCommentsMocks')).navigationModule())
vi.mock('next/server', async () => (await import('./messengerCommentsMocks')).nextServerModule())
vi.mock('next/cache', async () => (await import('./inboxMocks')).cacheModule())
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./messengerCommentsEnv')).messengerEnv.user }))
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: null, agencyLocale: null }) }))
vi.mock('@/config/db', async () => (await import('./messengerCommentsMocks')).dbModule())
vi.mock('@/lib/device', async () => (await import('./messengerCommentsMocks')).deviceModule())
vi.mock('@/lib/facebook/permissions', async () => (await import('./messengerCommentsMocks')).permissionsModule())
vi.mock('@/lib/facebook/comments/capability', async () => (await import('./messengerCommentsMocks')).capabilityModule())
vi.mock('@/modules/messenger/queries', async () => (await import('./messengerCommentsMocks')).messengerQueriesModule())
vi.mock('@/modules/facebookComments/queries', async () => (await import('./messengerCommentsMocks')).commentsQueriesModule())
vi.mock('@/modules/facebookComments/feed', async () => (await import('./messengerCommentsMocks')).feedModule())
vi.mock('@/lib/facebook/comments/enrich', async () => (await import('./messengerCommentsMocks')).enrichModule())
vi.mock('@/modules/facebookComments/actions', async () => (await import('./messengerCommentsMocks')).commentsActionsModule())
vi.mock('@/modules/facebookComments/replyActions', async () => (await import('./messengerCommentsMocks')).replyActionsModule())
vi.mock('@/modules/facebookComments/listActions', async () => (await import('./messengerCommentsMocks')).listActionsModule())
vi.mock('@/lib/toast', async () => (await import('./messengerCommentsMocks')).toastModule())

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mount = async (o: Parameters<typeof commentsScreen>[1] = {}, sp: Record<string, string> = {}) =>
  render(await commentsScreen(null, o, sp))
const card = (commentId: string) => document.querySelector(`[data-comment-id="${commentId}"]`) as HTMLElement
const deferred = () => {
  let resolve!: (v: Record<string, unknown>) => void
  const promise = new Promise<Record<string, unknown>>((r) => (resolve = r))
  return { promise, resolve }
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetMessengerCommentsEnv()
  resetMcSpies()
})

describe('Hebrew baseline — comment reply form', () => {
  test('open, empty, pending, success (shown in the thread), every failure, thrown, cancel', async () => {
    await mount()
    const c = within(card('9001'))
    const out: Record<string, unknown> = {}
    await act(async () => fireEvent.click(c.getByText('ענה לתגובה')))
    const box = card('9001').querySelector('textarea') as HTMLTextAreaElement
    out.form = box.closest('.grid')?.outerHTML
    fireEvent.change(box, { target: { value: 'תודה רבה!' } })
    const pending = deferred()
    S.reply.mockReturnValueOnce(pending.promise)
    await act(async () => fireEvent.click(c.getByText('פרסם תשובה')))
    out.pending = c.getByText('מפרסם...').closest('button')?.outerHTML
    await act(async () => pending.resolve({ ok: true, replyId: '9199' }))
    out.thread = card('9001').querySelector('ul')?.outerHTML
    out.formClosed = card('9001').querySelector('textarea') === null
    for (const reason of ['not_enabled', 'not_found', 'deleted', 'page_authored', 'empty', 'too_long', 'permission_missing',
      'reconnect_required', 'comment_unavailable', 'rate_limited', 'blocked', 'meta_error', 'unmapped']) {
      if (!card('9001').querySelector('textarea')) await act(async () => fireEvent.click(c.getByText('ענה לתגובה')))
      fireEvent.change(card('9001').querySelector('textarea')!, { target: { value: 'נסיון' } })
      S.reply.mockResolvedValueOnce({ ok: false, reason })
      await act(async () => fireEvent.click(c.getByText('פרסם תשובה')))
      out[reason] = c.getByRole('alert').textContent
    }
    S.reply.mockRejectedValueOnce(new Error('x'))
    await act(async () => fireEvent.click(c.getByText('פרסם תשובה')))
    out.thrown = c.getByRole('alert').textContent
    out.valueKept = (card('9001').querySelector('textarea') as HTMLTextAreaElement).value
    await act(async () => fireEvent.click(c.getByText('ביטול')))
    out.cancelled = card('9001').querySelector('textarea') === null
    out.calls = S.reply.mock.calls
    out.toasts = S.toasts
    out.refreshes = S.refreshes
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — convert comment to lead', () => {
  test('pending, created, existing, every failure, thrown; toast when the row leaves the "open" filter', async () => {
    const out: Record<string, unknown> = {}
    await mount()
    const one = () => within(card('9001'))
    const pending = deferred()
    S.convert.mockReturnValueOnce(pending.promise)
    await act(async () => fireEvent.click(one().getByText('המר לליד')))
    out.pending = one().getByText('ממיר לליד...').closest('button')?.outerHTML
    await act(async () => pending.resolve({ ok: true, leadId: 70, created: true }))
    out.created = card('9001').querySelector('[role="status"]')?.outerHTML
    const nine = () => within(card('9009'))
    S.convert.mockResolvedValueOnce({ ok: true, leadId: 71, created: false })
    await act(async () => fireEvent.click(nine().getByText('המר לליד')))
    out.existing = card('9009').querySelector('[role="status"]')?.textContent
    const six = () => within(card('9006'))
    for (const reason of ['not_found', 'deleted', 'page_authored', 'not_enabled', 'quota_exceeded', 'create_failed', 'db_error', 'unmapped']) {
      S.convert.mockResolvedValueOnce({ ok: false, reason })
      await act(async () => fireEvent.click(six().getByText('המר לליד')))
      out[reason] = six().getByRole('alert').textContent
    }
    S.convert.mockResolvedValueOnce({ ok: false })
    await act(async () => fireEvent.click(six().getByText('המר לליד')))
    out.noReason = six().getByRole('alert').textContent
    S.convert.mockRejectedValueOnce(new Error('x'))
    await act(async () => fireEvent.click(six().getByText('המר לליד')))
    out.thrown = six().getByRole('alert').textContent
    cleanup()
    await mount({}, { status: 'open' })
    S.convert.mockResolvedValueOnce({ ok: true, leadId: 72, created: true })
    await act(async () => fireEvent.click(within(card('9001')).getByText('המר לליד')))
    out.calls = S.convert.mock.calls
    out.toasts = S.toasts.map((t) => t.slice(0, 3))
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — long comment, load more', () => {
  test('show more / less; load more pending, failure, thrown, appended', async () => {
    const out: Record<string, unknown> = {}
    await mount({ nextCursor: { receivedAt: '2026-10-27T00:00:00.000Z', id: 1 } })
    const long = within(card('9008'))
    await act(async () => fireEvent.click(long.getByText('הצג עוד')))
    out.expanded = long.getByText('הצג פחות').outerHTML
    const pending = deferred()
    S.loadMore.mockReturnValueOnce(pending.promise)
    await act(async () => fireEvent.click(screen.getByText('טען עוד תגובות')))
    out.pending = screen.getByText('טוען תגובות...').closest('button')?.outerHTML
    await act(async () => pending.resolve({ ok: false }))
    out.failed = screen.getAllByRole('alert').at(-1)?.textContent
    S.loadMore.mockRejectedValueOnce(new Error('x'))
    await act(async () => fireEvent.click(screen.getByText('טען עוד תגובות')))
    out.thrown = screen.getAllByRole('alert').at(-1)?.textContent
    S.loadMore.mockResolvedValueOnce({
      items: [{ ...COMMENTS[0], id: 99, commentId: '9099', message: 'תגובה ישנה' }],
      replies: [],
      posts: [],
      nextCursor: null,
    })
    await act(async () => fireEvent.click(screen.getByText('טען עוד תגובות')))
    out.appended = screen.queryByText('תגובה ישנה') !== null
    out.buttonGone = screen.queryByText('טען עוד תגובות') === null
    out.calls = S.loadMore.mock.calls
    expect(out).toMatchSnapshot()
  })
})
