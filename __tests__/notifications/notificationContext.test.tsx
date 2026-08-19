// @vitest-environment jsdom
//
// NotificationContext — feed consumption, toast surfacing, seenAt stamping.
//
// The whole P2.2 flow, exercised end to end with a mocked feed:
//
//   /api/notifications/feed → NotificationContext → toast() → /api/notifications/seen
//
// The DATABASE is authoritative here too: the mocked feed is what the server says,
// and the tests assert the client obeys it (a row the server reports as seen is
// never toasted, no matter what session memory holds).
//
// Runs without a database: `npm run test:notifications`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { NotificationProvider, useNotifications } from '@/modules/notifications/NotificationContext'
import type { NotificationFeedItem, NotificationFeedResponse } from '@/modules/notifications/types'

const push = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))

const toast = vi.fn()
vi.mock('@/lib/toast', () => ({
  get toast() {
    return toast
  },
  default: () => null,
}))

/** Mount time is read at render; keep every fixture relative to this instant. */
const NOW = new Date('2026-08-11T12:00:00.000Z')
const AFTER = '2026-08-11T12:00:30.000Z'
const LATER = '2026-08-11T12:01:00.000Z'
const BEFORE = '2026-08-11T11:59:00.000Z'

function item(over: Partial<NotificationFeedItem> = {}): NotificationFeedItem {
  return {
    id: 1,
    type: 'lead.created',
    category: 'leads',
    priority: 'medium',
    title: 'ליד חדש: דנה',
    body: null,
    entityType: 'lead',
    entityId: 55,
    deepLink: '/clients/55',
    groupCount: 1,
    createdAt: AFTER,
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
/** Feed responses, consumed one per poll; the last one repeats. */
let queue: NotificationFeedResponse[] = []

function installFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (url.startsWith('/api/notifications/feed')) {
        const next = queue.length > 1 ? queue.shift()! : (queue[0] ?? feed())
        return { ok: true, json: async () => next } as Response
      }
      return { ok: true, json: async () => ({ ok: true, updated: 1 }) } as Response
    }),
  )
}

/** Advance past one poll and flush its promise chain. */
async function tick(ms = 700) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function Probe() {
  const { enabled, unreadCount, items, presence, markRead, markAllRead, markSeen } = useNotifications()
  return (
    <div>
      <span data-testid='enabled'>{String(enabled)}</span>
      <span data-testid='unread'>{unreadCount}</span>
      <span data-testid='ids'>{items.map((i) => `${i.id}${i.readAt ? 'r' : ''}`).join(',')}</span>
      <span data-testid='presence'>{presence}</span>
      <button onClick={() => markRead([1])}>read one</button>
      <button onClick={() => markRead([99])}>read missing</button>
      <button onClick={() => markAllRead()}>read all</button>
      <button onClick={() => markSeen([1])}>seen one</button>
    </div>
  )
}

const mount = (enabled = true, initialUnread = 0) =>
  render(
    <NotificationProvider enabled={enabled} initialUnread={initialUnread}>
      <Probe />
    </NotificationProvider>,
  )

const feedCalls = () => calls.filter((c) => c.url.startsWith('/api/notifications/feed'))
const seenCalls = () => calls.filter((c) => c.url === '/api/notifications/seen')
const readCalls = () => calls.filter((c) => c.url === '/api/notifications/read')

