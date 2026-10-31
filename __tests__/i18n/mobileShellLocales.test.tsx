// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { resetShellEnv, shellEnv } from './mobileShellEnv'
import { resetShellSpies } from './mobileShellMocks'
import { TITLES, handoffTree, moreTitle, moreTree, shellTree, withLocale } from './mobileShellHarness'

/**
 * The phone shell in English and Arabic (i18n Phase F1): header titles on every
 * route, the tab bar (labels, landmark name, badge names with plurals), the
 * back control and its LTR mirror, the regions (shell = interface language,
 * `<main>` = Hebrew for untranslated screens), the "עוד" page, the desktop-only
 * handoffs and their copy action, the skeleton status line, hydration in every
 * language and a language switch in one session. Hebrew byte-identity is the
 * baselines' job (mobileShellHebrewBaseline*).
 */

vi.mock('next/navigation', async () => (await import('./mobileShellMocks')).navigationModule())
vi.mock('@/db/auth', async () => (await import('./mobileShellMocks')).authModule())
vi.mock('@/db/uiLocale', async () => (await import('./mobileShellMocks')).uiLocaleModule())
vi.mock('@/lib/device', async () => (await import('./mobileShellMocks')).deviceModule())
vi.mock('@/lib/flags/mobileFlags', () => ({ canEnterMobileWorkspace: () => true }))
vi.mock('@/lib/ai/flags', async () => (await import('./mobileShellMocks')).aiFlagsModule())
vi.mock('@/lib/flags/questionnaireBuilderFlags', async () => (await import('./mobileShellMocks')).builderFlagsModule())
vi.mock('@/actions/auth', async () => ({ logout: (await import('./mobileShellMocks')).shellSpies.logout }))
vi.mock('@/lib/clipboard', async () => (await import('./mobileShellMocks')).clipboardModule())

const saved = { ...process.env }
beforeEach(() => {
  process.env.UI_LOCALE_ENABLED = '1'
  process.env.UI_LOCALE_AGENCY_ALLOWLIST = '103'
})
afterEach(() => {
  cleanup()
  process.env = { ...saved }
  resetShellEnv()
  resetShellSpies()
})

const header = () => screen.getByRole('banner')
const backArrow = () => screen.getByRole('button', { name: /Back|رجوع|חזרה/ }).querySelector('[aria-hidden]')!

describe('header title on every route', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(locale, async () => {
      for (const [path, title] of Object.entries(TITLES[locale])) {
        render(await shellTree(locale, path))
        expect(within(header()).getByRole('heading', { level: 1 }).textContent, path).toBe(title)
        cleanup()
      }
    })
  }
})

describe('tab bar', () => {
  test('English: labels, landmark name, badge names', async () => {
    render(await shellTree('en', '/dashboard', null, { notificationCount: 7, conversationCount: 1 }))
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect([...nav.querySelectorAll('a > span:last-child')].map((a) => a.textContent)).toEqual(['Today', 'Leads', 'Conversations', 'Notifications', 'More'])
    expect(within(nav).getByRole('link', { name: 'Conversations, 1 new' })).toBeTruthy()
    expect(within(nav).getByRole('link', { name: 'Notifications, 7 new' })).toBeTruthy()
    expect(within(nav).getByRole('link', { name: 'Today' }).getAttribute('aria-current')).toBe('page')
  })

  test('Arabic: labels and the plural forms of the badge name', async () => {
    render(await shellTree('ar', '/inbox', null, { notificationCount: 4, conversationCount: 1 }))
    const nav = screen.getByRole('navigation', { name: 'التنقل الرئيسي' })
    expect([...nav.querySelectorAll('a > span:last-child')].map((a) => a.textContent)).toEqual(['اليوم', 'العملاء المحتملون', 'المحادثات', 'الإشعارات', 'المزيد'])
    expect(within(nav).getByRole('link', { name: 'المحادثات، عنصر جديد واحد' })).toBeTruthy()
    expect(within(nav).getByRole('link', { name: 'الإشعارات، 4 عناصر جديدة' })).toBeTruthy()
    cleanup()
    render(await shellTree('ar', '/inbox', null, { notificationCount: 2, conversationCount: 1200 }))
    expect(screen.getByRole('link', { name: 'الإشعارات، عنصران جديدان' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'المحادثات، 1200 عنصر جديد' })).toBeTruthy()
  })
})

