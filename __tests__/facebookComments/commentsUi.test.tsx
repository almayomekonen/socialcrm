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
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/lib/useAction', () => ({
  useAction: () => ({ loading: false, error: null, setError: vi.fn(), run: (fn: () => unknown) => fn() }),
}))
vi.mock('@/modules/facebookComments/actions', () => ({ convertCommentToLead: vi.fn(async () => ({ ok: true, leadId: 7 })) }))

import CommentsList from '@/modules/facebookComments/components/CommentsList'
import CommentsEmptyState from '@/modules/facebookComments/components/CommentsEmptyState'
import InboxChannelSwitch from '@/modules/inbox/components/InboxChannelSwitch'
import CommentsInboxMobile from '@/modules/facebookComments/mobile/CommentsInboxMobile'
import CommentsListMobile from '@/modules/facebookComments/mobile/CommentsListMobile'
import type { CommentListItem } from '@/modules/facebookComments/types'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

afterEach(() => cleanup())

const base: CommentListItem = {
  id: 1,
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
    const link = screen.getByRole('link', { name: /פתח את הליד/ })
    expect(link).toHaveAttribute('href', '/clients/42/summary')
  })

  it('shows no lead link when nothing was converted', () => {
    render(<CommentsList comments={[item({ status: 'open', convertedLeadId: null })]} />)
    expect(screen.queryByRole('link', { name: /פתח את הליד/ })).not.toBeInTheDocument()
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

  it('explains the pending permission honestly rather than showing a void', () => {
    render(<CommentsEmptyState kind='awaiting-text' />)
    expect(screen.getByText(/תוכן התגובות עדיין לא זמין/)).toBeInTheDocument()
    expect(screen.getByText(/פייסבוק/)).toBeInTheDocument()
  })

  it('uses no emoji anywhere', () => {
    for (const kind of ['not-enabled', 'not-connected', 'no-comments', 'awaiting-text'] as const) {
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
