// @vitest-environment jsdom
/**
 * The comments inbox as cards: identity, comment, post context, reply, and
 * "load more". The REAL `useAction` runs (only entitlement is stubbed), so a
 * double click, a failure and a thrown action behave as in the browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const refresh = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
vi.mock('@/lib/entitlement/EntitlementContext', () => ({ useAccessDenied: () => false }))
vi.mock('@/modules/facebookComments/actions', () => ({ convertCommentToLead: vi.fn() }))
vi.mock('@/modules/facebookComments/replyActions', () => ({ replyToComment: vi.fn() }))
vi.mock('@/modules/facebookComments/listActions', () => ({ loadMoreComments: vi.fn() }))

import CommentsList from '@/modules/facebookComments/components/CommentsList'
import CommentsStatusFilter from '@/modules/facebookComments/components/CommentsStatusFilter'
import { replyToComment } from '@/modules/facebookComments/replyActions'
import { loadMoreComments } from '@/modules/facebookComments/listActions'
import type { CommentListItem, CommentPost } from '@/modules/facebookComments/types'

const PAGE = '1175908668934802'
const base: CommentListItem = {
  id: 1,
  pageId: PAGE,
  commentId: '122113311069337165_987654321',
  postId: `${PAGE}_122113311069337165`,
  parentId: `${PAGE}_122113311069337165`,
  isTopLevel: true,
  authorName: 'דנה לוי',
  message: 'כמה עולה?',
  messageAvailable: true,
  status: 'open',
  convertedLeadId: null,
  createdTime: new Date('2026-10-01T09:20:10.000Z'),
  receivedAt: new Date('2026-10-01T09:20:14.000Z'),
}
const item = (over: Partial<CommentListItem> = {}): CommentListItem => ({ ...base, ...over })
const post = (over: Partial<CommentPost> = {}): CommentPost => ({
  pageId: PAGE,
  postId: base.postId,
  message: 'מבצע סוף עונה על כל הקולקציה',
  pictureUrl: 'https://scontent.xx.fbcdn.net/post.jpg',
  permalinkUrl: 'https://www.facebook.com/x/posts/1',
  fetchStatus: 'ok',
  ...over,
})
const reply = vi.mocked(replyToComment)
const more = vi.mocked(loadMoreComments)

beforeEach(() => {
  reply.mockReset()
  more.mockReset()
  refresh.mockClear()
})
afterEach(() => cleanup())

describe('identity', () => {
  it('shows the picture Meta returned for the commenter', () => {
    const { container } = render(<CommentsList comments={[item({ authorPictureUrl: 'https://scontent.xx.fbcdn.net/dana.jpg' })]} />)
    const img = container.querySelector('img[src="https://scontent.xx.fbcdn.net/dana.jpg"]')
    expect(img).toBeTruthy()
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(screen.getByText('דנה לוי')).toBeInTheDocument()
  })

  it('falls back to initials when Meta returned no picture — never a stock face', () => {
    const { container } = render(<CommentsList comments={[item({ authorPictureUrl: null })]} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('דל')).toBeInTheDocument()
  })

  it('an expired picture URL swaps to initials instead of a broken image', () => {
    const { container } = render(<CommentsList comments={[item({ authorPictureUrl: 'https://scontent.xx.fbcdn.net/old.jpg' })]} />)
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('דל')).toBeInTheDocument()
  })
})

describe('comment text', () => {
  it('keeps line breaks and wraps long words inside the card', () => {
    render(<CommentsList comments={[item({ message: 'שורה ראשונה\nשורה שנייה' })]} />)
    const p = screen.getByText(/שורה ראשונה/)
    expect(p.className).toMatch(/whitespace-pre-wrap/)
    expect(p.className).toMatch(/break-words/)
  })

  it('clamps a long comment behind an explicit "הצג עוד"', () => {
    render(<CommentsList comments={[item({ message: 'מילה '.repeat(120) })]} />)
    const toggle = screen.getByRole('button', { name: 'הצג עוד' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'הצג פחות' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('a short comment has no toggle', () => {
    render(<CommentsList comments={[item()]} />)
    expect(screen.queryByRole('button', { name: 'הצג עוד' })).not.toBeInTheDocument()
  })

  it('shows an attached photo, and says so plainly once it expires', () => {
    render(<CommentsList comments={[item({ attachmentType: 'photo', attachmentUrl: 'https://scontent.xx.fbcdn.net/att.jpg' })]} />)
    fireEvent.error(screen.getByAltText('תמונה שצורפה לתגובה'))
    expect(screen.getByText('התמונה שצורפה לתגובה כבר לא זמינה')).toBeInTheDocument()
  })
})

describe('post context', () => {
  it('shows the post thumbnail, its text and the link back, below the comment', () => {
    const { container } = render(<CommentsList comments={[item()]} posts={[post()]} />)
    expect(screen.getByText('מבצע סוף עונה על כל הקולקציה')).toBeInTheDocument()
    expect(container.querySelector('img[src="https://scontent.xx.fbcdn.net/post.jpg"]')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'פתח את הפוסט בפייסבוק' })).toHaveAttribute('target', '_blank')
  })

  it('a post without an image shows its text only', () => {
    const { container } = render(<CommentsList comments={[item()]} posts={[post({ pictureUrl: null })]} />)
    expect(container.querySelectorAll('img')).toHaveLength(0)
    expect(screen.getByText('מבצע סוף עונה על כל הקולקציה')).toBeInTheDocument()
  })

  it('a post Meta says is gone reads as gone, with no dead link', () => {
    render(<CommentsList comments={[item()]} posts={[post({ fetchStatus: 'unavailable', message: null, pictureUrl: null })]} />)
    expect(screen.getByText('הפוסט כבר לא זמין בפייסבוק')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'פתח את הפוסט בפייסבוק' })).not.toBeInTheDocument()
  })

  it('a legacy comment with no post data still links to the post, and claims nothing else', () => {
    render(<CommentsList comments={[item({ messageAvailable: false, message: '' })]} posts={[]} />)
    expect(screen.getByRole('link', { name: 'פתח את הפוסט בפייסבוק' })).toBeInTheDocument()
    expect(screen.getByText('תוכן התגובה לא התקבל מפייסבוק')).toBeInTheDocument()
  })

  it("never attaches another Page's post with the same post id", () => {
    render(<CommentsList comments={[item()]} posts={[post({ pageId: 'OTHER_PAGE' })]} />)
    expect(screen.queryByText('מבצע סוף עונה על כל הקולקציה')).not.toBeInTheDocument()
  })
})

describe('reply composer', () => {
  const open = () => fireEvent.click(screen.getByRole('button', { name: 'ענה לתגובה' }))
  const type = (text: string) => fireEvent.change(screen.getByPlaceholderText('כתוב תשובה בשם הדף...'), { target: { value: text } })
  const publish = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'פרסם תשובה' }))
    })
  }

  it('success shows the reply in the thread at once, marked as sent from SocialCRM, and closes the composer', async () => {
    reply.mockResolvedValueOnce({ ok: true, replyId: 'R_NEW' })
    render(<CommentsList comments={[item()]} replyablePageIds={[PAGE]} />)
    open()
    type('שלחנו לך פרטים בהודעה')
    await publish()

    const thread = screen.getByRole('list', { name: 'תגובות בשרשור' })
    expect(within(thread).getByText('שלחנו לך פרטים בהודעה')).toBeInTheDocument()
    expect(within(thread).getByText('נשלח מ-SocialCRM')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('כתוב תשובה בשם הדף...')).not.toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()
  })

  it('the stored copy arriving after the refresh does not show the reply twice', async () => {
    reply.mockResolvedValueOnce({ ok: true, replyId: 'R_NEW' })
    const { rerender } = render(<CommentsList comments={[item()]} replyablePageIds={[PAGE]} />)
    open()
    type('תודה')
    await publish()
    rerender(
      <CommentsList
        comments={[item()]}
        replyablePageIds={[PAGE]}
        replies={[
          {
            id: 9,
            pageId: PAGE,
            commentId: 'R_NEW',
            parentId: base.commentId,
            authorName: 'העסק',
            authorIsPage: true,
            sentByUserId: 7,
            message: 'תודה',
            messageAvailable: true,
            status: 'open',
            createdTime: new Date(),
            receivedAt: new Date(),
          },
        ]}
      />,
    )
    expect(screen.getAllByText('תודה')).toHaveLength(1)
  })

  it('a refusal keeps the draft and says what to do', async () => {
    reply.mockResolvedValueOnce({ ok: false, reason: 'rate_limited' })
    render(<CommentsList comments={[item()]} replyablePageIds={[PAGE]} />)
    open()
    type('טיוטה חשובה')
    await publish()
    expect(screen.getByRole('alert')).toHaveTextContent('פייסבוק מגביל כרגע את קצב הפעולות')
    expect(screen.getByPlaceholderText('כתוב תשובה בשם הדף...')).toHaveValue('טיוטה חשובה')
    expect(screen.queryByText('נשלח מ-SocialCRM')).not.toBeInTheDocument()
  })

  it('a thrown action is an inline error, not a silent un-spin', async () => {
    reply.mockRejectedValueOnce(new Error('network'))
    render(<CommentsList comments={[item()]} replyablePageIds={[PAGE]} />)
    open()
    type('שלום')
    await publish()
    expect(screen.getByRole('alert')).toHaveTextContent('לא הצלחנו לפרסם את התשובה')
  })

  it('a double click while publishing sends ONE reply', async () => {
    let resolve: (v: { ok: true; replyId: string }) => void = () => {}
    reply.mockImplementationOnce(() => new Promise((r) => (resolve = r)))
    render(<CommentsList comments={[item()]} replyablePageIds={[PAGE]} />)
    open()
    type('שלום')
    const button = screen.getByRole('button', { name: 'פרסם תשובה' })
    await act(async () => {
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)
    })
    expect(reply).toHaveBeenCalledTimes(1)
    await act(async () => resolve({ ok: true, replyId: 'R1' }))
  })

  it('cancel closes the composer without sending', () => {
    render(<CommentsList comments={[item()]} replyablePageIds={[PAGE]} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }))
    expect(screen.getByRole('button', { name: 'ענה לתגובה' })).toBeInTheDocument()
    expect(reply).not.toHaveBeenCalled()
  })
})

describe('load more', () => {
  const cursor = { receivedAt: '2026-10-01T00:00:00.000Z', id: 5 }

  it('appends the next page and hides the button when there is no further page', async () => {
    more.mockResolvedValueOnce({
      ok: true,
      items: [item({ id: 2, commentId: 'C2', message: 'תגובה ישנה' })],
      replies: [],
      posts: [],
      nextCursor: null,
    })
    render(<CommentsList comments={[item()]} nextCursor={cursor} status='open' />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'טען עוד תגובות' }))
    })
    expect(more).toHaveBeenCalledWith('open', cursor)
    expect(screen.getByText('תגובה ישנה')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'טען עוד תגובות' })).not.toBeInTheDocument()
  })

  it('never shows a comment twice when pages overlap', async () => {
    more.mockResolvedValueOnce({ ok: true, items: [item()], replies: [], posts: [], nextCursor: null })
    render(<CommentsList comments={[item()]} nextCursor={cursor} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'טען עוד תגובות' }))
    })
    expect(screen.getAllByText('כמה עולה?')).toHaveLength(1)
  })

  it('a failed page keeps the list and offers a retry', async () => {
    more.mockResolvedValueOnce({ ok: false })
    render(<CommentsList comments={[item()]} nextCursor={cursor} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'טען עוד תגובות' }))
    })
    expect(screen.getByRole('alert')).toHaveTextContent('לא הצלחנו לטעון עוד תגובות')
    expect(screen.getByRole('button', { name: 'טען עוד תגובות' })).toBeEnabled()
    expect(screen.getByText('כמה עולה?')).toBeInTheDocument()
  })

  it('no next page, no button', () => {
    render(<CommentsList comments={[item()]} />)
    expect(screen.queryByRole('button', { name: 'טען עוד תגובות' })).not.toBeInTheDocument()
  })
})

describe('filters', () => {
  it('"פתוחות" carries the server-counted open total; zero shows no badge', () => {
    const { unmount } = render(<CommentsStatusFilter active='all' openCount={4} />)
    expect(screen.getByRole('link', { name: /פתוחות/ })).toHaveTextContent('4')
    unmount()
    render(<CommentsStatusFilter active='all' openCount={0} />)
    expect(screen.getByRole('link', { name: 'פתוחות' })).toBeInTheDocument()
  })
})

describe('mobile structure', () => {
  it('every action is a 44px tap target, and the card cannot overflow its row', () => {
    const { container } = render(<CommentsList comments={[item()]} replyablePageIds={[PAGE]} touch />)
    const actions = screen.getByRole('button', { name: 'ענה לתגובה' }).parentElement!
    expect(actions.className).toMatch(/\[&_button\]:min-h-11/)
    expect(container.querySelector('article .min-w-0')).toBeTruthy()
  })
})

describe('load more — filter changes', () => {
  it('switching the filter drops pages loaded under the previous one (the same list instance is reused)', async () => {
    more.mockResolvedValueOnce({
      ok: true,
      items: [item({ id: 2, commentId: 'C_ALL_ONLY', message: 'נטען תחת הכל' })],
      replies: [],
      posts: [],
      nextCursor: { receivedAt: '2026-09-01T00:00:00.000Z', id: 1 },
    })
    const cursor = { receivedAt: '2026-10-01T00:00:00.000Z', id: 5 }
    const { rerender } = render(<CommentsList comments={[item()]} nextCursor={cursor} status='all' />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'טען עוד תגובות' }))
    })
    expect(screen.getByText('נטען תחת הכל')).toBeInTheDocument()

    // Navigating to ?status=open re-renders the SAME component with new props.
    const openCursor = { receivedAt: '2026-10-02T00:00:00.000Z', id: 9 }
    rerender(<CommentsList comments={[item()]} nextCursor={openCursor} status='open' />)
    expect(screen.queryByText('נטען תחת הכל')).not.toBeInTheDocument()

    more.mockResolvedValueOnce({ ok: true, items: [], replies: [], posts: [], nextCursor: null })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'טען עוד תגובות' }))
    })
    // The next page under "open" starts from the cursor the server issued for "open".
    expect(more).toHaveBeenLastCalledWith('open', openCursor)
  })
})

describe('card grid and the post image', () => {
  it('lays cards out as a grid on the feed width: one column, two once the feed is wide — never capped to a narrow column', () => {
    const { container } = render(<CommentsList comments={[item(), item({ id: 2, commentId: 'C2' })]} />)
    const feed = container.querySelector('[class*="@container/feed"]')!
    expect(feed).toBeTruthy()
    expect(feed.className).not.toMatch(/max-w-3xl/)
    const grid = screen.getByRole('list', { name: 'תגובות מפייסבוק' })
    expect(grid.className).toMatch(/\bgrid-cols-1\b/)
    expect(grid.className).toContain('@4xl/feed:grid-cols-2')
  })

  it('cards are as tall as their content — a short card is never stretched into dead space', () => {
    const { container } = render(<CommentsList comments={[item()]} replyablePageIds={[PAGE]} />)
    expect(screen.getByRole('list', { name: 'תגובות מפייסבוק' }).className).toMatch(/\bitems-start\b/)
    expect(container.querySelector('article')!.className).not.toMatch(/\bh-full\b/)
  })

  it('keeps the commenter avatar at its existing size', () => {
    const { container } = render(<CommentsList comments={[item({ authorPictureUrl: 'https://scontent.xx.fbcdn.net/dana.jpg' })]} />)
    expect(container.querySelector('article header img')!.className).toMatch(/\bsize-10\b/)
  })

  it('the post image spans the card, keeps its aspect ratio, and is capped without stretching or cropping', () => {
    const { container } = render(<CommentsList comments={[item()]} posts={[post()]} />)
    const img = container.querySelector('[data-post-image] img')!
    expect(img).toHaveAttribute('src', 'https://scontent.xx.fbcdn.net/post.jpg')
    for (const cls of ['w-full', 'h-auto', 'max-h-64', 'object-contain']) expect(img.className).toContain(cls)
    expect(img.className).not.toMatch(/size-12|object-cover/)
  })

  it('clicking the image opens the post; the text link stays the single accessible link', () => {
    const { container } = render(<CommentsList comments={[item()]} posts={[post()]} />)
    const imageLink = container.querySelector('a[data-post-image]')!
    expect(imageLink).toHaveAttribute('href', 'https://www.facebook.com/1175908668934802_122113311069337165?comment_id=987654321')
    expect(imageLink).toHaveAttribute('target', '_blank')
    expect(imageLink).toHaveAttribute('tabindex', '-1')
    expect(imageLink).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getAllByRole('link', { name: 'פתח את הפוסט בפייסבוק' })).toHaveLength(1)
  })

  it('a post without an image shows no empty image frame', () => {
    const { container } = render(<CommentsList comments={[item()]} posts={[post({ pictureUrl: null })]} />)
    expect(container.querySelector('[data-post-image]')).toBeNull()
    expect(screen.getByText('מבצע סוף עונה על כל הקולקציה')).toBeInTheDocument()
  })

  it('a post image that no longer loads leaves the excerpt and link, not a broken frame', () => {
    const { container } = render(<CommentsList comments={[item()]} posts={[post()]} />)
    fireEvent.error(container.querySelector('[data-post-image] img')!)
    expect(container.querySelector('[data-post-image]')).toBeNull()
    expect(screen.getByRole('link', { name: 'פתח את הפוסט בפייסבוק' })).toBeInTheDocument()
  })
})
