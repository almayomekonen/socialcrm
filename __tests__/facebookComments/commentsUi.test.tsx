// @vitest-environment jsdom
/**
 * Comments Inbox UI — presentation states.
 *
 * The state under the most scrutiny is `messageAvailable: false`. It is the
 * NORMAL state until Meta approves `pages_read_user_content`, so the UI must
 * read as deliberate rather than broken: no blank bubble, no "undefined", and
 * an explicit explanation of why the text is missing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push }) }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
vi.mock('@/lib/useAction', () => ({
  useAction: () => ({ loading: false, error: null, setError: vi.fn(), run: (fn: () => unknown) => fn() }),
}))
vi.mock('@/modules/facebookComments/actions', () => ({ convertCommentToLead: vi.fn(async () => ({ ok: true, leadId: 7, created: true })) }))
vi.mock('@/modules/facebookComments/replyActions', () => ({ replyToComment: vi.fn(async () => ({ ok: true, replyId: 'r1' })) }))

import CommentsList from '@/modules/facebookComments/components/CommentsList'
import CommentsEmptyState from '@/modules/facebookComments/components/CommentsEmptyState'
import CommentsStatusFilter from '@/modules/facebookComments/components/CommentsStatusFilter'
import { convertCommentToLead } from '@/modules/facebookComments/actions'
import { toast } from '@/lib/toast'
import InboxChannelSwitch from '@/modules/inbox/components/InboxChannelSwitch'
import CommentsInboxMobile from '@/modules/facebookComments/mobile/CommentsInboxMobile'
import CommentsListMobile from '@/modules/facebookComments/mobile/CommentsListMobile'
import type { CommentListItem, CommentReply } from '@/modules/facebookComments/types'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

afterEach(() => cleanup())

const base: CommentListItem = {
  id: 1,
  pageId: '1175908668934802',
  commentId: '122113311069337165_987654321',
  postId: '1175908668934802_122113311069337165',
  parentId: '1175908668934802_122113311069337165',
  isTopLevel: true,
  authorName: 'דוד כהן',
  message: '',
  messageAvailable: false,
  status: 'open',
  convertedLeadId: null,
  createdTime: new Date('2026-08-11T09:20:10.000Z'),
  receivedAt: new Date('2026-08-11T09:20:14.000Z'),
}

const item = (over: Partial<CommentListItem> = {}): CommentListItem => ({ ...base, ...over })

describe('CommentsList — message availability', () => {
  it('shows an intentional explanation when Meta withheld the text', () => {
    render(<CommentsList comments={[item()]} />)

    expect(screen.getByText(/תוכן התגובה עדיין לא זמין/)).toBeInTheDocument()
    // Never a blank or broken-looking bubble.
    expect(screen.queryByText('undefined')).not.toBeInTheDocument()
    expect(screen.queryByText('null')).not.toBeInTheDocument()
  })

  it('shows the real text once Meta sends it', () => {
    render(<CommentsList comments={[item({ message: 'כמה עולה?', messageAvailable: true })]} />)

    expect(screen.getByText('כמה עולה?')).toBeInTheDocument()
    expect(screen.queryByText(/עדיין לא זמין/)).not.toBeInTheDocument()
  })

  it('treats an empty message with messageAvailable=true as genuinely empty, not unavailable', () => {
    render(<CommentsList comments={[item({ message: '', messageAvailable: true })]} />)

    expect(screen.queryByText(/עדיין לא זמין/)).not.toBeInTheDocument()
  })
})

describe('CommentsList — comment metadata', () => {
  it('shows the author name', () => {
    render(<CommentsList comments={[item()]} />)
    expect(screen.getByText('דוד כהן')).toBeInTheDocument()
  })

  it('falls back to a neutral label when the author name is missing', () => {
    render(<CommentsList comments={[item({ authorName: null })]} />)
    expect(screen.getByText('מגיב מפייסבוק')).toBeInTheDocument()
  })

  it('renders a machine-readable timestamp', () => {
    render(<CommentsList comments={[item()]} />)
    const time = document.querySelector('time')
    expect(time).toBeTruthy()
    expect(time?.getAttribute('dateTime')).toBe('2026-08-11T09:20:10.000Z')
  })

  it('falls back to receivedAt when Meta sent no created_time', () => {
    render(<CommentsList comments={[item({ createdTime: null })]} />)
    expect(document.querySelector('time')?.getAttribute('dateTime')).toBe('2026-08-11T09:20:14.000Z')
  })

  it('marks a reply distinctly from a top-level comment', () => {
    const { unmount } = render(<CommentsList comments={[item({ isTopLevel: false })]} />)
    expect(screen.getByText('תגובה לתגובה')).toBeInTheDocument()
    unmount()

    render(<CommentsList comments={[item({ isTopLevel: true })]} />)
    expect(screen.queryByText('תגובה לתגובה')).not.toBeInTheDocument()
  })

  it('identifies Facebook as the source with an accessible name, not an icon alone', () => {
    render(<CommentsList comments={[item()]} />)
    expect(screen.getByText('פייסבוק')).toBeInTheDocument()
  })

  it('exposes the Meta identifiers without dumping them into the reading flow', () => {
    render(<CommentsList comments={[item()]} />)
    const row = screen.getByRole('listitem')
    expect(row).toHaveAttribute('data-comment-id', base.commentId)
    expect(row).toHaveAttribute('data-post-id', base.postId)
  })

  it('invents no contact information — a comment has no phone or email', () => {
    render(<CommentsList comments={[item({ message: 'מעוניין', messageAvailable: true })]} />)
    const html = document.body.innerHTML
    expect(html).not.toMatch(/tel:|mailto:/)
  })
})

describe('CommentsList — status states', () => {
  it('marks a converted comment so it is not worked twice', () => {
    render(<CommentsList comments={[item({ status: 'converted', convertedLeadId: 42 })]} />)
    expect(screen.getByText('הומר לליד')).toBeInTheDocument()
    expect(screen.getByText('הומר לליד').className).toContain('rounded-full')
  })

  it('marks an ignored comment', () => {
    render(<CommentsList comments={[item({ status: 'ignored' })]} />)
    expect(screen.getByText('התעלמת')).toBeInTheDocument()
  })

  it('marks a deleted comment as removed on Facebook', () => {
    render(<CommentsList comments={[item({ status: 'deleted' })]} />)
    expect(screen.getByText('נמחקה בפייסבוק')).toBeInTheDocument()
  })

  it('shows no status badge for a plain open comment', () => {
    render(<CommentsList comments={[item({ status: 'open' })]} />)
    expect(screen.queryByText('הומר לליד')).not.toBeInTheDocument()
    expect(screen.queryByText('התעלמת')).not.toBeInTheDocument()
    expect(screen.queryByText('נמחקה בפייסבוק')).not.toBeInTheDocument()
  })

  it('offers "צור ליד" on a live, unconverted comment', () => {
    render(<CommentsList comments={[item({ status: 'open', convertedLeadId: null })]} />)
    expect(screen.getByRole('button', { name: /צור ליד/ })).toBeInTheDocument()
  })

  it('hides "צור ליד" once the comment is converted', () => {
    render(<CommentsList comments={[item({ status: 'converted', convertedLeadId: 42 })]} />)
    expect(screen.queryByRole('button', { name: /צור ליד/ })).not.toBeInTheDocument()
  })

  it('hides "צור ליד" for a comment deleted on Facebook', () => {
    render(<CommentsList comments={[item({ status: 'deleted' })]} />)
    expect(screen.queryByRole('button', { name: /צור ליד/ })).not.toBeInTheDocument()
  })

  it('links to the created ליד after conversion, using the standard lead route', () => {
    render(<CommentsList comments={[item({ status: 'converted', convertedLeadId: 42 })]} />)
    const link = screen.getByRole('link', { name: 'פתח ליד' })
    expect(link).toHaveAttribute('href', '/clients/42/summary')
  })

  it('shows no lead link when nothing was converted', () => {
    render(<CommentsList comments={[item({ status: 'open', convertedLeadId: null })]} />)
    expect(screen.queryByRole('link', { name: 'פתח ליד' })).not.toBeInTheDocument()
  })

  it('keeps the ליד link on a converted comment that was later deleted on Facebook', () => {
    render(<CommentsList comments={[item({ status: 'deleted', convertedLeadId: 42 })]} />)
    expect(screen.getByRole('link', { name: 'פתח ליד' })).toHaveAttribute('href', '/clients/42/summary')
    expect(screen.queryByRole('button', { name: /צור ליד/ })).not.toBeInTheDocument()
  })

  it('renders every comment in the list, newest-first order preserved from the query', () => {
    render(
      <CommentsList
        comments={[item({ id: 1, commentId: 'C1' }), item({ id: 2, commentId: 'C2' }), item({ id: 3, commentId: 'C3' })]}
      />,
    )
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.getAttribute('data-comment-id'))).toEqual(['C1', 'C2', 'C3'])
  })
})

/**
 * "צור ליד" end to end in the row: the outcome is confirmed by the action's
 * result, says whether a ליד was created or an existing one linked, links to the
 * actual record, and survives the list refresh the action's revalidation causes.
 * A failure leaves the comment and the button in place.
 */
