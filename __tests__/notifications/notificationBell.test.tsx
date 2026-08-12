// @vitest-environment jsdom
//
// Bell + dropdown behaviour, driven through the REAL NotificationContext and a
// mocked feed — so what these tests exercise is the shipped path:
//
//   /api/notifications/feed → NotificationContext → bell badge → panel → seen/read
//
// The bell owns no state of its own; every assertion here is really "does the
// surface read and write the one state owner correctly".
//
// Runs without a database: `npm run test:notifications`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NotificationProvider } from '@/modules/notifications/NotificationContext'
import NotificationBell from '@/components/notifications/NotificationBell'
import { DROPDOWN_ITEM_LIMIT } from '@/modules/notifications/dropdown'
import type { NotificationFeedItem, NotificationFeedResponse } from '@/modules/notifications/types'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/leads' }))

const toast = vi.fn()
vi.mock('@/lib/toast', () => ({
  get toast() {
    return toast
  },
  default: () => null,
}))

const NOW = new Date('2026-08-11T12:00:00.000Z')
const BEFORE = '2026-08-11T11:00:00.000Z'

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
    createdAt: BEFORE,
    seenAt: null,
    readAt: null,
    toastEligible: true,
    ...over,
  }
}

function feed(over: Partial<NotificationFeedResponse> = {}): NotificationFeedResponse {
  return {
    enabled: true,
    unreadNotificationCount: 0,
    unreadConversationCount: 0,
    items: [],
    whileYouWereAway: null,
    presence: 'online',
    serverTime: NOW.toISOString(),
    nextCursor: null,
    ...over,
  }
}

type Call = { url: string; method: string; body: unknown }
let calls: Call[] = []
let response: NotificationFeedResponse = feed()

async function tick(ms = 700) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** Mount the shipped pair and let the first poll land. */
async function mount(enabled = true) {
  const view = render(
    <NotificationProvider enabled={enabled}>
      <NotificationBell />
    </NotificationProvider>,
  )
  await tick()
  return view
}

const bell = () => screen.getByRole('button', { name: /התראות/ })
const panel = () => screen.queryByRole('heading', { name: 'התראות' })
const seenCalls = () => calls.filter((c) => c.url === '/api/notifications/seen')
const readCalls = () => calls.filter((c) => c.url === '/api/notifications/read')

async function openPanel() {
  await act(async () => {
    bell().click()
  })
}

beforeEach(() => {
  calls = []
  response = feed()
  push.mockClear()
  toast.mockClear()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(NOW)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : null,
      })
      if (url.startsWith('/api/notifications/feed')) return { ok: true, json: async () => response } as Response
      return { ok: true, json: async () => ({ ok: true, updated: 1 }) } as Response
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the badge counts notifications', () => {
  it('renders the bell with no badge when nothing is unread', async () => {
    response = feed({ unreadNotificationCount: 0 })
    await mount()

    expect(bell()).toBeTruthy()
    expect(bell().textContent).toBe('')
    expect(bell().getAttribute('aria-label')).toBe('התראות')
  })

  it('shows an exact count from 1 to 99', async () => {
    for (const n of [1, 7, 42, 99]) {
      response = feed({ unreadNotificationCount: n })
      await mount()
      expect(bell().textContent).toBe(String(n))
      cleanup()
    }
  })

  it('caps at 99+ above 99', async () => {
    response = feed({ unreadNotificationCount: 100 })
    await mount()
    expect(bell().textContent).toBe('99+')

    cleanup()
    response = feed({ unreadNotificationCount: 4321 })
    await mount()
    expect(bell().textContent).toBe('99+')
  })

  it('IGNORES the conversation count — that badge belongs to the nav', async () => {
    response = feed({ unreadNotificationCount: 2, unreadConversationCount: 57 })
    await mount()

    expect(bell().textContent).toBe('2')
    expect(document.body.textContent).not.toContain('57')
  })

  it('reflects the count the server reports on a later poll', async () => {
    response = feed({ unreadNotificationCount: 1 })
    await mount()
    expect(bell().textContent).toBe('1')

    response = feed({ unreadNotificationCount: 3 })
    await tick(6000)
    expect(bell().textContent).toBe('3')
  })
})

describe('opening and closing', () => {
  it('opens on click and closes on a second click', async () => {
    await mount()
    expect(panel()).toBeNull()
    expect(bell().getAttribute('aria-expanded')).toBe('false')

    await openPanel()
    expect(panel()).toBeTruthy()
    expect(bell().getAttribute('aria-expanded')).toBe('true')

    await openPanel()
    expect(panel()).toBeNull()
    expect(bell().getAttribute('aria-expanded')).toBe('false')
  })

  it('closes on Escape', async () => {
    await mount()
    await openPanel()
    expect(panel()).toBeTruthy()

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(panel()).toBeNull()
  })

  it('returns focus to the bell when Escape closes it from inside the panel', async () => {
    response = feed({ items: [item()] })
    await mount()
    await openPanel()

    const container = screen.getByLabelText('התראות', { selector: 'div' })
    await act(async () => {
      fireEvent.keyDown(container, { key: 'Escape' })
    })

    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(bell())
  })

  it('moves focus into the panel on open, since the panel is portaled', async () => {
    response = feed({ items: [item()] })
    await mount()
    await openPanel()

    // Without this the panel is outside the tab order and unreachable by keyboard.
    expect(document.activeElement).toBe(screen.getByLabelText('התראות', { selector: 'div' }))
  })
})

