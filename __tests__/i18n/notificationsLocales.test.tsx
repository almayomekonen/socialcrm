// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { cleanup, render } from '@testing-library/react'
import { NOW, everyEmittedShape, legacyRows, resetNotifEnv } from './notificationsEnv'
import { AWAY, pageTitle, pageTree, panelTree } from './notificationsHarness'
import { findHebrewLeaks, type Allowance } from './leakScan'

/**
 * The notifications in en / ar (Phase F3): the REAL page on desktop and phone
 * (texts, the page's own region, which elements are declared Hebrew and why,
 * no stray Hebrew), empty / filtered-empty, the tab title, the bell panel's
 * region and away line, and Hebrew THROUGH the provider = the recorded
 * baseline render (no provider) byte for byte. Hydration / switching:
 * notificationsLocalesHydration.test.tsx.
 */

vi.mock('next/navigation', async () => (await import('./notificationsMocks')).navigationModule())
vi.mock('@/lib/toast', async () => (await import('./notificationsMocks')).toastModule())
vi.mock('@/db/auth', async () => (await import('./notificationsMocks')).authModule())
vi.mock('@/db/uiLocale', async () => (await import('./notificationsMocks')).uiLocaleModule())
vi.mock('@/lib/device', async () => (await import('./notificationsMocks')).deviceModule())
vi.mock('@/lib/notifications/flags', async () => (await import('./notificationsMocks')).flagsModule())
vi.mock('@/db/notifications/presence', async () => (await import('./notificationsMocks')).presenceDbModule())
vi.mock('@/db/notifications/feed', async () => (await import('./notificationsMocks')).feedDbModule())

const saved = { ...process.env }
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
beforeEach(() => {
  process.env.UI_LOCALE_ENABLED = '1'
  process.env.UI_LOCALE_AGENCY_ALLOWLIST = '103'
})
afterEach(() => {
  cleanup()
  process.env = { ...saved }
  resetNotifEnv()
})

/** One server page (≤ 25 rows): the legacy rows, then every shape from the status change on (incl. the unknown provider). */
const ROWS = () => [...legacyRows(), ...everyEmittedShape().slice(8)]
const strip = (html: string) => html.replaceAll('<!-- -->', '')

/** Exactly what is shown as stored (legacy wording, free text, an unknown provider). */
const VERBATIM = ['ליד חדש: יוסי לוי', 'הודעה חדשה ב-Messenger — רונית', 'שלוש פניות בשבוע', 'הגיע ליד מtiktok שלא נשמר במערכת']
const ALLOWED: Allowance[] = [
  ...VERBATIM.map((text) => ({ text, reason: 'verbatim-content' as const })),
  ...['יוסי לוי', 'מיכל אברהם', 'רונית', 'סטודיו נגה'].map((text) => ({ text, reason: 'customer-data' as const })),
]

const declaredHebrew = (root: Element) => [...root.querySelectorAll('[lang="he"]')].map((el) => [el.getAttribute('dir'), el.textContent])

