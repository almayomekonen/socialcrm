// @vitest-environment jsdom
/**
 * "צור ליד" in a comment row, end to end on the client.
 *
 * The outcome is confirmed by the action's result, says whether a ליד was
 * created or an existing one linked, links to the actual record, is announced,
 * and survives the list refresh the action's revalidation causes. A failure
 * leaves the comment and the button in place. The REAL `useAction` runs here
 * (only the entitlement context is stubbed), so a thrown action and a double
 * click behave as in the browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push }) }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
vi.mock('@/lib/entitlement/EntitlementContext', () => ({ useAccessDenied: () => false }))
vi.mock('@/modules/facebookComments/actions', () => ({ convertCommentToLead: vi.fn() }))
vi.mock('@/modules/facebookComments/replyActions', () => ({ replyToComment: vi.fn(async () => ({ ok: true, replyId: 'r1' })) }))

import CommentsList from '@/modules/facebookComments/components/CommentsList'
import CommentsListMobile from '@/modules/facebookComments/mobile/CommentsListMobile'
import CommentsInboxMobile from '@/modules/facebookComments/mobile/CommentsInboxMobile'
import CommentsEmptyState from '@/modules/facebookComments/components/CommentsEmptyState'
import CommentsStatusFilter, { PAGE_STATUS_FILTERS } from '@/modules/facebookComments/components/CommentsStatusFilter'
import { badgeStatus, hasLeadSlot } from '@/modules/facebookComments/rowState'
import { convertCommentToLead } from '@/modules/facebookComments/actions'
import { toast } from '@/lib/toast'
import type { CommentListItem } from '@/modules/facebookComments/types'

const base: CommentListItem = {
  id: 1,
  pageId: '1175908668934802',
  commentId: '122113311069337165_987654321',
  postId: '1175908668934802_122113311069337165',
  parentId: '1175908668934802_122113311069337165',
  isTopLevel: true,
  authorName: 'דוד כהן',
  message: 'כמה עולה?',
  messageAvailable: true,
  status: 'open',
  convertedLeadId: null,
  createdTime: new Date('2026-08-11T09:20:10.000Z'),
  receivedAt: new Date('2026-08-11T09:20:14.000Z'),
}
const item = (over: Partial<CommentListItem> = {}): CommentListItem => ({ ...base, ...over })
const converted = vi.mocked(convertCommentToLead)

const click = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /צור ליד/ }))
  })
}

beforeEach(() => {
  converted.mockReset()
  vi.mocked(toast).mockClear()
  push.mockClear()
})
afterEach(() => cleanup())

describe('creating a ליד — outcomes', () => {
  it('confirms a new ליד with "פתח ליד" to the real record, and keeps it after the refresh', async () => {
    converted.mockResolvedValueOnce({ ok: true, leadId: 2016, created: true })
    const { rerender } = render(<CommentsList comments={[item()]} />)

    await click()

    expect(converted).toHaveBeenLastCalledWith(base.commentId)
    expect(screen.getByRole('status')).toHaveTextContent('הליד נוצר בהצלחה')
    expect(screen.getByRole('link', { name: 'פתח ליד' })).toHaveAttribute('href', '/clients/2016/summary')

    // The server re-renders the list with the comment converted (revalidatePath).
    rerender(<CommentsList comments={[item({ status: 'converted', convertedLeadId: 2016 })]} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('הליד נוצר בהצלחה')
    expect(screen.getByText('הומר לליד')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'פתח ליד' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /צור ליד/ })).not.toBeInTheDocument()
    expect(toast).not.toHaveBeenCalled() // one signal in the default view
  })

  it('the phone row keeps the confirmation after the refresh too', async () => {
    converted.mockResolvedValueOnce({ ok: true, leadId: 31, created: true })
    const { rerender } = render(<CommentsListMobile comments={[item()]} />)

    await click()
    rerender(<CommentsListMobile comments={[item({ status: 'converted', convertedLeadId: 31 })]} />)

    expect(screen.getByRole('status')).toHaveTextContent('הליד נוצר בהצלחה')
    expect(screen.getByRole('link', { name: 'פתח ליד' })).toHaveAttribute('href', '/clients/31/summary')
  })

  it('the announcement region exists before the click, and focus lands on "פתח ליד"', async () => {
    converted.mockResolvedValueOnce({ ok: true, leadId: 5, created: true })
    render(<CommentsList comments={[item()]} />)
    const region = screen.getByRole('status')
    expect(region).toBeEmptyDOMElement()

    await click()

    expect(screen.getByRole('status')).toBe(region)
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'פתח ליד' }))
  })

  it('says so explicitly when the comment was already linked to an existing ליד', async () => {
    converted.mockResolvedValueOnce({ ok: true, leadId: 55, created: false })
    render(<CommentsList comments={[item()]} />)

    await click()

    expect(screen.getByRole('status')).toHaveTextContent('התגובה כבר מקושרת לליד קיים')
    expect(screen.queryByText('הליד נוצר בהצלחה')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'פתח ליד' })).toHaveAttribute('href', '/clients/55/summary')
  })
})

describe('creating a ליד — failures and retries', () => {
  it('on failure the comment and the button stay, with an actionable message; a retry can succeed', async () => {
    converted.mockResolvedValueOnce({ ok: false, reason: 'quota_exceeded' })
    render(<CommentsList comments={[item()]} />)

    await click()

    expect(screen.getByRole('alert')).toHaveTextContent('הגעת למכסת הלידים')
    expect(screen.getByText('כמה עולה?')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(screen.queryByRole('link', { name: 'פתח ליד' })).not.toBeInTheDocument()

    converted.mockResolvedValueOnce({ ok: true, leadId: 9, created: true })
    await click()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('הליד נוצר בהצלחה')
  })

  it('a thrown action (network, server crash) is an inline error, not a silent un-spin', async () => {
    converted.mockRejectedValueOnce(new Error('fetch failed'))
    render(<CommentsList comments={[item()]} />)

    await click()

    expect(screen.getByRole('alert')).toHaveTextContent('בדוק את החיבור ונסה שוב')
    expect(screen.getByRole('alert').textContent).not.toContain('fetch failed')
    expect(screen.getByRole('button', { name: 'צור ליד' })).toBeEnabled()
  })

  it('names every failure reason in Hebrew; none is blank or raw', async () => {
    for (const reason of ['not_found', 'deleted', 'page_authored', 'not_enabled', 'create_failed', 'db_error'] as const) {
      converted.mockResolvedValueOnce({ ok: false, reason })
      const { unmount } = render(<CommentsList comments={[item()]} />)
      await click()
      expect(screen.getByRole('alert').textContent?.trim().length).toBeGreaterThan(10)
      expect(screen.getByRole('alert').textContent).not.toMatch(/[a-z_]{6,}/)
      unmount()
    }
  })

  it('a double click while the first request is in flight sends ONE request', async () => {
    let resolve: (v: { ok: true; leadId: number; created: boolean }) => void = () => {}
    converted.mockImplementationOnce(() => new Promise((r) => (resolve = r)))
    render(<CommentsList comments={[item()]} />)

    const button = screen.getByRole('button', { name: /צור ליד/ })
    await act(async () => {
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)
    })
    expect(converted).toHaveBeenCalledTimes(1)

    await act(async () => resolve({ ok: true, leadId: 3, created: true }))
    expect(screen.getByRole('status')).toHaveTextContent('הליד נוצר בהצלחה')
  })
})

describe('creating a ליד — under "פתוחות", where the row leaves the list', () => {
  it('a toast confirms and opens the ליד', async () => {
    converted.mockResolvedValueOnce({ ok: true, leadId: 2016, created: true })
    const { rerender } = render(<CommentsList comments={[item()]} leavesViewOnConvert />)

    await click()
    rerender(<CommentsList comments={[]} leavesViewOnConvert />)

    expect(toast).toHaveBeenCalledTimes(1)
    const [icon, message, , onClick] = vi.mocked(toast).mock.calls[0]
    expect(icon).toBe('success')
    expect(message).toBe('הליד נוצר בהצלחה · פתח ליד')
    onClick?.()
    expect(push).toHaveBeenCalledWith('/clients/2016/summary')
  })

  it('never toasts a failure as success', async () => {
    converted.mockResolvedValueOnce({ ok: false, reason: 'create_failed' })
    render(<CommentsList comments={[item()]} leavesViewOnConvert />)

    await click()

    expect(screen.getByRole('alert')).toHaveTextContent('הליד לא נוצר')
    expect(toast).not.toHaveBeenCalled()
  })
})

describe('which rows get the ליד slot', () => {
  it('a comment marked converted WITHOUT a ליד (an old failed click) can be converted again, with no false badge', () => {
    render(<CommentsList comments={[item({ status: 'converted', convertedLeadId: null })]} />)
    expect(screen.getByRole('button', { name: 'צור ליד' })).toBeInTheDocument()
    expect(screen.queryByText('הומר לליד')).not.toBeInTheDocument()
  })

  it('a converted comment later deleted on Facebook keeps its link; deleted or ignored without one get nothing', () => {
    render(
      <CommentsList
        comments={[
          item({ commentId: 'A', status: 'deleted', convertedLeadId: 42 }),
          item({ commentId: 'B', status: 'deleted' }),
          item({ commentId: 'C', status: 'ignored' }),
        ]}
      />,
    )
    expect(screen.getAllByRole('link', { name: 'פתח ליד' })).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'פתח ליד' })).toHaveAttribute('href', '/clients/42/summary')
    expect(screen.queryByRole('button', { name: /צור ליד/ })).not.toBeInTheDocument()
  })

  it('rules in one place', () => {
    expect(hasLeadSlot({ status: 'open', convertedLeadId: null })).toBe(true)
    expect(hasLeadSlot({ status: 'converted', convertedLeadId: null })).toBe(true)
    expect(hasLeadSlot({ status: 'deleted', convertedLeadId: 7 })).toBe(true)
    expect(hasLeadSlot({ status: 'deleted', convertedLeadId: null })).toBe(false)
    expect(hasLeadSlot({ status: 'ignored', convertedLeadId: null })).toBe(false)
    expect(badgeStatus({ status: 'converted', convertedLeadId: null })).toBeNull()
    expect(badgeStatus({ status: 'converted', convertedLeadId: 7 })).toBe('converted')
  })
})

describe('status filter and filtered-empty', () => {
  it('"הכל" first and current by default; each option is a URL, so Back and refresh keep it', () => {
    render(<CommentsStatusFilter active='all' />)
    const links = screen.getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual(['הכל', 'פתוחות', 'הומרו לליד'])
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/inbox/comments',
      '/inbox/comments?status=open',
      '/inbox/comments?status=converted',
    ])
    expect(links[0]).toHaveAttribute('aria-current', 'page')
    expect(links[2]).not.toHaveAttribute('aria-current')
  })

  it('the page accepts exactly the offered filters', () => {
    expect([...PAGE_STATUS_FILTERS]).toEqual(['all', 'open', 'converted'])
  })

  it('the phone inbox shows the filter the route passes in, with the filtered-empty copy', () => {
    render(
      <CommentsInboxMobile
        emptyKind='no-converted'
        comments={[]}
        awaitingText={false}
        statusFilter={<CommentsStatusFilter active='converted' />}
      />,
    )
    expect(screen.getByRole('link', { name: 'הומרו לליד' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('עדיין לא נוצרו לידים מתגובות')).toBeInTheDocument()
  })

  it('filtered-empty says what the filter hides, not that there are no comments', () => {
    const { unmount } = render(<CommentsEmptyState kind='no-open' />)
    expect(screen.getByText('אין תגובות פתוחות')).toBeInTheDocument()
    expect(screen.queryByText(/אין עדיין תגובות/)).not.toBeInTheDocument()
    unmount()
    render(<CommentsEmptyState kind='no-converted' />)
    expect(screen.getByText('עדיין לא נוצרו לידים מתגובות')).toBeInTheDocument()
  })
})