describe('back control and direction', () => {
  test('English names it and mirrors the arrow; Arabic and Hebrew keep the RTL arrow', async () => {
    render(await shellTree('en', '/clients/5/summary'))
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
    expect(backArrow().className).toContain('-scale-x-100')
    cleanup()
    render(await shellTree('ar', '/clients/5/summary'))
    expect(screen.getByRole('button', { name: 'رجوع' })).toBeTruthy()
    expect(backArrow().className).not.toContain('-scale-x-100')
    cleanup()
    render(await shellTree('he', '/clients/5/summary'))
    expect(screen.getByRole('button', { name: 'חזרה' })).toBeTruthy()
    expect(backArrow().className).not.toContain('-scale-x-100')
  })

  test('regions: the shell declares the interface language, <main> declares Hebrew; Hebrew declares nothing', async () => {
    for (const [locale, dir] of [['en', 'ltr'], ['ar', 'rtl']] as const) {
      const { container } = render(await shellTree(locale, '/leads', <p>תוכן לא מתורגם</p>))
      const root = container.querySelector('[data-mobile-workspace]')!
      expect([root.getAttribute('lang'), root.getAttribute('dir')]).toEqual([locale, dir])
      const main = screen.getByRole('main')
      expect([main.getAttribute('lang'), main.getAttribute('dir')]).toEqual(['he', 'rtl'])
      cleanup()
    }
    const { container } = render(await shellTree('he', '/leads', <p>תוכן</p>))
    expect(container.querySelector('[lang],[dir]')).toBeNull()
  })
})

describe('the "More" page (/m)', () => {
  test('English: sections, rows, the desktop note, the session rows, region, mirrored chevrons', async () => {
    const { container } = render(await moreTree('en'))
    for (const heading of ['Profile', 'Workspace', 'Business', 'System', 'On the computer']) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy()
    }
    // The support row's section and the session block share the "Account" heading, as in Hebrew.
    expect(screen.getAllByRole('heading', { name: 'Account' })).toHaveLength(2)
    expect(screen.getByRole('link', { name: /Personal profile/ }).textContent).toContain('Name, photo and preferences')
    expect(screen.getByRole('link', { name: /Your AI agent/ }).textContent).toContain("Your business's smart assistant")
    expect(screen.getByRole('link', { name: /Subscription and billing/ })).toBeTruthy()
    expect(screen.getByText('Invoices, reports and automations are available in the desktop version.')).toBeTruthy()
    expect(screen.getByText('Signed in')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy()
    const root = container.firstElementChild!
    expect([root.getAttribute('lang'), root.getAttribute('dir')]).toEqual(['en', 'ltr'])
    const chevrons = [...container.querySelectorAll('a [aria-hidden]')].filter((el) => el.className.includes('size-4 bg-gray-300'))
    expect(chevrons.length).toBeGreaterThan(5)
    for (const c of chevrons) expect(c.className).toContain('-scale-x-100')
  })

  test('Arabic: rows and region; chevrons stay RTL', async () => {
    const { container } = render(await moreTree('ar'))
    expect(screen.getByRole('heading', { name: 'مساحة العمل' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /التكاملات/ }).textContent).toContain('واتساب وفيسبوك وإنستغرام')
    expect(screen.getByRole('button', { name: 'تسجيل الخروج' })).toBeTruthy()
    expect(container.firstElementChild!.getAttribute('lang')).toBe('ar')
    for (const c of container.querySelectorAll('a [aria-hidden]')) expect(c.className).not.toContain('-scale-x-100')
  })

  test('tab title in every language', async () => {
    expect(await moreTitle('he')).toBe('עוד')
    expect(await moreTitle('en')).toBe('More')
    expect(await moreTitle('ar')).toBe('المزيد')
  })
})