describe('CommentsList — creating a ליד from a comment', () => {
  const click = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /צור ליד/ }))
    })
  }

  it('confirms a new ליד with "פתח ליד" to the real record, and keeps it after the refresh', async () => {
    vi.mocked(convertCommentToLead).mockResolvedValueOnce({ ok: true, leadId: 2016, created: true })
    const { rerender } = render(<CommentsList comments={[item()]} />)

    await click()

    expect(convertCommentToLead).toHaveBeenLastCalledWith(base.commentId)
    expect(screen.getByRole('status')).toHaveTextContent('הליד נוצר בהצלחה')
    expect(screen.getByRole('link', { name: 'פתח ליד' })).toHaveAttribute('href', '/clients/2016/summary')

    // The server re-renders the list with the comment converted (revalidatePath).
    rerender(<CommentsList comments={[item({ status: 'converted', convertedLeadId: 2016 })]} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('הליד נוצר בהצלחה')
    expect(screen.getByText('הומר לליד')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'פתח ליד' })).toHaveAttribute('href', '/clients/2016/summary')
    expect(screen.queryByRole('button', { name: /צור ליד/ })).not.toBeInTheDocument()
  })

  it('in the default view confirms inline only — no second signal', async () => {
    vi.mocked(toast).mockClear()
    vi.mocked(convertCommentToLead).mockResolvedValueOnce({ ok: true, leadId: 2016, created: true })
    render(<CommentsList comments={[item()]} />)

    await click()

    expect(screen.getByRole('status')).toHaveTextContent('הליד נוצר בהצלחה')
    expect(toast).not.toHaveBeenCalled()
  })

  it('under "פתוחות", where the row leaves the list on refresh, a toast confirms and opens the ליד', async () => {
    vi.mocked(toast).mockClear()
    push.mockClear()
    vi.mocked(convertCommentToLead).mockResolvedValueOnce({ ok: true, leadId: 2016, created: true })
    const { rerender } = render(<CommentsList comments={[item()]} leavesViewOnConvert />)

    await click()
    // The refreshed "open" list no longer contains the comment.
    rerender(<CommentsList comments={[]} leavesViewOnConvert />)

    expect(toast).toHaveBeenCalledTimes(1)
    const [icon, message, , onClick] = vi.mocked(toast).mock.calls[0]
    expect(icon).toBe('success')
    expect(message).toContain('הליד נוצר בהצלחה')
    expect(message).toContain('פתח ליד')
    onClick?.()
    expect(push).toHaveBeenCalledWith('/clients/2016/summary')
  })

  it('never toasts a failure as success under "פתוחות"', async () => {
    vi.mocked(toast).mockClear()
    vi.mocked(convertCommentToLead).mockResolvedValueOnce({ ok: false, reason: 'create_failed' })
    render(<CommentsList comments={[item()]} leavesViewOnConvert />)

    await click()

    expect(screen.getByRole('alert')).toHaveTextContent('הליד לא נוצר')
    expect(toast).not.toHaveBeenCalled()
  })

  it('says so explicitly when the comment was already linked to an existing ליד', async () => {
    vi.mocked(convertCommentToLead).mockResolvedValueOnce({ ok: true, leadId: 55, created: false })
    render(<CommentsList comments={[item()]} />)

    await click()

    expect(screen.getByRole('status')).toHaveTextContent('התגובה כבר מקושרת לליד קיים')
    expect(screen.queryByText('הליד נוצר בהצלחה')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'פתח ליד' })).toHaveAttribute('href', '/clients/55/summary')
  })

  it('on failure the comment and the button stay, with an actionable message; a retry can succeed', async () => {
    vi.mocked(convertCommentToLead).mockResolvedValueOnce({ ok: false, reason: 'quota_exceeded' })
    render(<CommentsList comments={[item({ messageAvailable: true, message: 'כמה עולה?' })]} />)

    await click()

    expect(screen.getByRole('alert')).toHaveTextContent('הגעת למכסת הלידים')
    expect(screen.getByText('כמה עולה?')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'פתח ליד' })).not.toBeInTheDocument()

    vi.mocked(convertCommentToLead).mockResolvedValueOnce({ ok: true, leadId: 9, created: true })
    await click()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('הליד נוצר בהצלחה')
  })

  it('names every failure reason; none falls back to a blank or raw message', async () => {
    for (const reason of ['not_found', 'deleted', 'page_authored', 'not_enabled', 'create_failed', 'db_error'] as const) {
      vi.mocked(convertCommentToLead).mockResolvedValueOnce({ ok: false, reason })
      const { unmount } = render(<CommentsList comments={[item()]} />)
      await click()
      expect(screen.getByRole('alert').textContent?.trim().length).toBeGreaterThan(10)
      expect(screen.getByRole('alert').textContent).not.toMatch(/[a-z_]{6,}/)
      unmount()
    }
  })

  it('a double click while the first request is in flight sends ONE request', async () => {
    let resolve: (v: { ok: true; leadId: number; created: boolean }) => void = () => {}
    vi.mocked(convertCommentToLead).mockClear()
    vi.mocked(convertCommentToLead).mockImplementationOnce(() => new Promise((r) => (resolve = r)))
    render(<CommentsList comments={[item()]} />)

    const button = screen.getByRole('button', { name: /צור ליד/ })
    await act(async () => {
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)
    })
    expect(convertCommentToLead).toHaveBeenCalledTimes(1)

    await act(async () => resolve({ ok: true, leadId: 3, created: true }))
    expect(screen.getByRole('status')).toHaveTextContent('הליד נוצר בהצלחה')
  })
})

