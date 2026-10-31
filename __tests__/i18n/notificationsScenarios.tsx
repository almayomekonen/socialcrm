import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { expect, vi } from 'vitest'
import type { UiLocale } from '@/lib/i18n/config'
import type { NotificationFeedItem, NotificationFeedResponse } from '@/modules/notifications/types'
import { NOW, emitted, everyEmittedShape, legacyRows } from './notificationsEnv'
import { withLocale } from './notificationsHarness'
import { notifSpies } from './notificationsMocks'

/**
 * Interaction scenarios for the notification surfaces (Phase F3), replayed in
 * every language. Each one returns what the user saw (normalized HTML / text,
 * accessible names) AND what the code did (every fetch with its body, every
 * router push, every toast) — the Hebrew baseline snapshots the whole record,
 * the behaviour tests compare the `calls` part across languages. Elements are
 * found by structure, never by their (translated) text.
 */

export type Call = { url: string; method: string; body: unknown }
export type Record_ = { seen: Record<string, unknown>; calls: { fetch: Call[]; push: unknown[][]; toast: unknown[][] } }

const strip = (html: string) => html.replaceAll('<!-- -->', '')

let calls: Call[] = []
let queue: NotificationFeedResponse[] = []
let failNext: string | null = null

export function feed(over: Partial<NotificationFeedResponse> = {}): NotificationFeedResponse {
  return {
    enabled: true,
    unreadNotificationCount: 0,
    unreadConversationCount: 0,
    items: [],
    whileYouWereAway: null,
    presence: 'online',
    serverTime: new Date(NOW).toISOString(),
    nextCursor: null,
    ...over,
  }
}

/** `fetch` for the feed (one queued response per poll, the last repeats), `/read`, `/seen`. */
export function installFetch(responses: NotificationFeedResponse[] = []) {
  calls = []
  queue = responses
  failNext = null
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (failNext && url.startsWith(failNext)) {
        failNext = null
        return { ok: false, status: 500, json: async () => ({}) } as Response
      }
      if (url.startsWith('/api/notifications/feed')) {
        const next = queue.length > 1 ? queue.shift()! : (queue[0] ?? feed())
        return { ok: true, json: async () => next } as Response
      }
      return { ok: true, json: async () => ({ ok: true, updated: 1 }) } as Response
    }),
  )
}

/** The next request to a URL starting with `prefix` answers 500. */
export function failOnce(prefix: string) {
  failNext = prefix
}

function record(seen: Record<string, unknown>): Record_ {
  return {
    seen,
    calls: {
      // The poll's `visible=` reflects jsdom, not the user; it is kept as sent.
      fetch: calls.map((c) => ({ ...c })),
      push: notifSpies.push.mock.calls.map((c) => [...c]),
      toast: notifSpies.toast.mock.calls.map(([icon, msg, ms, onClick]) => [icon, msg, ms, typeof onClick]),
    },
  }
}

/** Flush effects and the mocked poll (one poll per mount, see notificationsMocks.pollModule). */
async function tick(_ms = 0) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

const panelEl = () => document.body.querySelector<HTMLElement>('div[aria-labelledby="notifPanelTitle"]')

/** Bell → panel → open a row; reopen → Escape; reopen → mark all. */
export async function bellScenario(locale: UiLocale | null): Promise<Record_> {
  const items = [...everyEmittedShape().slice(0, 6), ...legacyRows().slice(0, 1)]
  installFetch([feed({ unreadNotificationCount: 5, items })])
  const { NotificationProvider } = await import('@/modules/notifications/NotificationContext')
  const { default: NotificationBell } = await import('@/components/notifications/NotificationBell')
  const view = render(
    await withLocale(
      locale,
      <NotificationProvider enabled initialUnread={5}>
        <NotificationBell />
      </NotificationProvider>,
    ),
  )
  await tick()
  const bell = view.container.querySelector<HTMLButtonElement>('button[aria-expanded]')!
  const seen: Record<string, unknown> = { bellName: bell.getAttribute('aria-label'), bellTitle: bell.getAttribute('title') }

  fireEvent.click(bell)
  await tick(0)
  seen.panel = strip(panelEl()!.outerHTML)
  seen.focusInPanel = document.activeElement === panelEl()
  fireEvent.click(panelEl()!.querySelector('li button')!)
  await tick(0)
  seen.closedAfterOpen = panelEl() === null
  seen.focusOnBellAfterOpen = document.activeElement === bell

  fireEvent.click(bell)
  await tick(0)
  fireEvent.keyDown(panelEl()!, { key: 'Escape' })
  await tick(0)
  seen.closedOnEscape = panelEl() === null
  seen.focusOnBellAfterEscape = document.activeElement === bell

  fireEvent.click(bell)
  await tick(0)
  const markAll = panelEl()!.querySelector('h2')!.nextElementSibling as HTMLButtonElement
  seen.markAllText = markAll.textContent
  fireEvent.click(markAll)
  await tick(0)
  seen.bellNameAfterMarkAll = bell.getAttribute('aria-label')
  seen.panelAfterMarkAll = strip(panelEl()!.outerHTML)
  const out = record(seen)
  cleanup()
  return out
}

