// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import NotificationCenter from '@/components/notifications/NotificationCenter'
import type { NotificationFeedItem } from '@/modules/notifications/types'

const H = vi.hoisted(() => ({
  markRead: vi.fn(),
  markSeen: vi.fn(),
  markAllRead: vi.fn(),
  toast: vi.fn(),
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: H.push }) }))
vi.mock('@/lib/toast', () => ({ toast: H.toast }))
vi.mock('@/modules/notifications/NotificationContext', () => ({
  useNotifications: () => ({
    enabled: true,
    unreadCount: 2,
    items: [],
    whileYouWereAway: null,
    presence: 'online',
    markSeen: H.markSeen,
    markRead: H.markRead,
    markAllRead: H.markAllRead,
  }),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function item(over: Partial<NotificationFeedItem> = {}): NotificationFeedItem {
  return {
    id: 1,
    type: 'lead.created',
    category: 'leads',
    priority: 'medium',
    title: 'ליד חדש — דנה',
    body: null,
    entityType: 'lead',
    entityId: 55,
    deepLink: '/clients/55/summary',
    groupCount: 1,
    createdAt: '2026-08-11T10:00:00.000Z',
    seenAt: null,
    readAt: null,
    toastEligible: false,
    ...over,
  }
}

function renderMobile(items: NotificationFeedItem[] = [item(), item({ id: 2, title: 'הודעה חדשה — נועה' })]) {
  return render(
    <NotificationCenter
      variant='mobile'
      initialItems={items}
      initialCursor={null}
      filters={{ unreadOnly: false, category: null }}
    />,
  )
}

function enterSelection(el: Element) {
  fireEvent.contextMenu(el)
}

describe('mobile notification selection', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, updated: 1 }) })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('a normal tap marks read and opens the entity — never a notification id', () => {
    renderMobile([item({ id: 8134, deepLink: '/clients/55/summary' })])
    fireEvent.click(screen.getByTestId('notification-row'))
    expect(H.markRead).toHaveBeenCalledWith([8134])
    expect(H.push).toHaveBeenCalledWith('/clients/55/summary')
    expect(screen.queryByTestId('notifications-selection-bar')).toBeNull()
  })

  it('long press enters selection and does not navigate or delete', () => {
    renderMobile([item()])
    enterSelection(screen.getByTestId('notification-row'))
    expect(screen.getByTestId('notifications-selection-bar').textContent).toContain('נבחרו 1')
    expect(H.push).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'מחק' })).toBeNull()
  })

  it('second tap deselects and exits selection', () => {
    renderMobile([item()])
    const row = screen.getByTestId('notification-row')
    enterSelection(row)
    fireEvent.click(row)
    fireEvent.click(row)
    expect(screen.queryByTestId('notifications-selection-bar')).toBeNull()
  })

  it('multi-select then cancel does not mark read', () => {
    renderMobile()
    enterSelection(screen.getAllByTestId('notification-row')[0])
    fireEvent.click(screen.getAllByTestId('notification-row')[1])
    expect(screen.getByTestId('notifications-selection-bar').textContent).toContain('נבחרו 2')
    fireEvent.click(screen.getAllByRole('button', { name: 'ביטול' })[0])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(H.markRead).not.toHaveBeenCalled()
  })

  it('mark as read uses the existing ids contract and is optimistic', async () => {
    renderMobile([item({ id: 4 })])
    enterSelection(screen.getByTestId('notification-row'))
    fireEvent.click(screen.getByRole('button', { name: 'סמן כנקרא' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/notifications/read'))
    expect(call).toBeTruthy()
    expect(call![1].body).toBe(JSON.stringify({ ids: [4] }))
    await waitFor(() => expect(H.markRead).toHaveBeenCalledWith([4]))
  })

  it('failed mark-read rolls back only the affected rows', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
    renderMobile([item({ id: 4, title: 'ליד חדש — דנה' }), item({ id: 5, title: 'הודעה חדשה — נועה', readAt: '2026-08-11T11:00:00.000Z' })])
    enterSelection(screen.getAllByTestId('notification-row')[0])
    fireEvent.click(screen.getByRole('button', { name: 'סמן כנקרא' }))
    await waitFor(() => expect(H.toast).toHaveBeenCalledWith('error', expect.stringMatching(/כנקרא/)))
    expect(H.markRead).not.toHaveBeenCalled()
    expect(screen.getByText('לא נקרא')).toBeTruthy()
  })

  it('desktop variant has no selection bar and no long-press selection chrome', () => {
    render(
      <NotificationCenter
        initialItems={[item()]}
        initialCursor={null}
        filters={{ unreadOnly: false, category: null }}
      />,
    )
    fireEvent.contextMenu(screen.getByRole('button', { name: /ליד חדש/ }))
    expect(screen.queryByTestId('notifications-selection-bar')).toBeNull()
    expect(screen.queryByTestId('notification-row')).toBeNull()
  })
})
