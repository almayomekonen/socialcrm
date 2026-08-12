// @vitest-environment jsdom
//
// Notification center behaviour — P2.4.
//
// Driven through the real NotificationCenter with a stubbed NotificationContext
// and a stubbed feed page response, so what is under test is the center's own
// contract: individual rows, URL filters as props, cursor pagination against
// the existing feed endpoint, seen stamping for loaded rows only, and
// mark-read + entity deep links with no notification id in the URL.
//
// Runs in `npm run test:notifications`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import NotificationCenter from '@/components/notifications/NotificationCenter'
import NotificationFilters from '@/components/notifications/NotificationFilters'
import { CENTER_PAGE_SIZE } from '@/modules/notifications/center'
import type { FeedCursor, NotificationFeedItem, NotificationFeedResponse } from '@/modules/notifications/types'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const markSeen = vi.fn()
const markRead = vi.fn()
const markAllRead = vi.fn()

vi.mock('@/modules/notifications/NotificationContext', () => ({
  useNotifications: () => ({
    enabled: true,
    unreadCount: 3,
    items: [],
    whileYouWereAway: null,
    presence: 'online',
    markSeen,
    markRead,
    markAllRead,
  }),
}))

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

function feedPage(over: Partial<NotificationFeedResponse> = {}): NotificationFeedResponse {
  return {
    enabled: true,
    unreadNotificationCount: 0,
    unreadConversationCount: 0,
    items: [],
    whileYouWereAway: null,
    presence: 'online',
    serverTime: '2026-08-11T12:00:00.000Z',
    nextCursor: null,
    ...over,
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  push.mockReset()
  markSeen.mockReset()
  markRead.mockReset()
  markAllRead.mockReset()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('NotificationCenter — individual rows and surfaces', () => {
  it('renders one row per database record, never grouped', () => {
    render(
      <NotificationCenter
        initialItems={[item({ id: 1, title: 'א' }), item({ id: 2, title: 'ב' }), item({ id: 3, title: 'ג' })]}
        initialCursor={null}
        filters={{ unreadOnly: false, category: null }}
      />,
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('א')).toBeTruthy()
    expect(screen.getByText('ב')).toBeTruthy()
    expect(screen.getByText('ג')).toBeTruthy()
  })

  it('stamps seenAt for every loaded unseen row — and only those', () => {
    render(
      <NotificationCenter
        initialItems={[
          item({ id: 1 }),
          item({ id: 2, seenAt: '2026-08-11T09:00:00.000Z' }),
          item({ id: 3 }),
        ]}
        initialCursor={null}
        filters={{ unreadOnly: false, category: null }}
      />,
    )
    expect(markSeen).toHaveBeenCalledWith([1, 3])
  })

  it('does not mark rows read merely by rendering them', () => {
    render(
      <NotificationCenter
        initialItems={[item({ id: 1 })]}
        initialCursor={null}
        filters={{ unreadOnly: false, category: null }}
      />,
    )
    expect(markRead).not.toHaveBeenCalled()
    expect(markAllRead).not.toHaveBeenCalled()
  })

  it('click marks read and navigates to the entity deep link — never a notification id', () => {
    render(
      <NotificationCenter
        initialItems={[item({ id: 8134, deepLink: '/clients/55/summary' })]}
        initialCursor={null}
        filters={{ unreadOnly: false, category: null }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /ליד חדש/ }))
    expect(markRead).toHaveBeenCalledWith([8134])
    expect(push).toHaveBeenCalledWith('/clients/55/summary')
    expect(String(push.mock.calls[0][0])).not.toMatch(/8134/)
    expect(String(push.mock.calls[0][0])).not.toMatch(/notification/i)
  })

  it('mark-all-read goes through NotificationContext, not a second owner', () => {
    render(
      <NotificationCenter
        initialItems={[item({ id: 1 })]}
        initialCursor={null}
        filters={{ unreadOnly: false, category: null }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'סימון הכל כנקרא' }))
    expect(markAllRead).toHaveBeenCalledTimes(1)
  })

  it('shows the filtered empty state when a filter matches nothing', () => {
    render(
      <NotificationCenter
        initialItems={[]}
        initialCursor={null}
        filters={{ unreadOnly: true, category: 'leads' }}
      />,
    )
    expect(screen.getByText('אין התראות שתואמות לסינון')).toBeTruthy()
  })
})

describe('NotificationCenter — cursor pagination against the existing feed', () => {
  it('asks /api/notifications/feed with cursor, limit and the active filters', async () => {
    const cursor: FeedCursor = { createdAt: '2026-08-11T10:00:00.000Z', id: 900 }
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => feedPage({ items: [item({ id: 8, title: 'עמוד 2' })], nextCursor: null }),
    })

    render(
      <NotificationCenter
        initialItems={[item({ id: 10, title: 'עמוד 1' })]}
        initialCursor={cursor}
        filters={{ unreadOnly: true, category: 'leads' }}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'הצג עוד' }))
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/api/notifications/feed?')
    expect(url).toContain(`limit=${CENTER_PAGE_SIZE}`)
    expect(url).toContain('unread=1')
    expect(url).toContain('category=leads')
    const qs = new URL(url, 'http://local.test').searchParams
    expect(qs.get('cursor')).toBe('2026-08-11T10:00:00.000Z_900')
    expect(url).not.toMatch(/userId=|agencyId=/)

    expect(screen.getByText('עמוד 1')).toBeTruthy()
    expect(screen.getByText('עמוד 2')).toBeTruthy()
  })

  it('stamps newly loaded rows as seen once they are on the page', async () => {
    const cursor: FeedCursor = { createdAt: '2026-08-11T10:00:00.000Z', id: 900 }
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => feedPage({ items: [item({ id: 8 })], nextCursor: null }),
    })

    render(
      <NotificationCenter
        initialItems={[item({ id: 10 })]}
        initialCursor={cursor}
        filters={{ unreadOnly: false, category: null }}
      />,
    )
    expect(markSeen).toHaveBeenLastCalledWith([10])

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'הצג עוד' }))
    })
    await waitFor(() => expect(markSeen).toHaveBeenLastCalledWith([10, 8]))
  })

  it('hides the load-more control when there is no next cursor', () => {
    render(
      <NotificationCenter
        initialItems={[item({ id: 1 })]}
        initialCursor={null}
        filters={{ unreadOnly: false, category: null }}
      />,
    )
    expect(screen.queryByRole('button', { name: 'הצג עוד' })).toBeNull()
  })
})

describe('NotificationFilters — URL chips, not client state', () => {
  it('unread and category are independent axes of links', () => {
    render(<NotificationFilters filters={{ unreadOnly: true, category: 'leads' }} />)

    const unread = screen.getByRole('link', { name: 'לא נקראו' })
    expect(unread.getAttribute('href')).toBe('/notifications?unread=1&category=leads')
    expect(unread.getAttribute('aria-current')).toBe('page')

    const leads = screen.getByRole('link', { name: 'לידים' })
    expect(leads.getAttribute('href')).toBe('/notifications?unread=1&category=leads')
    expect(leads.getAttribute('aria-current')).toBe('page')

    const all = screen.getByRole('link', { name: 'הכל' })
    expect(all.getAttribute('href')).toBe('/notifications?category=leads')
  })

  it('never puts a notification id in a filter URL', () => {
    render(<NotificationFilters filters={{ unreadOnly: false, category: 'messages' }} />)
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href')).not.toMatch(/id=|\d{3,}/)
    }
  })
})