/** One new arrival toasts its own title; several toast one summary. */
export async function toastScenario(locale: UiLocale | null): Promise<Record_> {
  const later = new Date(NOW + 60_000).toISOString()
  const fresh = (id: number, over: Partial<NotificationFeedItem> = {}) =>
    ({ ...emitted('lead.created', { leadName: 'יוסי לוי' }), id, createdAt: later, toastEligible: true, ...over }) as NotificationFeedItem
  const { NotificationProvider } = await import('@/modules/notifications/NotificationContext')
  const seen: Record<string, unknown> = {}
  const runs: [string, NotificationFeedItem[]][] = [
    ['single', [fresh(1)]],
    ['singleLegacy', [fresh(2, { title: 'ליד חדש: יוסי לוי' })]],
    ['several', [fresh(3), fresh(4), fresh(5, { ...emitted('followup.due', { leadName: 'רונית' }), id: 5, createdAt: later, toastEligible: true })]],
  ]
  notifSpies.toast.mockClear()
  for (const [name, items] of runs) {
    installFetch([feed({ unreadNotificationCount: items.length, items })])
    render(await withLocale(locale, <NotificationProvider enabled>{null}</NotificationProvider>))
    await tick()
    const last = notifSpies.toast.mock.calls.at(-1)
    seen[name] = last?.[1]
    ;(last?.[3] as (() => void) | undefined)?.()
    cleanup()
  }
  calls = []
  return record(seen)
}

/** The center (desktop or phone rows): open a row, load more (failure then success), mark all. */
export async function centerScenario(locale: UiLocale | null, variant: 'desktop' | 'mobile' = 'desktop'): Promise<Record_> {
  const page2 = legacyRows()
  // The mount's poll, then the "load more" page.
  installFetch([feed({ unreadNotificationCount: 4 }), feed({ items: page2, nextCursor: null })])
  const { NotificationProvider } = await import('@/modules/notifications/NotificationContext')
  const { default: NotificationCenter } = await import('@/components/notifications/NotificationCenter')
  const items = everyEmittedShape().slice(0, 4)
  const view = render(
    await withLocale(
      locale,
      <NotificationProvider enabled initialUnread={4}>
        <NotificationCenter
          initialItems={items}
          initialCursor={{ createdAt: items[3].createdAt, id: items[3].id }}
          filters={{ unreadOnly: true, category: 'leads' }}
          variant={variant}
        />
      </NotificationProvider>,
    ),
  )
  await tick()
  const c = view.container
  const rows = () => [...c.querySelectorAll<HTMLButtonElement>('li button')]
  const loadMore = () => c.querySelector<HTMLButtonElement>('div.border-t > button')
  const seen: Record<string, unknown> = {}

  fireEvent.click(rows()[0])
  failOnce('/api/notifications/feed')
  fireEvent.click(loadMore()!)
  seen.loading = loadMore()!.textContent
  await waitFor(() => expect(loadMore()!.disabled).toBe(false))
  seen.failed = loadMore()!.textContent
  fireEvent.click(loadMore()!)
  await waitFor(() => expect(rows().length).toBe(items.length + page2.length))
  seen.afterLoad = strip(c.innerHTML)
  const markAll = c.querySelector<HTMLButtonElement>('div.justify-end > button')!
  seen.markAllText = markAll.textContent
  fireEvent.click(markAll)
  await waitFor(() => expect(calls.some((x) => x.url === '/api/notifications/read' && (x.body as { all?: boolean })?.all)).toBe(true))
  seen.afterMarkAll = strip(c.innerHTML)
  const out = record(seen)
  cleanup()
  return out
}

/** The phone list: long press selects, the bar, mark read (failure rolls back + toast, then success), cancel. */
export async function selectionScenario(locale: UiLocale | null): Promise<Record_> {
  installFetch([feed({ unreadNotificationCount: 3 })])
  const { NotificationProvider } = await import('@/modules/notifications/NotificationContext')
  const { default: NotificationCenter } = await import('@/components/notifications/NotificationCenter')
  const items = everyEmittedShape().slice(0, 3)
  const view = render(
    await withLocale(
      locale,
      <NotificationProvider enabled initialUnread={3}>
        <NotificationCenter initialItems={items} initialCursor={null} filters={{ unreadOnly: false, category: null }} variant='mobile' />
      </NotificationProvider>,
    ),
  )
  await tick()
  const rows = () => view.getAllByTestId('notification-row')
  const actions = () => [...document.body.querySelectorAll<HTMLButtonElement>('button.press.w-full.justify-center')]
  const seen: Record<string, unknown> = {}

  fireEvent.contextMenu(rows()[0])
  fireEvent.click(rows()[1])
  seen.bar = strip(view.getByTestId('notifications-selection-bar').outerHTML)
  seen.actions = actions().map((b) => strip(b.outerHTML))
  failOnce('/api/notifications/read')
  fireEvent.click(actions()[0])
  await waitFor(() => expect(notifSpies.toast).toHaveBeenCalled())
  seen.afterFailure = strip(view.container.innerHTML)
  fireEvent.click(actions()[0])
  await waitFor(() => expect(calls.filter((x) => x.url === '/api/notifications/read').length).toBe(3))
  seen.afterMarkRead = strip(view.container.innerHTML)
  fireEvent.contextMenu(rows()[2])
  fireEvent.click(actions().at(-1)!)
  seen.afterCancel = view.queryByTestId('notifications-selection-bar') === null
  const out = record(seen)
  cleanup()
  return out
}
