// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { LONG_PRESS_MS } from '@/components/mobile/useLongPress'

const H = vi.hoisted(() => ({
  deleteConversation: vi.fn(),
  markConversationRead: vi.fn(),
  loadMoreInboxConversations: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/inbox',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/modules/inbox/actions', () => ({
  deleteConversation: H.deleteConversation,
  markConversationRead: H.markConversationRead,
  loadMoreInboxConversations: H.loadMoreInboxConversations,
}))
vi.mock('@/lib/toast', () => ({ toast: H.toast }))

import ConversationListMobile from '@/modules/inbox/mobile/ConversationListMobile'
import type { InboxConversationListItem } from '@/modules/inbox/types'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

beforeEach(() => {
  H.deleteConversation.mockResolvedValue({ ok: true, deleted: true })
  H.markConversationRead.mockResolvedValue({ ok: true })
  H.loadMoreInboxConversations.mockResolvedValue({ items: [], nextCursor: null })
})

const item = (over: Partial<InboxConversationListItem> = {}): InboxConversationListItem => ({
  conversationId: 9,
  leadId: 4,
  channel: 'whatsapp',
  displayName: 'נועה',
  leadName: 'נועה',
  leadStatus: 'new',
  lastMessageAt: '2026-08-16T11:00:00.000Z',
  lastInboundAt: '2026-08-16T05:00:00.000Z',
  lastHumanOutboundAt: null,
  lastDirection: 'inbound',
  lastMessagePreview: 'שאלה',
  unread: true,
  attention: null,
  waitingTitle: null,
  waitingWindowHint: null,
  temperature: null,
  intent: null,
  suggestedAction: null,
  ...over,
})

function renderList(items: InboxConversationListItem[] = [item(), item({ conversationId: 10, displayName: 'דני' })]) {
  return render(<ConversationListMobile items={items} q='' nextCursor={null} formatWhen={() => 'לפני שעה'} />)
}

function enterSelection(el: Element) {
  fireEvent.contextMenu(el)
}

/** Real tap: pointerdown clears leftover-click suppress, then click toggles. */
function tap(el: Element) {
  fireEvent.pointerDown(el, { pointerType: 'touch', button: 0, clientX: 8, clientY: 8 })
  fireEvent.pointerUp(el, { pointerType: 'touch', button: 0, clientX: 8, clientY: 8 })
  fireEvent.click(el)
}

describe('mobile inbox selection', () => {
  it('a normal row is a link to the thread', () => {
    renderList([item()])
    expect(screen.getByRole('link', { name: /נועה/ }).getAttribute('href')).toBe('/inbox?conversation=9')
    expect(screen.queryByTestId('inbox-selection-bar')).toBeNull()
  })

  it('long press / context menu enters selection and never calls delete', () => {
    renderList([item()])
    enterSelection(screen.getByTestId('conversation-row'))
    expect(screen.getByTestId('inbox-selection-bar').textContent).toContain('נבחרו 1')
    expect(H.deleteConversation).not.toHaveBeenCalled()
    const row = screen.getByRole('link', { name: /נועה/ })
    expect(row.getAttribute('aria-pressed')).toBe('true')
    expect(row.getAttribute('href')).toBe('/inbox?conversation=9')
  })

  it('leftover click after long press does not immediately deselect', () => {
    renderList([item()])
    const row = screen.getByTestId('conversation-row')
    enterSelection(row)
    fireEvent.click(row)
    expect(screen.getByTestId('inbox-selection-bar').textContent).toContain('נבחרו 1')
  })

  it('the hold timer also enters selection', () => {
    vi.useFakeTimers()
    renderList([item()])
    const row = screen.getByTestId('conversation-row')
    act(() => {
      fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 20, clientY: 20, button: 0 })
      vi.advanceTimersByTime(LONG_PRESS_MS + 20)
    })
    expect(screen.getByTestId('inbox-selection-bar').textContent).toContain('נבחרו 1')
  })

  it('moving past the threshold cancels long press', () => {
    vi.useFakeTimers()
    renderList([item()])
    const row = screen.getByTestId('conversation-row')
    act(() => {
      fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 20, clientY: 20, button: 0 })
      fireEvent.pointerMove(row, { pointerType: 'touch', clientX: 20, clientY: 80 })
      vi.advanceTimersByTime(LONG_PRESS_MS + 20)
    })
    expect(screen.queryByTestId('inbox-selection-bar')).toBeNull()
  })

  it('toggles a second row and updates the count', () => {
    renderList()
    enterSelection(screen.getAllByTestId('conversation-row')[0])
    tap(screen.getAllByTestId('conversation-row')[1])
    expect(screen.getByTestId('inbox-selection-bar').textContent).toContain('נבחרו 2')
    tap(screen.getAllByTestId('conversation-row')[1])
    expect(screen.getByTestId('inbox-selection-bar').textContent).toContain('נבחרו 1')
  })

  it('cancel leaves selection without mutating', () => {
    renderList([item()])
    enterSelection(screen.getByTestId('conversation-row'))
    fireEvent.click(screen.getAllByRole('button', { name: 'ביטול' })[0])
    expect(screen.queryByTestId('inbox-selection-bar')).toBeNull()
    expect(screen.getByRole('link', { name: /נועה/ })).toBeTruthy()
    expect(H.deleteConversation).not.toHaveBeenCalled()
  })

  it('delete is confirm-gated, optimistic, and rolls back on failure', async () => {
    H.deleteConversation.mockResolvedValueOnce({ ok: false, deleted: false })
    renderList([item()])
    enterSelection(screen.getByTestId('conversation-row'))
    fireEvent.click(screen.getByRole('button', { name: 'מחק' }))
    expect(H.deleteConversation).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'מחיקת שיחות' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'מחק שיחה' }))
    await waitFor(() => expect(H.deleteConversation).toHaveBeenCalledWith(9))
    await waitFor(() => expect(H.toast).toHaveBeenCalledWith('error', expect.stringMatching(/נכשלה/)))
    expect(screen.getByText('נועה')).toBeTruthy()
  })

  it('successful delete removes the row without router.refresh', async () => {
    renderList()
    enterSelection(screen.getAllByTestId('conversation-row')[0])
    fireEvent.click(screen.getByRole('button', { name: 'מחק' }))
    fireEvent.click(screen.getByRole('button', { name: 'מחק שיחה' }))
    await waitFor(() => expect(H.deleteConversation).toHaveBeenCalledWith(9))
    await waitFor(() => expect(screen.queryByText('נועה')).toBeNull())
    expect(screen.getByText('דני')).toBeTruthy()
  })

  it('mark as read calls the existing per-id mutation', async () => {
    renderList([item({ unread: true })])
    enterSelection(screen.getByTestId('conversation-row'))
    fireEvent.click(screen.getByRole('button', { name: 'סמן כנקרא' }))
    await waitFor(() => expect(H.markConversationRead).toHaveBeenCalledWith(9))
  })

  it('deselecting the last item exits selection and closes the confirm sheet', () => {
    renderList([item()])
    const row = screen.getByTestId('conversation-row')
    enterSelection(row)
    fireEvent.click(screen.getByRole('button', { name: 'מחק' }))
    expect(screen.getByRole('dialog', { name: 'מחיקת שיחות' })).toBeTruthy()
    tap(screen.getByRole('link', { name: /נועה/ }))
    expect(screen.queryByRole('dialog', { name: 'מחיקת שיחות' })).toBeNull()
    expect(screen.queryByTestId('inbox-selection-bar')).toBeNull()
    expect(screen.getByRole('link', { name: /נועה/ })).toBeTruthy()
  })

  it('deselecting A while B remains keeps confirm open for the remaining selection', () => {
    renderList()
    enterSelection(screen.getAllByTestId('conversation-row')[0])
    tap(screen.getAllByTestId('conversation-row')[1])
    fireEvent.click(screen.getByRole('button', { name: 'מחק' }))
    expect(screen.getByRole('dialog', { name: 'מחיקת שיחות' })).toBeTruthy()
    tap(screen.getByRole('link', { name: /נועה/ }))
    expect(screen.getByRole('dialog', { name: 'מחיקת שיחות' })).toBeTruthy()
    expect(screen.getByTestId('inbox-selection-bar').textContent).toContain('נבחרו 1')
    expect(screen.getByRole('link', { name: /דני/ }).getAttribute('aria-pressed')).toBe('true')
  })
})
