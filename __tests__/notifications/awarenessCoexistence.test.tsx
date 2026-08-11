// @vitest-environment jsdom
//
// MIGRATION GUARD: AwarenessProvider and NotificationProvider are both mounted
// during P2.2–P2.5, and neither may break the other.
//
// The failure this file exists to prevent is a DOUBLE TOAST. Both systems poll,
// both call the same single-slot toast(), and both know about inbound WhatsApp
// messages — so a careless rollout shows the user two alerts for one message, or
// silently replaces the working one. These tests mount the real pair together and
// assert the division of labour holds:
//
//   awareness  → conversation badge + WhatsApp toast   (unchanged)
//   feed       → notification unread + everything else (new)
//
// Deleting AWARENESS_OWNED_CATEGORIES without also retiring AwarenessProvider
// fails here, which is exactly the reminder P2.6 needs.
//
// Runs without a database: `npm run test:notifications`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { AwarenessProvider, useAwarenessCount } from '@/modules/inbox/awareness/AwarenessContext'
import { NotificationProvider, useNotifications } from '@/modules/notifications/NotificationContext'
import type { NotificationFeedItem, NotificationFeedResponse } from '@/modules/notifications/types'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  // Off-inbox, so the awareness poller is active — its toasting path.
  usePathname: () => '/leads',
}))

const toast = vi.fn()
vi.mock('@/lib/toast', () => ({
  get toast() {
    return toast
  },
  default: () => null,
}))

const NOW = new Date('2026-08-11T12:00:00.000Z')
const AFTER = '2026-08-11T12:00:30.000Z'

