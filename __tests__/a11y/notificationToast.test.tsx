// @vitest-environment jsdom
//
// Accessibility contract for notification toasts (spec §13.2, §23).
//
// NotificationContext renders no visible DOM of its own — its only user-visible
// output is a toast. So the a11y question is not "is the bell labelled" (there is
// no bell yet) but: does a notification reach assistive tech through the ONE
// existing status region, without moving focus?
//
// These tests use the REAL toast (lib/toast.tsx), not a mock, which is what makes
// them meaningful: they would fail if P2.2 had introduced a parallel toast
// implementation, because a second implementation could not announce into the
// existing region.
//
// Runs without a database: `npm run test:a11y`.

import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import ToastMsg from '@/lib/toast'
import { NotificationProvider } from '@/modules/notifications/NotificationContext'
import type { NotificationFeedResponse } from '@/modules/notifications/types'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/leads' }))

const NOW = new Date('2026-08-11T12:00:00.000Z')
const AFTER = '2026-08-11T12:00:30.000Z'

const feed: NotificationFeedResponse = {
  enabled: true,
  unreadNotificationCount: 1,
  unreadConversationCount: 0,
  items: [
    {
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
      createdAt: AFTER,
      seenAt: null,
      readAt: null,
      toastEligible: true,
    },
  ],
  whileYouWereAway: null,
  presence: 'online',
  serverTime: NOW.toISOString(),
  nextCursor: null,
}

beforeAll(() => {
  // JSDOM does not implement the Popover API; stub it so ToastMsg can call it.
  if (!HTMLElement.prototype.showPopover) HTMLElement.prototype.showPopover = function () {}
  if (!HTMLElement.prototype.hidePopover) HTMLElement.prototype.hidePopover = function () {}
})

beforeEach(() => {
  push.mockClear()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(NOW)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => feed }) as Response))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Mount the app-shell pair, then advance past the first poll and the announce delay. */
async function surfaceNotification(enabled = true) {
  render(
    <>
      <ToastMsg />
      <NotificationProvider enabled={enabled}>
        <div />
      </NotificationProvider>
    </>,
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(700)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100)
  })
}

test('a notification is announced in the existing polite status region', async () => {
  await surfaceNotification()

  const region = screen.getByRole('status')
  expect(region.getAttribute('aria-live')).toBe('polite')
  expect(region.textContent).toBe('ליד חדש: דנה כהן')
})

test('there is exactly ONE status region — no second toast implementation', async () => {
  await surfaceNotification()
  expect(screen.getAllByRole('status')).toHaveLength(1)
})

test('surfacing a notification never moves focus (WCAG 4.1.3)', async () => {
  const active = document.activeElement
  await surfaceNotification()
  expect(document.activeElement).toBe(active)
})

test('a clickable notification toast is a real button, reachable by keyboard', async () => {
  await surfaceNotification()

  // `hidden: true` because JSDOM has no Popover API: `showPopover` is stubbed, so
  // the popover never opens and role queries treat its contents as hidden. The
  // announcement (asserted above) is what reaches assistive tech either way.
  const button = screen.getByRole('button', { hidden: true })
  expect(button.getAttribute('type')).toBe('button')
  // Activated by keyboard as well as pointer, because it is a button and not a div.
  await act(async () => {
    button.click()
  })
  expect(push).toHaveBeenCalledWith('/clients/55')
})

test('the provider itself renders no DOM — it is state, not chrome', async () => {
  // Rendered alone, so anything in the container beyond the marker would be the
  // provider inventing UI. The poller is a null-rendering component by design.
  const { container } = render(
    <NotificationProvider enabled>
      <span data-testid='child' />
    </NotificationProvider>,
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(800)
  })

  expect(container.innerHTML).toBe('<span data-testid="child"></span>')
})

test('nothing is announced while the feature is off', async () => {
  await surfaceNotification(false)
  expect(screen.getByRole('status').textContent).toBe('')
  expect(screen.queryByRole('button', { hidden: true })).toBeNull()
})