describe('/notifications in en / ar', () => {
  for (const [locale, dir, heading, unread, sample] of [
    ['en', 'ltr', 'Notifications', 'Unread', 'Status updated — יוסי לוי'],
    ['ar', 'rtl', 'الإشعارات', 'غير مقروءة', 'عميل محتمل جديد — يوسي'],
  ] as const) {
    test(`desktop [${locale}]: heading, filters, rows, regions, no stray Hebrew`, async () => {
      const { container } = render(await pageTree(locale, {}, { rows: ROWS() }))
      const root = container.querySelector('div.grid')!
      expect([root.getAttribute('lang'), root.getAttribute('dir')]).toEqual([locale, dir])
      expect(container.querySelector('h1')!.textContent).toBe(heading)
      expect(container.textContent).toContain(unread)
      if (locale === 'en') expect(container.textContent).toContain(sample)
      // The only Hebrew-declared elements are the stored texts shown verbatim.
      expect(declaredHebrew(container)).toEqual(VERBATIM.map((t) => ['rtl', t]))
      expect(findHebrewLeaks(container, ALLOWED)).toEqual([])
    })

    test(`phone [${locale}]: segmented filter, rows with category + time, regions`, async () => {
      const { container } = render(await pageTree(locale, {}, { rows: ROWS(), mobile: true }))
      const root = container.firstElementChild!
      expect([root.getAttribute('lang'), root.getAttribute('dir')]).toEqual([locale, dir])
      const nav = container.querySelector('[role="navigation"]')!
      expect(nav.getAttribute('aria-label')).toBe(locale === 'en' ? 'Filter notifications' : 'تصفية الإشعارات')
      expect([...nav.querySelectorAll('a')].map((a) => a.textContent)).toEqual(
        locale === 'en' ? ['All', 'Leads', 'Follow-ups'] : ['الكل', 'العملاء المحتملون', 'المتابعات'],
      )
      expect(container.textContent).toContain(locale === 'en' ? '2 hours ago · Leads' : 'المحادثات')
      expect(declaredHebrew(container)).toEqual(VERBATIM.map((t) => ['rtl', t]))
      expect(findHebrewLeaks(container, ALLOWED)).toEqual([])
    })
  }

  test('empty and filtered-empty, desktop and phone', async () => {
    const empty = render(await pageTree('en', {}, { rows: [] }))
    expect(empty.container.textContent).toContain('No notifications')
    expect(empty.container.textContent).toContain('When a new lead comes in or something needs attention, it will appear here.')
    cleanup()
    const filtered = render(await pageTree('ar', { unread: '1' }, { rows: [], mobile: true }))
    expect(filtered.container.textContent).toContain('لا توجد إشعارات تطابق التصفية')
    expect(findHebrewLeaks(filtered.container, [])).toEqual([])
  })

  test('the filters keep their hrefs and aria-current in every language', async () => {
    const hrefs = async (locale: 'he' | 'en' | 'ar') => {
      const { container } = render(await pageTree(locale, { category: 'leads' }, { rows: [] }))
      const out = [...container.querySelectorAll('nav a')].map((a) => [a.getAttribute('href'), a.getAttribute('aria-current')])
      cleanup()
      return out
    }
    const he = await hrefs('he')
    expect(await hrefs('en')).toEqual(he)
    expect(await hrefs('ar')).toEqual(he)
  })

  test('tab title', async () => {
    expect(await pageTitle(null)).toBe('התראות')
    expect(await pageTitle('he')).toBe('התראות')
    expect(await pageTitle('en')).toBe('Notifications')
    expect(await pageTitle('ar')).toBe('الإشعارات')
  })

  test('Hebrew through the provider is the baseline render, byte for byte', async () => {
    for (const opts of [{ rows: ROWS() }, { rows: ROWS(), mobile: true }, { rows: [] }]) {
      const none = strip(renderToString(await pageTree(null, {}, opts)))
      expect(strip(renderToString(await pageTree('he', {}, opts)))).toBe(none)
    }
  })
})

describe('the bell panel in en / ar', () => {
  test('declares the language (it is portaled), words the away line, keeps names', async () => {
    const en = render(await panelTree('en', { items: everyEmittedShape().slice(0, 3), whileYouWereAway: AWAY, unreadCount: 2 }))
    const panel = en.container.querySelector('[aria-labelledby="notifPanelTitle"]')!
    expect([panel.getAttribute('lang'), panel.getAttribute('dir')]).toEqual(['en', 'ltr'])
    expect(panel.querySelector('section')!.getAttribute('aria-label')).toBe('While you were away')
    expect(panel.querySelector('section')!.textContent).toBe('While you were away · 3 hours ago4 new notifications · Leads 3, Follow-ups 1')
    expect(panel.textContent).toContain('Mark all as read')
    expect(panel.textContent).toContain('All notifications')
    cleanup()
    const ar = render(await panelTree('ar', { items: [], whileYouWereAway: { ...AWAY, total: 1, categories: [{ category: 'messages', count: 1 }] }, unreadCount: 1 }))
    const arPanel = ar.container.querySelector('[aria-labelledby="notifPanelTitle"]')!
    expect([arPanel.getAttribute('lang'), arPanel.getAttribute('dir')]).toEqual(['ar', 'rtl'])
    expect(arPanel.textContent).toContain('إشعار جديد واحد · المحادثات 1')
    expect(arPanel.textContent).toContain('لا توجد إشعارات جديدة')
    expect(findHebrewLeaks(ar.container, [])).toEqual([])
  })

  test('Hebrew through the provider declares nothing and matches the baseline', async () => {
    const props = { items: legacyRows(), whileYouWereAway: AWAY, unreadCount: 2 }
    expect(strip(renderToString(await panelTree('he', props)))).toBe(strip(renderToString(await panelTree(null, props))))
  })
})
