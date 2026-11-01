// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

/**
 * The settings link to /settings/language and the page itself must agree:
 * the link is shown exactly when the page renders. Regression for the
 * production 404 of 2026-10-28 — flag on, migration pending, the locale read
 * failed, the page 404'd while the menu (which checked only the flag) still
 * linked to it.
 */

const session = { current: { id: 7, agencyId: 103, role: 'ADMIN' } as any }
const getUiLocalePrefs = vi.fn(async () => ({ userLocale: null, agencyLocale: null }))

vi.mock('next/navigation', () => ({
  usePathname: () => '/settings/self_edit',
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
vi.mock('@/db/auth', () => ({ getUser: async () => session.current }))
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: (...a: any[]) => (getUiLocalePrefs as any)(...a) }))
vi.mock('@/lib/device', () => ({ isMobileRequest: async () => false }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: async () => ({ hasAccess: true }) }))

const { default: SettingLayout } = await import('@/app/(he)/(app)/settings/layout')
const { default: LanguagePage } = await import('@/app/(he)/(app)/settings/(user_settings)/language/page')

async function linkShown() {
  const html = renderToString(await SettingLayout({ children: null }))
  return html.includes('href="/settings/language"')
}

async function pageRenders() {
  try {
    await LanguagePage()
    return true
  } catch (e) {
    if ((e as Error).message === 'NEXT_NOT_FOUND') return false
    throw e
  }
}

const saved = { ...process.env }
beforeEach(() => {
  process.env.UI_LOCALE_ENABLED = '1'
  process.env.UI_LOCALE_AGENCY_ALLOWLIST = '103'
  session.current = { id: 7, agencyId: 103, role: 'ADMIN' }
  getUiLocalePrefs.mockReset()
  getUiLocalePrefs.mockResolvedValue({ userLocale: null, agencyLocale: null })
})
afterEach(() => {
  process.env = { ...saved }
})

describe('language settings link ⇔ language page', () => {
  test('pilot agency with a working read: link shown and page renders', async () => {
    expect(await linkShown()).toBe(true)
    expect(await pageRenders()).toBe(true)
  })

  test('flag disabled: no link, page 404, no locale query', async () => {
    delete process.env.UI_LOCALE_ENABLED
    expect(await linkShown()).toBe(false)
    expect(await pageRenders()).toBe(false)
    expect(getUiLocalePrefs).not.toHaveBeenCalled()
  })

  test('agency outside the allowlist: no link, page 404, no locale query', async () => {
    session.current = { id: 8, agencyId: 108, role: 'ADMIN' }
    expect(await linkShown()).toBe(false)
    expect(await pageRenders()).toBe(false)
    expect(getUiLocalePrefs).not.toHaveBeenCalled()
  })

  test('locale read fails (missing column): no link, page 404 — never a link to a 404', async () => {
    getUiLocalePrefs.mockRejectedValue(new Error('column users.uiLocale does not exist'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await linkShown()).toBe(false)
    expect(await pageRenders()).toBe(false)
    spy.mockRestore()
  })

  test('non-admin roles in the pilot still get the link (personal language)', async () => {
    session.current = { id: 9, agencyId: 103, role: 'AGNT' }
    expect(await linkShown()).toBe(true)
    expect(await pageRenders()).toBe(true)
  })
})
