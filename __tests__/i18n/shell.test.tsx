// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { act } from 'react'
import { I18nProvider } from '@/lib/i18n/I18nProvider'
import { bellLabel } from '@/modules/notifications/dropdown'
import { createTranslator } from '@/lib/i18n/translate'
import { CATALOGS } from '@/lib/i18n/messages'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => '/leads',
}))
vi.mock('@/actions/auth', () => ({ logout: async () => {} }))
vi.mock('@/modules/inbox/awareness/AwarenessContext', () => ({ useAwarenessCount: () => null }))
vi.mock('@/components/notifications/NotificationBell', async (orig) => ({ ...(await orig<any>()), default: () => null }))
vi.mock('@/components/education/HelpTrigger', () => ({ default: () => null }))

const { default: Nav } = await import('@/lib/navs/Nav')
const { default: Topbar } = await import('@/lib/navs/Topbar')
const { ProNameLine } = await import('@/lib/navs/ProNameLabel')
const { default: SettingsChrome } = await import('@/components/settings/SettingsChrome')
const { bellLabelFor } = await import('@/components/notifications/NotificationBell')

afterEach(cleanup)

const user = { id: 1, name: 'דנה', role: 'ADMIN', agencyId: 103 }
const HEBREW_NAV = ['היום', 'לידים', 'לקוחות', 'שיחות', 'עסקאות', 'ביצועים', 'משימות', 'פגישות', 'הגדרות', 'התנתקות']

function shell(locale?: 'he' | 'en' | 'ar') {
  const tree = (
    <>
      <Topbar user={user} trialDaysRemaining={3} />
      <Nav user={user} />
      <SettingsChrome nav={<a href='/x'>nav</a>}>
        <p>תוכן לא מתורגם</p>
      </SettingsChrome>
    </>
  )
  return locale ? <I18nProvider locale={locale}>{tree}</I18nProvider> : tree
}

describe('Hebrew regression — existing customers see exactly what they saw', () => {
  test('without a provider and with Hebrew, the markup is identical', () => {
    expect(renderToString(shell('he'))).toBe(renderToString(shell()))
  })

  test('Hebrew renders the original strings and adds no lang/dir anywhere', () => {
    const { container } = render(shell('he'))
    for (const label of HEBREW_NAV) expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    expect(screen.getByText('ניהול ומעקב לידים')).toBeTruthy()
    expect(screen.getAllByRole('navigation', { name: 'ניווט ראשי' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'פתיחת תפריט' })).toBeTruthy()
    expect(container.querySelector('[lang],[dir]')).toBeNull()
  })

  test('identity line keeps role label and trial pill wording', () => {
    render(<ProNameLine user={user} isPro={false} trialDaysRemaining={1} />)
    expect(screen.getByText('PRO · נותר יום')).toBeTruthy()
    expect(screen.getByText(/- מנהל המערכת/)).toBeTruthy()
  })

  test('bell accessible name matches the pre-i18n Hebrew for every count', () => {
    const t = createTranslator('he', CATALOGS.he)
    for (let n = -1; n <= 120; n++) expect(bellLabelFor(t, n)).toBe(bellLabel(n))
  })
})

describe('English (LTR)', () => {
  test('shell is translated and the settings grid is LTR while content stays Hebrew RTL', () => {
    const { container } = render(shell('en'))
    expect(screen.getAllByText('Leads').length).toBeGreaterThan(0)
    expect(screen.getByText('Manage and follow up on leads')).toBeTruthy()
    expect(screen.getAllByRole('navigation', { name: 'Main navigation' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeTruthy()
    expect(screen.getByText('PRO · 3 days left')).toBeTruthy()
    for (const label of HEBREW_NAV) expect(screen.queryByText(label)).toBeNull()

    const grid = container.querySelector('[dir="ltr"][lang="en"]')!
    expect(grid).toBeTruthy()
    const content = within(grid as HTMLElement).getByText('תוכן לא מתורגם').closest('[lang]')!
    expect(content.getAttribute('lang')).toBe('he')
    expect(content.getAttribute('dir')).toBe('rtl')
  })
})

describe('Arabic (RTL)', () => {
  test('shell is translated and translated regions are lang=ar dir=rtl', () => {
    const { container } = render(shell('ar'))
    expect(screen.getAllByText('العملاء المحتملون').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('navigation', { name: 'التنقل الرئيسي' }).length).toBeGreaterThan(0)
    expect(screen.getByText('PRO · تبقّت 3 أيام')).toBeTruthy()
    expect(screen.getAllByText(/- مدير النظام/).length).toBeGreaterThan(0)
    expect(container.querySelector('[lang="ar"][dir="rtl"]')).toBeTruthy()
  })
})

describe('SSR / hydration agreement', () => {
  test('hydrating server HTML reports no mismatch for any locale', async () => {
    for (const locale of ['he', 'en', 'ar'] as const) {
      const container = document.createElement('div')
      container.innerHTML = renderToString(shell(locale))
      document.body.appendChild(container)
      const errors: unknown[] = []
      const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a))
      let root: ReturnType<typeof hydrateRoot>
      await act(async () => {
        root = hydrateRoot(container, shell(locale), { onRecoverableError: (e) => errors.push(e) })
      })
      spy.mockRestore()
      expect(errors, locale).toEqual([])
      act(() => root.unmount())
      container.remove()
    }
  })
})
