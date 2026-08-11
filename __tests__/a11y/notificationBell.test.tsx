// @vitest-environment jsdom
//
// Accessibility contract for the notification bell and its dropdown (spec §23).
//
// The bell is an ICON-ONLY control with a numeric badge, which is the exact shape
// that usually ships inaccessible: an unlabelled button, or a count that only
// exists as pixels. And the panel is portaled to document.body, which breaks the
// tab order unless focus is moved deliberately.
//
// The badge is checked for the opposite failure too: a count that polls every few
// seconds must NOT be wired to a live region, or the screen reader recites it
// forever. It belongs in the control's name, available on demand.
//
// Runs without a database: `npm run test:a11y`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NotificationProvider } from '@/modules/notifications/NotificationContext'
import NotificationBell from '@/components/notifications/NotificationBell'
import type { NotificationFeedItem, NotificationFeedResponse } from '@/modules/notifications/types'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/leads' }))
vi.mock('@/lib/toast', () => ({ get toast() { return () => {} }, default: () => null }))

const NOW = new Date('2026-08-11T12:00:00.000Z')

function item(over: Partial<NotificationFeedItem> = {}): NotificationFeedItem {
  return {
    id: 1,
    type: 'lead.created',
    category: 'leads',
    priority: 'medium',
    title: 'ליד חדש: דנה כהן',
    body: null,
    entityType: 'lead',
    entityId: 55,
    deepLink: '/clients/55',
    groupCount: 1,
    createdAt: '2026-08-11T11:00:00.000Z',
    seenAt: null,
    readAt: null,
    toastEligible: true,
    ...over,
  }
}

let response: NotificationFeedResponse

beforeEach(() => {
  push.mockClear()
  response = {
    enabled: true,
    unreadNotificationCount: 3,
    unreadConversationCount: 0,
    items: [item({ id: 1 }), item({ id: 2, title: 'ליד חם: מיכל' }), item({ id: 3, title: 'ליד חדש: יוסי' })],
    whileYouWereAway: null,
    presence: 'online',
    serverTime: NOW.toISOString(),
    nextCursor: null,
  }
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(NOW)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => response }) as Response))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function mount() {
  render(
    <NotificationProvider enabled>
      <NotificationBell />
    </NotificationProvider>,
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(700)
  })
}

const bell = () => screen.getByRole('button', { name: /התראות/ })

describe('the bell', () => {
  it('has an explicit accessible name even though it is icon-only', async () => {
    await mount()
    expect(bell().getAttribute('aria-label')).toBe('התראות, 3 חדשות')
  })

  it('states the unread count in its name, so the badge is not the only carrier', async () => {
    response = { ...response, unreadNotificationCount: 12 }
    await mount()
    expect(bell().getAttribute('aria-label')).toContain('12')
  })

  it('does not double-announce: the badge itself is hidden from the tree', async () => {
    await mount()
    // The number is in the name; exposing the badge as well says it twice.
    const badge = bell().querySelector('span[aria-hidden]')
    expect(badge).toBeTruthy()
    expect(badge!.textContent).toBe('3')
  })

  it('never wires the polling count to a live region', async () => {
    await mount()
    // A count that refreshes every few seconds would recite itself forever.
    expect(bell().querySelector('[aria-live]')).toBeNull()
    expect(bell().closest('[aria-live]')).toBeNull()
  })

  it('exposes its expanded state', async () => {
    await mount()
    expect(bell().getAttribute('aria-expanded')).toBe('false')
    await act(async () => bell().click())
    expect(bell().getAttribute('aria-expanded')).toBe('true')
  })

  it('is a real button, so Enter and Space activate it natively', async () => {
    await mount()
    expect(bell().tagName).toBe('BUTTON')
    expect(bell().getAttribute('type')).toBe('button')
  })

  it('carries a visible focus ring rather than suppressing the outline', async () => {
    await mount()
    expect(bell().className).toContain('focus:ring-2')
  })
})

describe('the panel', () => {
  it('has an accessible name from its own heading', async () => {
    await mount()
    await act(async () => bell().click())

    const heading = screen.getByRole('heading', { name: 'התראות' })
    const container = screen.getByLabelText('התראות', { selector: 'div' })
    expect(container.getAttribute('aria-labelledby')).toBe(heading.id)
  })

  it('receives focus on open, because it is portaled outside the tab order', async () => {
    await mount()
    await act(async () => bell().click())
    expect(document.activeElement).toBe(screen.getByLabelText('התראות', { selector: 'div' }))
  })

  it('returns focus to the bell on Escape', async () => {
    await mount()
    await act(async () => bell().click())
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText('התראות', { selector: 'div' }), { key: 'Escape' })
    })
    expect(document.activeElement).toBe(bell())
  })

  it('is not announced as a dialog, because it traps nothing and blocks nothing', async () => {
    await mount()
    await act(async () => bell().click())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('marks up rows as a list of buttons, each reachable by keyboard', async () => {
    await mount()
    await act(async () => bell().click())

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      const button = row.querySelector('button')
      expect(button).toBeTruthy()
      expect(button!.getAttribute('type')).toBe('button')
      expect(button!.className).toContain('focus:')
    }
  })

  it('gives every row a non-empty accessible name from the stored copy', async () => {
    await mount()
    await act(async () => bell().click())

    for (const button of screen.getAllByRole('listitem').map((r) => r.querySelector('button')!)) {
      expect(button.textContent?.trim().length).toBeGreaterThan(0)
    }
  })

  it('announces unread state in words, not by font weight alone', async () => {
    response = { ...response, items: [item({ id: 1 }), item({ id: 2, readAt: NOW.toISOString() })] }
    await mount()
    await act(async () => bell().click())

    expect(screen.getAllByText('לא נקרא')).toHaveLength(1)
  })

  it('names the While-you-were-away section', async () => {
    response = {
      ...response,
      whileYouWereAway: { since: '2026-08-11T09:00:00.000Z', total: 2, categories: [{ category: 'leads', count: 2 }] },
    }
    await mount()
    await act(async () => bell().click())

    expect(screen.getByLabelText('בזמן שלא היית')).toBeTruthy()
  })

  it('has no icon-only control without a name', async () => {
    await mount()
    await act(async () => bell().click())

    for (const button of screen.getAllByRole('button')) {
      const name = button.getAttribute('aria-label') ?? button.textContent?.trim() ?? ''
      expect(name.length).toBeGreaterThan(0)
    }
  })

  it('uses no emoji in any rendered text', async () => {
    await mount()
    await act(async () => bell().click())
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
    expect(emoji.test(document.body.textContent ?? '')).toBe(false)
  })
})