describe('recent notifications', () => {
  it('renders one row per database record, never grouped', async () => {
    response = feed({
      unreadNotificationCount: 3,
      items: [
        item({ id: 1, title: 'ליד חדש: דנה כהן' }),
        item({ id: 2, title: 'ליד חדש: יוסי לוי' }),
        item({ id: 3, title: 'ליד חם: מיכל' }),
      ],
    })
    await mount()
    await openPanel()

    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('ליד חדש: דנה כהן')).toBeTruthy()
    expect(screen.getByText('ליד חדש: יוסי לוי')).toBeTruthy()
    expect(screen.getByText('ליד חם: מיכל')).toBeTruthy()
  })

  it('renders the stored title and body, with no LLM anywhere near it', async () => {
    response = feed({ items: [item({ title: 'ליד חם: מיכל', body: 'שלוש פניות בשבוע' })] })
    await mount()
    await openPanel()

    expect(screen.getByText('ליד חם: מיכל')).toBeTruthy()
    expect(screen.getByText('שלוש פניות בשבוע')).toBeTruthy()
  })

  it('caps the list at the render limit', async () => {
    response = feed({
      unreadNotificationCount: 30,
      items: Array.from({ length: 30 }, (_, i) => item({ id: i + 1, title: `התראה ${i + 1}` })),
    })
    await mount()
    await openPanel()

    expect(screen.getAllByRole('listitem')).toHaveLength(DROPDOWN_ITEM_LIMIT)
    // The rest are still counted, they are simply not dumped into a dropdown.
    expect(bell().textContent).toBe('30')
  })

  it('marks unread rows as unread for assistive tech, not by weight alone', async () => {
    response = feed({ items: [item({ id: 1 }), item({ id: 2, readAt: BEFORE })] })
    await mount()
    await openPanel()

    expect(screen.getAllByText('לא נקרא')).toHaveLength(1)
  })

  it('shows the calm empty state when there is nothing to show', async () => {
    await mount()
    await openPanel()

    expect(screen.getByText('אין התראות חדשות')).toBeTruthy()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})

describe('While you were away', () => {
  it('renders the persisted summary when the server sent one', async () => {
    response = feed({
      unreadNotificationCount: 4,
      items: [item()],
      whileYouWereAway: {
        since: '2026-08-11T09:00:00.000Z',
        total: 4,
        categories: [
          { category: 'leads', count: 3 },
          { category: 'followups', count: 1 },
        ],
      },
    })
    await mount()
    await openPanel()

    const section = screen.getByLabelText('בזמן שלא היית')
    expect(section.textContent).toContain('4 התראות חדשות')
    expect(section.textContent).toContain('לידים 3')
    expect(section.textContent).toContain('מעקבים 1')
  })

  it('does NOT render when the server sent nothing', async () => {
    response = feed({ items: [item()] })
    await mount()
    await openPanel()
    expect(screen.queryByLabelText('בזמן שלא היית')).toBeNull()
  })

  it('does NOT render for an empty away window', async () => {
    response = feed({
      items: [item()],
      whileYouWereAway: { since: '2026-08-11T09:00:00.000Z', total: 0, categories: [] },
    })
    await mount()
    await openPanel()
    expect(screen.queryByLabelText('בזמן שלא היית')).toBeNull()
  })

  it('is a section inside the panel, never a modal or takeover', async () => {
    response = feed({
      items: [item()],
      whileYouWereAway: { since: '2026-08-11T09:00:00.000Z', total: 2, categories: [{ category: 'leads', count: 2 }] },
    })
    await mount()
    await openPanel()

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})

describe('seenAt: the dropdown is a surface, and only for what it renders', () => {
  it('stamps nothing until the panel is opened', async () => {
    response = feed({ unreadNotificationCount: 2, items: [item({ id: 1 }), item({ id: 2 })] })
    await mount()
    await tick(6000)

    // The feed returned these rows twice. Returning is not surfacing.
    expect(seenCalls()).toHaveLength(0)
  })

  it('stamps exactly the rendered rows when opened, not the whole page', async () => {
    response = feed({
      unreadNotificationCount: 30,
      items: Array.from({ length: 30 }, (_, i) => item({ id: i + 1 })),
    })
    await mount()
    await openPanel()

    expect(seenCalls()).toHaveLength(1)
    expect(seenCalls()[0].body).toEqual({ ids: [1, 2, 3, 4, 5, 6, 7, 8] })
  })

  it('does not re-stamp rows the database already reports as seen', async () => {
    response = feed({ items: [item({ id: 1, seenAt: BEFORE }), item({ id: 2 })] })
    await mount()
    await openPanel()

    expect(seenCalls()[0].body).toEqual({ ids: [2] })
  })

  it('does not re-post while the panel stays open across polls', async () => {
    response = feed({ unreadNotificationCount: 1, items: [item({ id: 1 })] })
    await mount()
    await openPanel()
    expect(seenCalls()).toHaveLength(1)

    await tick(6000)
    await tick(6000)
    expect(seenCalls()).toHaveLength(1)
  })

  it('stamps a row that arrives while the panel is open — it is on screen too', async () => {
    response = feed({ unreadNotificationCount: 1, items: [item({ id: 1 })] })
    await mount()
    await openPanel()
    expect(seenCalls()[0].body).toEqual({ ids: [1] })

    response = feed({ unreadNotificationCount: 2, items: [item({ id: 2 }), item({ id: 1 })] })
    await tick(6000)

    expect(seenCalls()).toHaveLength(2)
    expect(seenCalls()[1].body).toEqual({ ids: [2] })
  })

  it('opening the panel marks NOTHING read', async () => {
    // Seen is not read: the badge must survive a look.
    response = feed({ unreadNotificationCount: 5, items: [item({ id: 1 }), item({ id: 2 })] })
    await mount()
    await openPanel()

    expect(readCalls()).toHaveLength(0)
    expect(bell().textContent).toBe('5')
  })
})

describe('clicking a notification', () => {
  it('marks it read and navigates to the entity', async () => {
    response = feed({ unreadNotificationCount: 1, items: [item({ id: 77, deepLink: '/clients/55' })] })
    await mount()
    await openPanel()

    await act(async () => {
      screen.getByText('ליד חדש: דנה כהן').closest('button')!.click()
    })

    expect(readCalls()).toHaveLength(1)
    expect(readCalls()[0].body).toEqual({ ids: [77] })
    expect(push).toHaveBeenCalledWith('/clients/55')
  })

  it('never puts the notification id in the URL', async () => {
    response = feed({ items: [item({ id: 4242, entityId: 55, deepLink: '/clients/55' })] })
    await mount()
    await openPanel()

    await act(async () => {
      screen.getByText('ליד חדש: דנה כהן').closest('button')!.click()
    })

    expect(push).toHaveBeenCalledWith('/clients/55')
    expect(String(push.mock.calls[0][0])).not.toContain('4242')
    expect(String(push.mock.calls[0][0])).not.toContain('notification')
  })

  it('navigates to the stored deep link verbatim, adding no authorization bypass', async () => {
    // The destination enforces its own access at click time; the notification layer
    // neither pre-checks nor smuggles anything past it.
    response = feed({ items: [item({ id: 1, category: 'messages', deepLink: '/inbox?conversation=9' })] })
    await mount()
    await openPanel()

    await act(async () => {
      screen.getByText('ליד חדש: דנה כהן').closest('button')!.click()
    })

    expect(push).toHaveBeenCalledWith('/inbox?conversation=9')
    expect(push.mock.calls).toHaveLength(1)
  })

  it('closes the panel and returns focus to the bell', async () => {
    response = feed({ items: [item()] })
    await mount()
    await openPanel()

    await act(async () => {
      screen.getByText('ליד חדש: דנה כהן').closest('button')!.click()
    })

    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(bell())
  })
})

describe('mark all read', () => {
  it('is offered only when something is unread', async () => {
    response = feed({ unreadNotificationCount: 0, items: [item({ id: 1, readAt: BEFORE })] })
    await mount()
    await openPanel()
    expect(screen.queryByRole('button', { name: 'סימון הכל כנקרא' })).toBeNull()
  })

  it('clears the count through the context', async () => {
    response = feed({ unreadNotificationCount: 3, items: [item({ id: 1 })] })
    await mount()
    await openPanel()

    await act(async () => {
      screen.getByRole('button', { name: 'סימון הכל כנקרא' }).click()
    })

    expect(readCalls()[0].body).toEqual({ all: true })
    expect(bell().textContent).toBe('')
  })
})

describe('the feature flag', () => {
  it('renders no bell at all when notifications are off', async () => {
    response = feed({ unreadNotificationCount: 9, items: [item()] })
    await mount(false)

    expect(screen.queryByRole('button', { name: /התראות/ })).toBeNull()
    expect(calls).toHaveLength(0)
  })
})

describe('no second toast path', () => {
  it('rendering the panel does not toast anything', async () => {
    response = feed({ unreadNotificationCount: 2, items: [item({ id: 1 }), item({ id: 2 })] })
    await mount()
    await openPanel()

    // Backlog rows: the panel shows them, and showing is not interrupting.
    expect(toast).not.toHaveBeenCalled()
  })

  it('a toasted row is not toasted again just because the panel rendered it', async () => {
    const fresh = item({ id: 1, createdAt: '2026-08-11T12:00:30.000Z' })
    response = feed({ unreadNotificationCount: 1, items: [fresh] })
    await mount()
    expect(toast).toHaveBeenCalledTimes(1)

    await openPanel()
    await tick(6000)
    expect(toast).toHaveBeenCalledTimes(1)
  })
})
