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
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/lib/useAction', () => ({
  useAction: () => ({ loading: false, error: null, setError: vi.fn(), run: (fn: () => unknown) => fn() }),
}))
vi.mock('@/modules/facebookComments/actions', () => ({ convertCommentToLead: vi.fn(async () => ({ ok: true, leadId: 7, created: true })) }))
vi.mock('@/modules/facebookComments/replyActions', () => ({ replyToComment: vi.fn(async () => ({ ok: true, replyId: 'r1' })) }))
vi.mock('@/modules/facebookComments/listActions', () => ({ loadMoreComments: vi.fn(async () => ({ ok: false })) }))

import CommentsList from '@/modules/facebookComments/components/CommentsList'
import CommentsEmptyState from '@/modules/facebookComments/components/CommentsEmptyState'
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

    expect(screen.getByText(/תוכן התגובה לא התקבל מפייסבוק/)).toBeInTheDocument()
    // Never a blank or broken-looking bubble.
    expect(screen.queryByText('undefined')).not.toBeInTheDocument()
    expect(screen.queryByText('null')).not.toBeInTheDocument()
  })

  it('shows the real text once Meta sends it', () => {
    render(<CommentsList comments={[item({ message: 'כמה עולה?', messageAvailable: true })]} />)

    expect(screen.getByText('כמה עולה?')).toBeInTheDocument()
    expect(screen.queryByText(/לא התקבל מפייסבוק/)).not.toBeInTheDocument()
  })

  it('treats an empty message with messageAvailable=true as genuinely empty, not unavailable', () => {
    render(<CommentsList comments={[item({ message: '', messageAvailable: true })]} />)

    expect(screen.queryByText(/לא התקבל מפייסבוק/)).not.toBeInTheDocument()
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

  it('offers "המר לליד" on a live, unconverted comment', () => {
    render(<CommentsList comments={[item({ status: 'open', convertedLeadId: null })]} />)
    expect(screen.getByRole('button', { name: /המר לליד/ })).toBeInTheDocument()
  })

  it('hides "המר לליד" once the comment is converted', () => {
    render(<CommentsList comments={[item({ status: 'converted', convertedLeadId: 42 })]} />)
    expect(screen.queryByRole('button', { name: /המר לליד/ })).not.toBeInTheDocument()
  })

  it('hides "המר לליד" for a comment deleted on Facebook', () => {
    render(<CommentsList comments={[item({ status: 'deleted' })]} />)
    expect(screen.queryByRole('button', { name: /המר לליד/ })).not.toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: 'ענה לתגובה' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'פרסם תשובה' })).not.toBeInTheDocument()

    rerender(<CommentsList comments={[item()]} replyablePageIds={[base.pageId]} />)
    // Collapsed by default: no permanently open textarea on every card.
    expect(screen.queryByPlaceholderText('כתוב תשובה בשם הדף...')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ענה לתגובה' }))
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
    render(<CommentsInboxMobile emptyKind='not-enabled' comments={[]} />)
    expect(screen.getByTestId('facebook-comments-mobile')).toBeTruthy()
    expect(screen.getByRole('link', { name: /תגובות/ })).toHaveAttribute('href', '/inbox/comments')
    expect(screen.getByText(/תגובות בפייסבוק/)).toBeInTheDocument()
  })

  it('does not nest interactive controls', () => {
    const { container } = render(
      <CommentsInboxMobile
        emptyKind={null}
       
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
    // The commenter's avatar is a face, not a capsule — it is the one round element.
    const capsules = [...container.querySelectorAll('[class*="rounded-full"]')].filter(
      (el) => !/\bsize-1\b/.test(el.className) && !/\bsize-10\b/.test(el.className),
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
    expect(src).toContain('loadCommentsFeedPage')
    expect(src).toContain("className='grid gap-3 p-3 sm:p-4'")
    expect(src).toContain('CommentsList')
  })

  it('mobile inbox list exposes the existing channel switch', () => {
    const src = readFileSync(join(process.cwd(), 'modules/inbox/mobile/MobileInboxRoute.tsx'), 'utf8')
    expect(src).toContain('InboxChannelSwitch')
    expect(src).toContain("active='whatsapp'")
    expect(src).not.toContain('window.location.reload')
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

  it('a Page whose token predates comment-text access is told to reconnect, with the way to do it', () => {
    render(<CommentsEmptyState kind='needs-reconnect' />)
    expect(screen.getByText(/תוכן התגובות לא מגיע/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'חבר מחדש את הדף' })).toHaveAttribute('href', '/settings/integrations')
  })

  it('uses no emoji anywhere', () => {
    for (const kind of ['not-enabled', 'not-connected', 'no-comments', 'no-open', 'no-converted', 'needs-reconnect'] as const) {
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