describe('desktop-only handoffs', () => {
  test('English: title, body, footer, copy action (copied, then failed), region', async () => {
    const { container } = render(await handoffTree('en', 'tasks'))
    expect(screen.getByRole('heading', { name: 'Tasks' })).toBeTruthy()
    expect(screen.getByText(/^This screen is currently available on the computer\. There you see every task/)).toBeTruthy()
    expect(container.textContent).toContain('The full screen is available on the computer · getsocialcrm.com')
    expect(container.firstElementChild!.getAttribute('lang')).toBe('en')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy the sign-in link for your computer' })))
    expect(screen.getByRole('status').textContent).toBe('Link copied')
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy()
    cleanup()
    shellEnv.copyOk = false
    render(await handoffTree('en', 'clients'))
    expect(screen.getByRole('heading', { name: 'Leads that closed a deal' })).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button')))
    expect(screen.getByRole('status').textContent).toBe("We couldn't copy it. You can select the address and copy it by hand.")
  })

  test('Arabic: title, body and region', async () => {
    const { container } = render(await handoffTree('ar', 'lead_billing'))
    expect(screen.getByRole('heading', { name: 'فوترة العميل المحتمل' })).toBeTruthy()
    expect(container.textContent).toContain('الشاشة الكاملة متاحة على الحاسوب')
    expect([container.firstElementChild!.getAttribute('lang'), container.firstElementChild!.getAttribute('dir')]).toEqual(['ar', 'rtl'])
  })

  test('the shell-level skeleton line is translated and declares its language', async () => {
    const { default: MobileInnerSkeleton } = await import('@/components/mobile/skeletons/MobileInnerSkeleton')
    for (const path of ['/leads', '/inbox', '/m', '/dashboard']) {
      render(await withLocale('en', <MobileInnerSkeleton path={path} />))
      const status = screen.getByRole('status')
      expect(status.textContent, path).toBe('Loading…')
      expect(status.closest('[lang]')!.getAttribute('lang'), path).toBe('en')
      cleanup()
    }
  })
})

describe('SSR / hydration and a language switch', () => {
  test('hydrating the server HTML reports no mismatch in he / en / ar', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    for (const locale of ['he', 'en', 'ar'] as const) {
      for (const tree of [
        await shellTree(locale, '/clients/5/summary', null, { notificationCount: 2, conversationCount: 3 }),
        await handoffTree(locale, 'deals'),
        await moreTree(locale),
      ]) {
        const container = document.createElement('div')
        container.innerHTML = renderToString(tree)
        document.body.appendChild(container)
        const errors: unknown[] = []
        const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a))
        let root: ReturnType<typeof hydrateRoot>
        await act(async () => {
          root = hydrateRoot(container, tree, { onRecoverableError: (e) => errors.push(e) })
        })
        spy.mockRestore()
        expect(errors, locale).toEqual([])
        act(() => root.unmount())
        container.remove()
      }
    }
  })

  test('switching language in one session re-words the chrome and drops the region in Hebrew', async () => {
    const { rerender, container } = render(await shellTree('en', '/notifications', null, { notificationCount: 1 }))
    expect(within(header()).getByRole('heading').textContent).toBe('Notifications')
    rerender(await shellTree('ar', '/notifications', null, { notificationCount: 1 }))
    expect(within(header()).getByRole('heading').textContent).toBe('الإشعارات')
    expect(container.querySelector('[data-mobile-workspace]')!.getAttribute('dir')).toBe('rtl')
    rerender(await shellTree('he', '/notifications', null, { notificationCount: 1 }))
    expect(within(header()).getByRole('heading').textContent).toBe('התראות')
    expect(screen.getByRole('link', { name: 'התראות, 1 חדשות' })).toBeTruthy()
    expect(container.querySelector('[lang],[dir]')).toBeNull()
  })
})
