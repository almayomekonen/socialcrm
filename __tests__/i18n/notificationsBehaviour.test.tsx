// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { NOW, everyEmittedShape, resetNotifEnv } from './notificationsEnv'
import { resetNotifSpies } from './notificationsMocks'
import { withLocale } from './notificationsHarness'
import { bellScenario, centerScenario, selectionScenario, toastScenario, type Record_ } from './notificationsScenarios'

/**
 * Behaviour is the same in every language (Phase F3): the recorded Hebrew
 * scenarios (notificationsHebrewBaselineInteractions) replayed in en / ar make
 * the SAME requests with the same bodies, the same navigations and the same
 * toasts (kind, duration, click target) — only the words differ. Plus the
 * translated accessible names, Escape / focus return on the panel, and the
 * phone rows' touch targets unchanged.
 */

vi.mock('next/navigation', async () => (await import('./notificationsMocks')).navigationModule())
vi.mock('@/lib/toast', async () => (await import('./notificationsMocks')).toastModule())
vi.mock('@/modules/inbox/client/useAdaptivePoll', async () => (await import('./notificationsMocks')).pollModule())

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetNotifEnv()
  resetNotifSpies()
})

/** What the code did, without the words: requests, navigations, toast kind / duration / click. */
const actions = (r: Record_) => ({ fetch: r.calls.fetch, push: r.calls.push, toast: r.calls.toast.map(([i, , ms, f]) => [i, ms, f]) })
const flags = (r: Record_) => Object.fromEntries(Object.entries(r.seen).filter(([, v]) => typeof v === 'boolean'))

async function replay(run: (l: 'en' | 'ar' | null) => Promise<Record_>) {
  const out: Record<string, Record_> = {}
  for (const l of [null, 'en', 'ar'] as const) {
    out[l ?? 'he'] = await run(l)
    resetNotifSpies()
  }
  return out
}

describe('same actions in every language', () => {
  test('bell: open a row, Escape, mark all — and translated names', async () => {
    const r = await replay(bellScenario)
    for (const l of ['en', 'ar'] as const) {
      expect(actions(r[l]), l).toEqual(actions(r.he))
      expect(flags(r[l]), l).toEqual(flags(r.he))
    }
    expect(flags(r.he)).toEqual({ closedAfterOpen: true, closedOnEscape: true, focusInPanel: true, focusOnBellAfterEscape: true, focusOnBellAfterOpen: true })
    expect([r.en.seen.bellName, r.en.seen.bellTitle, r.en.seen.markAllText, r.en.seen.bellNameAfterMarkAll]).toEqual([
      'Notifications, 5 new',
      'Notifications',
      'Mark all as read',
      'Notifications',
    ])
    expect(r.ar.seen.bellName).toBe('الإشعارات، 5 إشعارات جديدة')
    expect(r.en.seen.panel).toContain('lang="en" dir="ltr"')
    expect(r.he.seen.panel).not.toContain('lang=')
  })

  test('arrival toasts: same targets, worded rows, the summary counted', async () => {
    const r = await replay(toastScenario)
    for (const l of ['en', 'ar'] as const) expect(actions(r[l]), l).toEqual(actions(r.he))
    expect(r.en.seen).toEqual({ single: 'New lead — יוסי לוי', singleLegacy: 'ליד חדש: יוסי לוי', several: '3 new notifications' })
    expect(r.ar.seen.several).toBe('3 إشعارات جديدة')
  })

  test('center (desktop and phone rows): open, load more failing then succeeding, mark all', async () => {
    for (const variant of ['desktop', 'mobile'] as const) {
      const r = await replay((l) => centerScenario(l, variant))
      for (const l of ['en', 'ar'] as const) expect(actions(r[l]), `${variant} ${l}`).toEqual(actions(r.he))
      expect([r.en.seen.loading, r.en.seen.failed, r.en.seen.markAllText]).toEqual(['Loading…', "Couldn't load — try again", 'Mark all as read'])
    }
  })

  test('phone selection: same ids marked read, rollback toast translated', async () => {
    const r = await replay(selectionScenario)
    for (const l of ['en', 'ar'] as const) {
      expect(r[l].calls.fetch, l).toEqual(r.he.calls.fetch)
      expect(r[l].calls.push, l).toEqual(r.he.calls.push)
      expect(r[l].seen.afterCancel).toBe(true)
    }
    expect(r.en.calls.toast).toEqual([['error', "We couldn't mark them as read. Try again.", undefined, 'undefined']])
    expect(String(r.en.seen.actions)).toContain('Mark as read')
  })
})

describe('phone rows: names and touch targets', () => {
  test('the unread word is translated; row / segment classes are identical in every language', async () => {
    const { default: NotificationCenter } = await import('@/components/notifications/NotificationCenter')
    const classes = async (l: 'en' | 'ar' | null) => {
      const view = render(
        await withLocale(l, <NotificationCenter initialItems={everyEmittedShape().slice(0, 4)} initialCursor={null} filters={{ unreadOnly: false, category: null }} variant='mobile' />),
      )
      const out = {
        rows: view.getAllByTestId('notification-row').map((b) => b.className),
        unread: [...view.container.querySelectorAll('.sr-only')].map((s) => s.textContent),
      }
      cleanup()
      return out
    }
    const he = await classes(null)
    const en = await classes('en')
    expect(en.rows).toEqual(he.rows)
    expect((await classes('ar')).rows).toEqual(he.rows)
    expect(he.rows.every((c) => c.includes('min-h-11'))).toBe(true)
    expect(new Set(en.unread)).toEqual(new Set(['Unread']))
  })
})
