// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import type { ReactNode } from 'react'
import { NOW, everyEmittedShape, fullPage, legacyRows, notifEnv, resetNotifEnv } from './notificationsEnv'
import { AWAY, pageTitle, pageTree, panelTree } from './notificationsHarness'

/**
 * HEBREW BASELINE for the notifications (i18n Phase F3): the REAL
 * `/notifications` page on desktop and on a phone (every row shape an emitter
 * writes, legacy rows, read / unread, a full page with "load more", empty,
 * filtered-empty by read state and by category, each phone segment), its tab
 * title, and the bell's panel (populated with and without "while you were
 * away", one away arrival, empty, nothing unread). Recorded against the code
 * BEFORE Phase F3; every Hebrew render must match byte-for-byte afterwards.
 * Interactions (bell, toasts, mark read, selection, load more):
 * notificationsHebrewBaselineInteractions.test.tsx.
 *
 * Rendered with NO i18n provider — exactly what a Hebrew user receives today.
 * Normalized before comparing, and only this: React's invisible `<!-- -->`
 * text separators.
 */

vi.mock('next/navigation', async () => (await import('./notificationsMocks')).navigationModule())
vi.mock('@/lib/toast', async () => (await import('./notificationsMocks')).toastModule())
vi.mock('@/db/auth', async () => (await import('./notificationsMocks')).authModule())
vi.mock('@/db/uiLocale', async () => (await import('./notificationsMocks')).uiLocaleModule())
vi.mock('@/lib/device', async () => (await import('./notificationsMocks')).deviceModule())
vi.mock('@/lib/notifications/flags', async () => (await import('./notificationsMocks')).flagsModule())
vi.mock('@/db/notifications/presence', async () => (await import('./notificationsMocks')).presenceDbModule())
vi.mock('@/db/notifications/feed', async () => (await import('./notificationsMocks')).feedDbModule())

const renderToString = (node: ReactNode) => renderRaw(<>{node}</>).replaceAll('<!-- -->', '')

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(resetNotifEnv)

const ALL = () => [...everyEmittedShape(), ...legacyRows()]

describe('Hebrew baseline — /notifications (server HTML)', () => {
  test('desktop: every emitted shape + legacy rows, read and unread', async () => {
    const html = renderToString(await pageTree(null, {}, { rows: ALL() }))
    expect(html).toContain('התראות')
    expect(html).toContain('ליד חדש — יוסי לוי')
    expect(html).toContain('סימון הכל כנקרא')
    expect(html).toMatchSnapshot()
  })

  test('desktop: a full page offers "load more"; nothing unread hides "mark all"', async () => {
    const out = {
      full: renderToString(await pageTree(null, {}, { rows: fullPage() })),
      noneUnread: renderToString(await pageTree(null, {}, { rows: everyEmittedShape().slice(0, 3), unread: 0 })),
    }
    expect(out.full).toContain('הצג עוד')
    expect(out).toMatchSnapshot()
  })

  test('desktop: empty, filtered-empty (unread, category, both), each filter active', async () => {
    const read = everyEmittedShape().map((r) => ({ ...r, readAt: r.createdAt }))
    const out = {
      empty: renderToString(await pageTree(null, {}, { rows: [] })),
      unreadEmpty: renderToString(await pageTree(null, { unread: '1' }, { rows: read })),
      categoryEmpty: renderToString(await pageTree(null, { category: 'sla' }, { rows: read })),
      both: renderToString(await pageTree(null, { unread: '1', category: 'leads' }, { rows: read })),
      leads: renderToString(await pageTree(null, { category: 'leads' }, { rows: everyEmittedShape() })),
      integrations: renderToString(await pageTree(null, { category: 'integrations' }, { rows: everyEmittedShape() })),
    }
    expect(out.empty).toContain('אין התראות')
    expect(out.unreadEmpty).toContain('אין התראות שתואמות לסינון')
    expect(out).toMatchSnapshot()
  })

  test('phone: every shape, full page, empty, each segment, filtered-empty', async () => {
    const out = {
      all: renderToString(await pageTree(null, {}, { rows: ALL(), mobile: true })),
      full: renderToString(await pageTree(null, {}, { rows: fullPage(), mobile: true })),
      empty: renderToString(await pageTree(null, {}, { rows: [], mobile: true })),
      leads: renderToString(await pageTree(null, { category: 'leads' }, { rows: everyEmittedShape(), mobile: true })),
      followups: renderToString(await pageTree(null, { category: 'followups' }, { rows: [], mobile: true })),
      noneUnread: renderToString(await pageTree(null, {}, { rows: everyEmittedShape().slice(0, 2), mobile: true, unread: 0 })),
    }
    expect(out.all).toContain('סינון התראות')
    expect(out).toMatchSnapshot()
  })

  test('the tab title, and the feed reads the page made', async () => {
    await pageTree(null, { unread: '1', category: 'leads' }, { rows: [] })
    expect({ title: await pageTitle(null), calls: notifEnv.feedCalls }).toMatchSnapshot()
  })
})

describe('Hebrew baseline — the bell panel (server HTML)', () => {
  test('populated with and without the away band, one away arrival, empty, nothing unread', async () => {
    const rows = everyEmittedShape().slice(0, 8)
    const out = {
      withAway: renderToString(await panelTree(null, { items: rows, whileYouWereAway: AWAY, unreadCount: 5 })),
      noAway: renderToString(await panelTree(null, { items: legacyRows(), unreadCount: 2 })),
      oneAway: renderToString(
        await panelTree(null, { items: rows.slice(0, 1), whileYouWereAway: { ...AWAY, total: 1, categories: [{ category: 'messages', count: 1 }] }, unreadCount: 1 }),
      ),
      empty: renderToString(await panelTree(null, { items: [] })),
      allRead: renderToString(await panelTree(null, { items: rows.map((r) => ({ ...r, readAt: r.createdAt })), unreadCount: 0 })),
    }
    expect(out.withAway).toContain('בזמן שלא היית')
    expect(out.empty).toContain('אין התראות חדשות')
    expect(out).toMatchSnapshot()
  })
})