beforeEach(() => {
  calls = []
  queue = []
  toast.mockClear()
  push.mockClear()
  refresh.mockClear()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(NOW)
  installFetch()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('feed consumption', () => {
  it('polls the feed and exposes its counts and items', async () => {
    queue = [feed({ unreadNotificationCount: 3, items: [item({ id: 1 }), item({ id: 2 })] })]
    mount()
    await tick()

    expect(feedCalls().length).toBeGreaterThanOrEqual(1)
    expect(screen.getByTestId('unread').textContent).toBe('3')
    expect(screen.getByTestId('ids').textContent).toBe('1,2')
    expect(screen.getByTestId('presence').textContent).toBe('online')
  })

  it('reports tab visibility so the server can classify presence honestly', async () => {
    queue = [feed()]
    mount()
    await tick()
    expect(feedCalls()[0].url).toContain('visible=1')
  })

  it('requests the feed uncached', async () => {
    queue = [feed()]
    mount()
    await tick()
    const call = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]
    expect(call[1].cache).toBe('no-store')
  })
})

describe('new notification detection and toasting', () => {
  it('toasts a genuinely new notification exactly once', async () => {
    queue = [feed({ unreadNotificationCount: 1, items: [item({ id: 10 })] })]
    mount()
    await tick()

    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast.mock.calls[0][1]).toBe('ליד חדש: דנה')
  })

  it('does NOT re-toast the same row when later polls return it again', async () => {
    // The exact regression this milestone must not ship: the feed returns the same
    // page every few seconds, so a naive implementation toasts forever.
    const same = feed({ unreadNotificationCount: 1, items: [item({ id: 10 })] })
    queue = [same]
    mount()
    await tick()
    await tick(6000)
    await tick(6000)

    expect(feedCalls().length).toBeGreaterThanOrEqual(3)
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it('does not toast unread BACKLOG that predates the session', async () => {
    queue = [feed({ unreadNotificationCount: 2, items: [item({ id: 1, createdAt: BEFORE })] })]
    mount()
    await tick()

    expect(toast).not.toHaveBeenCalled()
    expect(screen.getByTestId('unread').textContent).toBe('2')
  })

  it('does not toast a row the DATABASE already reports as seen', async () => {
    queue = [feed({ items: [item({ id: 1, seenAt: AFTER })] })]
    mount()
    await tick()
    expect(toast).not.toHaveBeenCalled()
  })

  it('respects the server toast-eligibility decision', async () => {
    queue = [feed({ items: [item({ id: 1, toastEligible: false })] })]
    mount()
    await tick()
    expect(toast).not.toHaveBeenCalled()
  })

  it('shows ONE summary toast when several arrive together, never N toasts', async () => {
    queue = [
      feed({
        unreadNotificationCount: 3,
        items: [item({ id: 1 }), item({ id: 2, createdAt: LATER }), item({ id: 3, createdAt: LATER })],
      }),
    ]
    mount()
    await tick()

    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast.mock.calls[0][1]).toContain('3')
  })

  it('a single toast deep-links to the ENTITY, never to a notification id', async () => {
    queue = [feed({ items: [item({ id: 77, deepLink: '/clients/55' })] })]
    mount()
    await tick()

    const onClick = toast.mock.calls[0][3] as () => void
    onClick()
    expect(push).toHaveBeenCalledWith('/clients/55')
    expect(push.mock.calls[0][0]).not.toContain('77')
  })

  it('stays silent on the messages category while AwarenessContext still owns it', async () => {
    queue = [feed({ unreadNotificationCount: 1, items: [item({ id: 5, category: 'messages' })] })]
    mount()
    await tick()

    expect(toast).not.toHaveBeenCalled()
    // Still counted — suppression is about the toast, not about the record.
    expect(screen.getByTestId('unread').textContent).toBe('1')
  })

  it('toasts a row arriving on a LATER poll, not just the first one', async () => {
    queue = [feed(), feed({ unreadNotificationCount: 1, items: [item({ id: 42, createdAt: LATER })] })]
    mount()
    await tick()
    expect(toast).not.toHaveBeenCalled()

    await tick(6000)
    expect(toast).toHaveBeenCalledTimes(1)
  })
})

describe('the backlog boundary is measured in SERVER time', () => {
  it('a browser clock running ten minutes SLOW does not toast the backlog', async () => {
    // Without skew correction this is a flood: every row created in the last ten
    // minutes looks newer than the browser's idea of "now at mount".
    const clientClock = new Date(NOW.getTime() - 10 * 60_000)
    vi.setSystemTime(clientClock)
    queue = [
      feed({
        unreadNotificationCount: 2,
        serverTime: NOW.toISOString(),
        items: [
          item({ id: 1, createdAt: new Date(NOW.getTime() - 5 * 60_000).toISOString() }),
          item({ id: 2, createdAt: new Date(NOW.getTime() - 60_000).toISOString() }),
        ],
      }),
    ]
    mount()
    await tick()

    expect(toast).not.toHaveBeenCalled()
    expect(screen.getByTestId('unread').textContent).toBe('2')
  })

  it('a slow browser clock still toasts a genuinely new arrival', async () => {
    const clientClock = new Date(NOW.getTime() - 10 * 60_000)
    vi.setSystemTime(clientClock)
    queue = [
      feed({ serverTime: NOW.toISOString() }),
      feed({
        unreadNotificationCount: 1,
        serverTime: LATER,
        items: [item({ id: 3, createdAt: LATER, title: 'ליד חדש: יוסי' })],
      }),
    ]
    mount()
    await tick()
    await tick(6000)

    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast.mock.calls[0][1]).toBe('ליד חדש: יוסי')
  })

  it('a browser clock running FAST does not silently suppress new arrivals', async () => {
    const clientClock = new Date(NOW.getTime() + 10 * 60_000)
    vi.setSystemTime(clientClock)
    queue = [feed({ serverTime: NOW.toISOString(), items: [item({ id: 4, createdAt: AFTER })] })]
    mount()
    await tick()

    expect(toast).toHaveBeenCalledTimes(1)
  })
})

