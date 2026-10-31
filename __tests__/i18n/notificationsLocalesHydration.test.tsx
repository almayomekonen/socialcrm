// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { cleanup, render } from '@testing-library/react'
import { NOW, everyEmittedShape, legacyRows, resetNotifEnv } from './notificationsEnv'
import { AWAY, pageTree, panelTree } from './notificationsHarness'

/**
 * The notifications: server/client hydration agreement in he / en / ar (the
 * page on desktop and phone with mapped and verbatim rows, empty, the bell
 * panel), and a language switch inside one session (the rows re-word from the
 * same stored text; Hebrew comes back as stored).
 */

vi.mock('next/navigation', async () => (await import('./notificationsMocks')).navigationModule())
vi.mock('@/lib/toast', async () => (await import('./notificationsMocks')).toastModule())
vi.mock('@/db/auth', async () => (await import('./notificationsMocks')).authModule())
vi.mock('@/db/uiLocale', async () => (await import('./notificationsMocks')).uiLocaleModule())
vi.mock('@/lib/device', async () => (await import('./notificationsMocks')).deviceModule())
vi.mock('@/lib/notifications/flags', async () => (await import('./notificationsMocks')).flagsModule())
vi.mock('@/db/notifications/presence', async () => (await import('./notificationsMocks')).presenceDbModule())
vi.mock('@/db/notifications/feed', async () => (await import('./notificationsMocks')).feedDbModule())
vi.mock('@/modules/inbox/client/useAdaptivePoll', () => ({ useAdaptivePoll: () => {} }))
vi.mock('@/lib/analytics/track', () => ({ track: () => {} }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

async function hydrate(tree: ReactNode) {
  const host = document.createElement('div')
  host.innerHTML = renderToString(tree)
  document.body.appendChild(host)
  const errors: unknown[] = []
  const spy = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args))
  let root: ReturnType<typeof hydrateRoot> | null = null
  await act(async () => {
    root = hydrateRoot(host, tree, { onRecoverableError: (e) => errors.push(e) })
  })
  spy.mockRestore()
  await act(async () => root!.unmount())
  host.remove()
  return errors
}

const ROWS = () => [...legacyRows(), ...everyEmittedShape().slice(0, 20)]

describe('hydration agrees in every language', () => {
  for (const locale of ['he', 'en', 'ar'] as const) {
    test(`page desktop / phone / empty, panel [${locale}]`, async () => {
      expect(await hydrate(await pageTree(locale, {}, { rows: ROWS() }))).toEqual([])
      expect(await hydrate(await pageTree(locale, { category: 'leads' }, { rows: ROWS(), mobile: true }))).toEqual([])
      expect(await hydrate(await pageTree(locale, { unread: '1' }, { rows: [] }))).toEqual([])
      expect(await hydrate(await panelTree(locale, { items: ROWS().slice(0, 8), whileYouWereAway: AWAY, unreadCount: 3 }))).toEqual([])
    })
  }
})

describe('language switch within one session', () => {
  test('the same stored rows re-word en → ar → he; Hebrew is the stored text', async () => {
    const rows = [everyEmittedShape()[0], legacyRows()[0]]
    const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
    const { default: NotificationRow } = await import('@/components/notifications/NotificationRow')
    const tree = (locale: 'he' | 'en' | 'ar') => (
      <I18nProvider locale={locale}>
        {rows.map((item) => (
          <NotificationRow key={item.id} item={item} onSelect={() => {}} />
        ))}
      </I18nProvider>
    )
    const view = render(tree('en'))
    const titles = () => [...view.container.querySelectorAll('button > span:nth-child(2) > span:first-child')].map((s) => [s.textContent, s.getAttribute('lang')])
    expect(titles()).toEqual([
      ['New lead — יוסי לוי', null],
      ['ליד חדש: יוסי לוי', 'he'],
    ])
    view.rerender(tree('ar'))
    expect(titles()).toEqual([
      ['عميل محتمل جديد — יוסי לוי', null],
      ['ליד חדש: יוסי לוי', 'he'],
    ])
    view.rerender(tree('he'))
    expect(titles()).toEqual([
      [rows[0].title, null],
      [rows[1].title, null],
    ])
  })
})
