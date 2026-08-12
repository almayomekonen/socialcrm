// @vitest-environment jsdom
//
// Accessibility of the notification center filters and list — P2.4.
// Complements __tests__/a11y/notificationBell.test.tsx.

import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import NotificationFilters from '@/components/notifications/NotificationFilters'
import NotificationCenter from '@/components/notifications/NotificationCenter'
import type { NotificationFeedItem } from '@/modules/notifications/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/modules/notifications/NotificationContext', () => ({
  useNotifications: () => ({
    enabled: true,
    unreadCount: 1,
    items: [],
    whileYouWereAway: null,
    presence: 'online',
    markSeen: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  }),
}))

afterEach(cleanup)

const item: NotificationFeedItem = {
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
}

describe('notification center a11y', () => {
  it('filter chips are real links with an accessible current page', () => {
    render(<NotificationFilters filters={{ unreadOnly: true, category: null }} />)

    expect(screen.getByRole('navigation', { name: 'מצב קריאה' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'קטגוריה' })).toBeTruthy()

    const unread = screen.getByRole('link', { name: 'לא נקראו' })
    expect(unread.tagName).toBe('A')
    expect(unread.getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'הכל' }).getAttribute('aria-current')).toBeNull()
  })

  it('each notification row is a single button, not an inaccessible icon control', () => {
    render(
      <NotificationCenter
        initialItems={[item]}
        initialCursor={null}
        filters={{ unreadOnly: false, category: null }}
      />,
    )
    const row = screen.getByRole('button', { name: /ליד חדש/ })
    expect(row.tagName).toBe('BUTTON')
    expect(screen.getByText('לא נקרא')).toBeTruthy()
  })

  it('mark-all-read is a named control, not an icon-only action', () => {
    render(
      <NotificationCenter
        initialItems={[item]}
        initialCursor={null}
        filters={{ unreadOnly: false, category: null }}
      />,
    )
    expect(screen.getByRole('button', { name: 'סימון הכל כנקרא' })).toBeTruthy()
  })
})