describe('seenAt stamping', () => {
  it('does NOT stamp seenAt merely because the feed returned rows', async () => {
    // "feed returned a row" != "the user saw it" (spec §8.2). A backlog row is
    // returned on every poll and must stay unseen until a surface shows it.
    queue = [feed({ unreadNotificationCount: 2, items: [item({ id: 1, createdAt: BEFORE })] })]
    mount()
    await tick()
    await tick(6000)

    expect(seenCalls()).toHaveLength(0)
  })

  it('stamps seenAt for exactly the rows it toasted', async () => {
    queue = [
      feed({
        items: [item({ id: 1 }), item({ id: 2, createdAt: BEFORE }), item({ id: 3, category: 'messages' })],
      }),
    ]
    mount()
    await tick()

    expect(seenCalls()).toHaveLength(1)
    // Only the surfaced row: not the backlog row, not the suppressed one.
    expect(seenCalls()[0].body).toEqual({ ids: [1] })
  })

  it('stamps every row covered by a summary toast', async () => {
    queue = [feed({ items: [item({ id: 1 }), item({ id: 2, createdAt: LATER })] })]
    mount()
    await tick()
    expect(seenCalls()[0].body).toEqual({ ids: [1, 2] })
  })

  it('exposes markSeen for a surface to call, and posts only ids', async () => {
    queue = [feed()]
    mount()
    await tick()
    await act(async () => {
      screen.getByText('seen one').click()
    })

    expect(seenCalls()).toHaveLength(1)
    expect(seenCalls()[0].method).toBe('POST')
    expect(seenCalls()[0].body).toEqual({ ids: [1] })
  })

  it('never sends a userId or agencyId — scope comes from the session', async () => {
    queue = [feed({ items: [item({ id: 1 })] })]
    mount()
    await tick()
    for (const call of [...seenCalls(), ...readCalls()]) {
      expect(Object.keys(call.body as object)).not.toContain('userId')
      expect(Object.keys(call.body as object)).not.toContain('agencyId')
    }
  })
})

