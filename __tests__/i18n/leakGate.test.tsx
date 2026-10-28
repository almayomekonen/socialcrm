// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { findHebrewLeaks } from './leakScan'

const prefs = { userLocale: null as string | null }

vi.mock('next/navigation', () => ({
  usePathname: () => '/leads',
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
vi.mock('@/actions/auth', () => ({ logout: async () => {} }))
vi.mock('@/actions/uiLocale', () => ({ setMyUiLocale: vi.fn(), setAgencyDefaultUiLocale: vi.fn() }))
vi.mock('@/modules/inbox/awareness/AwarenessContext', () => ({ useAwarenessCount: () => null }))
vi.mock('@/components/notifications/NotificationBell', () => ({ default: () => null }))
vi.mock('@/components/education/HelpTrigger', () => ({ default: () => null }))
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./surfaces')).FIXTURE_USER }))
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: prefs.userLocale, agencyLocale: null }) }))
vi.mock('@/lib/device', () => ({ isMobileRequest: async () => false }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: async () => ({ hasAccess: true }) }))

const { SURFACES } = await import('./surfaces')

const saved = { ...process.env }
afterEach(() => {
  cleanup()
  process.env = { ...saved }
})

describe('Hebrew-leak gate — completed screens render no untranslated Hebrew', () => {
  for (const surface of SURFACES) {
    test(`${surface.name} (${surface.route})`, async () => {
      process.env.UI_LOCALE_ENABLED = '1'
      process.env.UI_LOCALE_AGENCY_ALLOWLIST = '103'
      const used = new Set<string>()
      for (const locale of ['en', 'ar'] as const) {
        prefs.userLocale = locale
        const { container } = render(await surface.render(locale))
        expect(findHebrewLeaks(container, surface.allowed, used), `${surface.name} [${locale}]`).toEqual([])
        cleanup()
      }
      const stale = surface.allowed.filter((a) => !used.has(a.text)).map((a) => a.text)
      expect(stale, `${surface.name}: allowances never used — remove them`).toEqual([])
    })
  }

  test('every registered screen renders Hebrew in Hebrew (the gate is not vacuous)', async () => {
    process.env.UI_LOCALE_ENABLED = '1'
    process.env.UI_LOCALE_AGENCY_ALLOWLIST = '103'
    prefs.userLocale = 'he'
    for (const surface of SURFACES) {
      const { container } = render(await surface.render('he'))
      expect(findHebrewLeaks(container, surface.allowed).length, surface.name).toBeGreaterThan(0)
      cleanup()
    }
  })
})