function notification(over: Partial<NotificationFeedItem> = {}): NotificationFeedItem {
  return {
    id: 1,
    type: 'message.inbound',
    category: 'messages',
    priority: 'medium',
    title: 'הודעה חדשה מדנה',
    body: null,
    entityType: 'conversation',
    entityId: 9,
    deepLink: '/inbox?conversation=9',
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

let feedResponse: NotificationFeedResponse = feed()
/** What /api/inbox/awareness returns: one new WhatsApp message from Dana. */
let awarenessResponse: {
  counts: { whatsappUnread: number }
  items: { conversationId: number; contactName: string; at: string }[]
  serverTime: string
} = { counts: { whatsappUnread: 0 }, items: [], serverTime: NOW.toISOString() }

function Probe() {
  const conversationBadge = useAwarenessCount()
  const { unreadCount } = useNotifications()
  return (
    <div>
      <span data-testid='conversations'>{String(conversationBadge)}</span>
      <span data-testid='notifications'>{unreadCount}</span>
    </div>
  )
}

function mount({ notificationsEnabled = true, deltaSyncEnabled = true } = {}) {
  return render(
    <AwarenessProvider enabled={deltaSyncEnabled} initialUnread={0}>
      <NotificationProvider enabled={notificationsEnabled}>
        <Probe />
      </NotificationProvider>
    </AwarenessProvider>,
  )
}

async function tick(ms = 700) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  toast.mockClear()
  push.mockClear()
  feedResponse = feed()
  awarenessResponse = { counts: { whatsappUnread: 0 }, items: [], serverTime: NOW.toISOString() }
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(NOW)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/notifications/feed')) return { ok: true, json: async () => feedResponse } as Response
      if (url.startsWith('/api/inbox/awareness')) return { ok: true, json: async () => awarenessResponse } as Response
      return { ok: true, json: async () => ({ ok: true }) } as Response
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('one inbound message produces exactly one toast', () => {
  it('awareness toasts it; the feed stays silent even though it has the same row', async () => {
    awarenessResponse = {
      counts: { whatsappUnread: 1 },
      items: [{ conversationId: 9, contactName: 'דנה', at: AFTER }],
      serverTime: AFTER,
    }
    feedResponse = feed({ unreadNotificationCount: 1, items: [notification()] })

    mount()
    await tick()

    expect(toast).toHaveBeenCalledTimes(1)
    // The awareness copy, not the notification title — proof of which system spoke.
    expect(toast.mock.calls[0][1]).toBe('הודעה חדשה מדנה')
  })

  it('still only one toast after several polls', async () => {
    awarenessResponse = {
      counts: { whatsappUnread: 1 },
      items: [{ conversationId: 9, contactName: 'דנה', at: AFTER }],
      serverTime: AFTER,
    }
    feedResponse = feed({ unreadNotificationCount: 1, items: [notification()] })

    mount()
    await tick()
    await tick(6000)
    await tick(6000)

    expect(toast).toHaveBeenCalledTimes(1)
  })

  it('the awareness toast still deep-links into the conversation', async () => {
    awarenessResponse = {
      counts: { whatsappUnread: 1 },
      items: [{ conversationId: 9, contactName: 'דנה', at: AFTER }],
      serverTime: AFTER,
    }
    mount()
    await tick()

    ;(toast.mock.calls[0][3] as () => void)()
    expect(push).toHaveBeenCalledWith('/inbox?conversation=9')
  })
})

describe('the two badges stay separate', () => {
  it('the conversation badge comes from awareness and the notification count from the feed', async () => {
    awarenessResponse = { counts: { whatsappUnread: 4 }, items: [], serverTime: AFTER }
    feedResponse = feed({ unreadNotificationCount: 2, unreadConversationCount: 99 })

    mount()
    await tick()

    // 4 from awareness — NOT the feed's 99, which nothing consumes yet.
    expect(screen.getByTestId('conversations').textContent).toBe('4')
    expect(screen.getByTestId('notifications').textContent).toBe('2')
  })

  it('turning notifications ON does not disturb the conversation badge', async () => {
    awarenessResponse = { counts: { whatsappUnread: 7 }, items: [], serverTime: AFTER }

    const off = mount({ notificationsEnabled: false })
    await tick()
    const withoutNotifications = screen.getByTestId('conversations').textContent
    off.unmount()

    mount({ notificationsEnabled: true })
    await tick()
    expect(screen.getByTestId('conversations').textContent).toBe(withoutNotifications)
    expect(screen.getByTestId('conversations').textContent).toBe('7')
  })

  it('notifications OFF leaves the awareness path completely untouched', async () => {
    awarenessResponse = {
      counts: { whatsappUnread: 1 },
      items: [{ conversationId: 9, contactName: 'דנה', at: AFTER }],
      serverTime: AFTER,
    }
    mount({ notificationsEnabled: false })
    await tick()

    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast.mock.calls[0][1]).toBe('הודעה חדשה מדנה')
    const urls = (fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => c[0])
    expect(urls.some((u) => u.startsWith('/api/notifications'))).toBe(false)
  })
})

describe('the feed still handles what awareness never did', () => {
  it('toasts a non-message notification while awareness handles messages', async () => {
    awarenessResponse = { counts: { whatsappUnread: 0 }, items: [], serverTime: AFTER }
    feedResponse = feed({
      unreadNotificationCount: 1,
      items: [
        notification({
          id: 5,
          type: 'lead.created',
          category: 'leads',
          title: 'ליד חדש: יוסי',
          deepLink: '/clients/12',
        }),
      ],
    })

    mount()
    await tick()

    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast.mock.calls[0][1]).toBe('ליד חדש: יוסי')
  })

  it('a message and a lead arriving together produce one toast each, from their own owner', async () => {
    awarenessResponse = {
      counts: { whatsappUnread: 1 },
      items: [{ conversationId: 9, contactName: 'דנה', at: AFTER }],
      serverTime: AFTER,
    }
    feedResponse = feed({
      unreadNotificationCount: 2,
      items: [notification({ id: 1 }), notification({ id: 2, category: 'leads', title: 'ליד חדש: יוסי' })],
    })

    mount()
    await tick()

    // Two toasts total: one WhatsApp (awareness), one lead (feed). The message row
    // in the feed is suppressed, so it never becomes a third.
    const messages = toast.mock.calls.map((c) => c[1])
    expect(messages).toHaveLength(2)
    expect(messages).toContain('הודעה חדשה מדנה')
    expect(messages).toContain('ליד חדש: יוסי')
  })
})