describe('read state', () => {
  it('marks read optimistically and posts ids', async () => {
    queue = [feed({ unreadNotificationCount: 1, items: [item({ id: 1 })] })]
    mount()
    await tick()
    await act(async () => {
      screen.getByText('read one').click()
    })

    expect(screen.getByTestId('unread').textContent).toBe('0')
    expect(screen.getByTestId('ids').textContent).toBe('1r')
    expect(readCalls()[0].body).toEqual({ ids: [1] })
  })

  it('seeds unreadCount from initialUnread before the first poll', () => {
    mount(true, 4)
    expect(screen.getByTestId('unread').textContent).toBe('4')
  })

  it('decrements the badge when the center marks an id the feed has not loaded', async () => {
    queue = [feed({ unreadNotificationCount: 5, items: [] })]
    mount()
    await tick()
    await act(async () => {
      screen.getByText('read missing').click()
    })
    expect(screen.getByTestId('unread').textContent).toBe('4')
    expect(readCalls()[0].body).toEqual({ ids: [99] })
  })

  it('refreshes the mobile workspace after a successful read so RSC list state is not stale', async () => {
    const shell = document.createElement('div')
    shell.setAttribute('data-mobile-workspace', '')
    document.body.appendChild(shell)
    queue = [feed({ unreadNotificationCount: 1, items: [item({ id: 1 })] })]
    mount()
    await tick()
    await act(async () => {
      screen.getByText('read one').click()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(refresh).toHaveBeenCalled()
    shell.remove()
  })

  it('does not refresh desktop after read — the bell already follows context', async () => {
    queue = [feed({ unreadNotificationCount: 1, items: [item({ id: 1 })] })]
    mount()
    await tick()
    await act(async () => {
      screen.getByText('read one').click()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('mark-all-read clears the count and posts all:true, with no id list', async () => {
    queue = [feed({ unreadNotificationCount: 4, items: [item({ id: 1 }), item({ id: 2 })] })]
    mount()
    await tick()
    await act(async () => {
      screen.getByText('read all').click()
    })

    expect(screen.getByTestId('unread').textContent).toBe('0')
    expect(readCalls()[0].body).toEqual({ all: true })
  })

  it('readAt does not imply seenAt — marking read posts no seen stamp', async () => {
    queue = [feed({ unreadNotificationCount: 1, items: [item({ id: 1, createdAt: BEFORE })] })]
    mount()
    await tick()
    await act(async () => {
      screen.getByText('read one').click()
    })

    expect(readCalls()).toHaveLength(1)
    expect(seenCalls()).toHaveLength(0)
  })

  it('lets the server correct an optimistic count on the next poll', async () => {
    // The database is authoritative: if another tab or the worker disagrees, the
    // next feed response wins.
    queue = [
      feed({ unreadNotificationCount: 1, items: [item({ id: 1 })] }),
      feed({ unreadNotificationCount: 9, items: [item({ id: 1 })] }),
    ]
    mount()
    await tick()
    await act(async () => {
      screen.getByText('read one').click()
    })
    expect(screen.getByTestId('unread').textContent).toBe('0')

    await tick(6000)
    expect(screen.getByTestId('unread').textContent).toBe('9')
  })
})

describe('count separation — the nav badge is not ours', () => {
  it('exposes the NOTIFICATION count and ignores the conversation count entirely', async () => {
    queue = [feed({ unreadNotificationCount: 2, unreadConversationCount: 42 })]
    mount()
    await tick()

    expect(screen.getByTestId('unread').textContent).toBe('2')
    // 42 must appear nowhere: the nav conversation badge keeps its own source.
    expect(document.body.textContent).not.toContain('42')
  })

  it('has no conversation count on the context value at all', async () => {
    queue = [feed({ unreadConversationCount: 42 })]
    let seenKeys: string[] = []
    function KeyProbe() {
      seenKeys = Object.keys(useNotifications())
      return null
    }
    render(
      <NotificationProvider enabled>
        <KeyProbe />
      </NotificationProvider>,
    )
    await tick()

    expect(seenKeys).not.toContain('unreadConversationCount')
    expect(seenKeys).toContain('unreadCount')
  })
})

describe('feature flag OFF', () => {
  it('never polls, never toasts, and reports itself disabled', async () => {
    queue = [feed({ unreadNotificationCount: 5, items: [item({ id: 1 })] })]
    mount(false)
    await tick()
    await tick(6000)

    expect(calls).toHaveLength(0)
    expect(toast).not.toHaveBeenCalled()
    expect(screen.getByTestId('enabled').textContent).toBe('false')
    expect(screen.getByTestId('unread').textContent).toBe('0')
  })

  it('ignores markRead / markSeen calls while disabled', async () => {
    mount(false)
    await act(async () => {
      screen.getByText('read one').click()
      screen.getByText('seen one').click()
      screen.getByText('read all').click()
    })
    expect(calls).toHaveLength(0)
  })
})

describe('resilience', () => {
  it('a failed feed request neither toasts nor throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mount()
    await tick()

    expect(toast).not.toHaveBeenCalled()
    expect(screen.getByTestId('unread').textContent).toBe('0')
    warn.mockRestore()
  })

  it('a failed seen stamp does not break the session', async () => {
    queue = [feed({ items: [item({ id: 1 })] })]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/api/notifications/feed')) return { ok: true, json: async () => queue[0] } as Response
        throw new Error('network down')
      }),
    )
    mount()
    await tick()

    expect(toast).toHaveBeenCalledTimes(1)
    // And still no repeat toast, because the session guard does not depend on the
    // stamp having succeeded.
    await tick(6000)
    expect(toast).toHaveBeenCalledTimes(1)
  })
})