describe('CommentsList — reply thread and in-app replies', () => {
  const reply = (over: Partial<CommentReply> = {}): CommentReply => ({
    id: 9,
    pageId: base.pageId,
    commentId: '122113311069337165_555',
    parentId: base.commentId,
    authorName: 'העסק של דנה',
    authorIsPage: true,
    sentByUserId: 7,
    message: 'שלחנו לך הודעה פרטית',
    messageAvailable: true,
    status: 'open',
    createdTime: new Date('2026-08-11T10:00:00.000Z'),
    receivedAt: new Date('2026-08-11T10:00:01.000Z'),
    ...over,
  })

  it("shows the thread under the comment and labels the Page's reply sent from SocialCRM", () => {
    render(<CommentsList comments={[item()]} replies={[reply()]} />)
    const thread = screen.getByRole('list', { name: 'תגובות בשרשור' })
    expect(thread).toHaveTextContent('שלחנו לך הודעה פרטית')
    expect(thread).toHaveTextContent('(הדף שלך)')
    expect(thread).toHaveTextContent('נשלח מ-SocialCRM')
  })

  it("a Page reply written on Facebook is the Page's, but not labelled as sent from SocialCRM", () => {
    render(<CommentsList comments={[item()]} replies={[reply({ sentByUserId: null })]} />)
    expect(screen.getByRole('list', { name: 'תגובות בשרשור' })).not.toHaveTextContent('נשלח מ-SocialCRM')
  })

  it('does not attach a reply from another Page with the same comment id to this thread', () => {
    render(<CommentsList comments={[item()]} replies={[reply({ pageId: 'OTHER_PAGE' })]} />)
    expect(screen.queryByRole('list', { name: 'תגובות בשרשור' })).not.toBeInTheDocument()
  })

  it('offers the reply form only on Pages whose grant allows replies', () => {
    const { rerender } = render(<CommentsList comments={[item()]} />)
    expect(screen.queryByRole('button', { name: 'פרסם תשובה' })).not.toBeInTheDocument()

    rerender(<CommentsList comments={[item()]} replyablePageIds={[base.pageId]} />)
    expect(screen.getByRole('button', { name: 'פרסם תשובה' })).toBeDisabled()
    expect(screen.getByPlaceholderText('כתוב תשובה בשם הדף...')).toBeInTheDocument()
  })

  it('never offers a reply on a comment deleted on Facebook', () => {
    render(<CommentsList comments={[item({ status: 'deleted' })]} replyablePageIds={[base.pageId]} />)
    expect(screen.queryByRole('button', { name: 'פרסם תשובה' })).not.toBeInTheDocument()
  })

  it('links to the post on Facebook, opened at this comment, in a new tab', () => {
    render(<CommentsList comments={[item()]} />)
    const link = screen.getByRole('link', { name: 'פתח את הפוסט בפייסבוק' })
    expect(link).toHaveAttribute('href', 'https://www.facebook.com/1175908668934802_122113311069337165?comment_id=987654321')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})

describe('InboxChannelSwitch', () => {
  it('links שיחות and תגובות inside the existing inbox section', () => {
    render(<InboxChannelSwitch active='facebook' />)
    expect(screen.getByRole('link', { name: /שיחות/ })).toHaveAttribute('href', '/inbox')
    expect(screen.getByRole('link', { name: /תגובות/ })).toHaveAttribute('href', '/inbox/comments')
    expect(screen.getByRole('link', { name: /תגובות/ })).toHaveAttribute('aria-current', 'page')
  })
})

describe('CommentsInboxMobile', () => {
  it('reuses the existing switch and empty state — no second comments API', () => {
    render(<CommentsInboxMobile emptyKind='not-enabled' comments={[]} awaitingText={false} />)
    expect(screen.getByTestId('facebook-comments-mobile')).toBeTruthy()
    expect(screen.getByRole('link', { name: /תגובות/ })).toHaveAttribute('href', '/inbox/comments')
    expect(screen.getByText(/תגובות בפייסבוק/)).toBeInTheDocument()
  })

  it('does not nest interactive controls', () => {
    const { container } = render(
      <CommentsInboxMobile
        emptyKind={null}
        awaitingText={false}
        comments={[
          item({ commentId: 'TOP', messageAvailable: true, message: 'שאלה' }),
          item({ commentId: 'CONV', convertedLeadId: 55, status: 'converted', messageAvailable: true, message: 'הומר' }),
        ]}
      />,
    )
    const nested = [...container.querySelectorAll('a, button')].filter((el) => {
      const outer = el.parentElement?.closest('a, button')
      return outer != null && outer !== el
    })
    expect(nested).toHaveLength(0)
  })

  it('phone comment rows are rectangular CRM records, not capsules', () => {
    const { container } = render(
      <CommentsListMobile
        comments={[
          item({ commentId: 'TOP', messageAvailable: true, message: 'שאלה על המחיר' }),
          item({ commentId: 'REPLY', isTopLevel: false, status: 'converted', convertedLeadId: 55, messageAvailable: true, message: 'גם אני' }),
        ]}
      />,
    )
    const capsules = [...container.querySelectorAll('[class*="rounded-full"]')].filter(
      (el) => !/\bsize-1\b/.test(el.className),
    )
    expect(capsules).toHaveLength(0)
    expect(container.querySelector('.rounded-md')).toBeTruthy()
    expect(screen.getByText('שאלה על המחיר')).toBeInTheDocument()
    expect(screen.getByText('הומר לליד')).toBeInTheDocument()
  })

  it('renders the same comment records desktop lists, including replies', () => {
    render(
      <CommentsInboxMobile
        emptyKind={null}
        awaitingText={false}
        comments={[
          item({ commentId: 'TOP', isTopLevel: true, messageAvailable: true, message: 'שאלה על המחיר' }),
          item({
            commentId: 'REPLY',
            isTopLevel: false,
            authorName: 'מיכל',
            messageAvailable: true,
            message: 'גם אני',
          }),
        ]}
      />,
    )
    expect(screen.getByText('שאלה על המחיר')).toBeInTheDocument()
    expect(screen.getByText('גם אני')).toBeInTheDocument()
    expect(screen.getByText('תגובה לתגובה')).toBeInTheDocument()
    expect(screen.getAllByText('פייסבוק').length).toBeGreaterThan(0)
  })
})

describe('desktop protection — comments page still mounts the desktop grid', () => {
  it('mobile is a branch, not a replacement of the desktop comments page', () => {
    const src = readFileSync(join(process.cwd(), 'app/(app)/inbox/comments/page.tsx'), 'utf8')
    expect(src).toContain('isMobileWorkspaceRequest')
    expect(src).toContain('CommentsInboxMobile')
    expect(src).toContain('listPageComments')
    expect(src).toContain("className='grid gap-3 p-3 sm:p-4'")
    expect(src).toContain('CommentsList')
  })

  it('defaults to every live comment and offers the status filter, so a converted comment stays reachable', () => {
    const src = readFileSync(join(process.cwd(), 'app/(app)/inbox/comments/page.tsx'), 'utf8')
    expect(src).toContain('CommentsStatusFilter')
    expect(src).toMatch(/\? \(sp\.status as CommentStatusFilter\)\s*: 'all'/)
  })

  it('mobile inbox list exposes the existing channel switch', () => {
    const src = readFileSync(join(process.cwd(), 'modules/inbox/mobile/MobileInboxRoute.tsx'), 'utf8')
    expect(src).toContain('InboxChannelSwitch')
    expect(src).toContain("active='whatsapp'")
    expect(src).not.toContain('window.location.reload')
  })
})

describe('CommentsStatusFilter', () => {
  it('"הכל" first and current by default; each option is a URL, so Back and refresh keep it', () => {
    render(<CommentsStatusFilter active='all' />)
    const links = screen.getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual(['הכל', 'פתוחות', 'הומרו לליד'])
    expect(links[0]).toHaveAttribute('href', '/inbox/comments')
    expect(links[0]).toHaveAttribute('aria-current', 'page')
    expect(links[1]).toHaveAttribute('href', '/inbox/comments?status=open')
    expect(links[2]).toHaveAttribute('href', '/inbox/comments?status=converted')
    expect(links[2]).not.toHaveAttribute('aria-current')
  })

  it('marks the converted view as current', () => {
    render(<CommentsStatusFilter active='converted' />)
    expect(screen.getByRole('link', { name: 'הומרו לליד' })).toHaveAttribute('aria-current', 'page')
  })

  it('the phone inbox shows the filter the route passes in', () => {
    render(<CommentsInboxMobile emptyKind='no-converted' comments={[]} awaitingText={false} statusFilter={<CommentsStatusFilter active='converted' />} />)
    expect(screen.getByRole('navigation', { name: 'סינון תגובות' })).toBeInTheDocument()
    expect(screen.getByText('עדיין לא נוצרו לידים מתגובות')).toBeInTheDocument()
  })
})

describe('CommentsEmptyState', () => {
  it('explains the dark-launch preview when comments ingest is not enabled', () => {
    render(<CommentsEmptyState kind='not-enabled' />)
    expect(screen.getByText(/תגובות בפייסבוק/)).toBeInTheDocument()
    expect(screen.getByText(/יופעלו/)).toBeInTheDocument()
  })

  it('explains what to do when the Page is not connected', () => {
    render(<CommentsEmptyState kind='not-connected' />)
    expect(screen.getByText(/דף הפייסבוק אינו מחובר/)).toBeInTheDocument()
  })

  it('explains that comments will arrive on their own when there are none', () => {
    render(<CommentsEmptyState kind='no-comments' />)
    expect(screen.getByText(/אין עדיין תגובות/)).toBeInTheDocument()
  })

  it('filtered-empty says what the filter hides, not that there are no comments', () => {
    const { unmount } = render(<CommentsEmptyState kind='no-open' />)
    expect(screen.getByText('אין תגובות פתוחות')).toBeInTheDocument()
    expect(screen.queryByText(/אין עדיין תגובות/)).not.toBeInTheDocument()
    unmount()
    render(<CommentsEmptyState kind='no-converted' />)
    expect(screen.getByText('עדיין לא נוצרו לידים מתגובות')).toBeInTheDocument()
  })

  it('explains the pending permission honestly rather than showing a void', () => {
    render(<CommentsEmptyState kind='awaiting-text' />)
    expect(screen.getByText(/תוכן התגובות עדיין לא זמין/)).toBeInTheDocument()
    expect(screen.getByText(/פייסבוק/)).toBeInTheDocument()
  })

  it('uses no emoji anywhere', () => {
    for (const kind of ['not-enabled', 'not-connected', 'no-comments', 'no-open', 'no-converted', 'awaiting-text'] as const) {
      const { unmount } = render(<CommentsEmptyState kind={kind} />)
      expect(document.body.textContent ?? '').not.toMatch(/\p{Extended_Pictographic}/u)
      unmount()
    }
  })

  it('desktop empty mark stays circular; compact phone mark is rectangular', () => {
    const { unmount } = render(<CommentsEmptyState kind='no-comments' />)
    expect(document.querySelector('.rounded-full')).toBeTruthy()
    unmount()
    render(<CommentsEmptyState kind='no-comments' compact />)
    expect(document.querySelector('.rounded-full')).toBeNull()
    expect(document.querySelector('.rounded-md')).toBeTruthy()
  })
})
