// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { act, cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SIGNED_IN, preLoginEnv, resetPreLoginEnv } from './preLoginEnv'
import { resolveAsync } from './dashboardHarness'
import { findHebrewLeaks } from './leakScan'

/**
 * Locale tests for sign-in, registration and the root ChunkReloader (i18n
 * Phase F4). The language comes ONLY from the `ui_locale` cookie under
 * `UI_LOCALE_ENABLED`: en / ar → translated with the region declared; no cookie,
 * an invalid one, or the flag off → byte-identical Hebrew. Titles, hydration
 * (he / en / ar) and the reload overlay. Activation + consent:
 * preLoginLocalesActivation.test.tsx; behaviour: preLoginBehaviour.test.tsx.
 */

vi.mock('next/navigation', async () => (await import('./preLoginMocks')).navigationModule())
vi.mock('next/headers', async () => (await import('./preLoginMocks')).headersModule())
vi.mock('next/script', () => ({ default: () => null }))
vi.mock('@/db/auth', async () => (await import('./preLoginMocks')).authDbModule())
vi.mock('@/lib/device', async () => (await import('./preLoginMocks')).deviceModule())
vi.mock('@/lib/auth/facebookUserAuthFlags', async () => (await import('./preLoginMocks')).facebookAuthFlagsModule())
vi.mock('@/actions/auth', async () => (await import('./preLoginMocks')).authActionsModule())
vi.mock('@/actions/agencies', async () => (await import('./preLoginMocks')).agenciesActionsModule())
vi.mock('@/lib/toast', async () => (await import('./preLoginMocks')).toastModule())

const renderToString = (node: ReactNode) => renderRaw(<>{node}</>).replaceAll('<!-- -->', '')
const saved = { ...process.env }

afterEach(() => {
  cleanup()
  resetPreLoginEnv()
  process.env = { ...saved }
  document.cookie = 'ui_locale=; Path=/; Max-Age=0'
})

function as(locale: string | null, flag = true) {
  if (flag) process.env.UI_LOCALE_ENABLED = '1'
  else delete process.env.UI_LOCALE_ENABLED
  preLoginEnv.cookies = locale === null ? {} : { ui_locale: locale }
}

async function authTree(search: Record<string, string> = {}) {
  const { default: Page } = await import('@/app/(auth)/auth/page')
  return resolveAsync(await Page({ searchParams: Promise.resolve(search) }))
}
async function registerTree() {
  const { default: Page } = await import('@/app/(auth)/auth/register/page')
  return resolveAsync(await Page({ searchParams: Promise.resolve({}) }))
}

describe('Hebrew is untouched without a usable cookie', () => {
  test('no cookie, an invalid cookie, he, or en with the flag OFF → the same Hebrew page', async () => {
    for (const env of [{ user: null }, { user: SIGNED_IN, mobile: true }]) {
      Object.assign(preLoginEnv, env)
      as(null)
      const reference = { auth: renderToString(await authTree({ error: '1' })), register: renderToString(await registerTree()) }
      for (const [cookie, flag] of [
        ['xx', true],
        ['he', true],
        ['EN', true],
        ['en', false],
        ['ar', false],
      ] as const) {
        as(cookie, flag)
        expect(renderToString(await authTree({ error: '1' })), `${cookie}/${flag}`).toBe(reference.auth)
        expect(renderToString(await registerTree()), `${cookie}/${flag}`).toBe(reference.register)
      }
      expect(reference.auth).toContain('ברוך שובך')
      expect(reference.auth).not.toContain('lang="en"')
    }
  })
})

describe('en / ar from the cookie', () => {
  const EXPECT = {
    en: {
      heading: 'Welcome back',
      join: 'Join now',
      submit: 'Start for free',
      register: 'Create account',
      facebook: 'Sign in with Facebook',
      dir: 'ltr',
    },
    ar: {
      heading: 'مرحبًا بعودتك',
      join: 'انضم الآن',
      submit: 'ابدأ مجانًا',
      register: 'إنشاء الحساب',
      facebook: 'تسجيل الدخول باستخدام Facebook',
      dir: 'rtl',
    },
  } as const

  for (const locale of ['en', 'ar'] as const) {
    test(`${locale}: sign-in and registration translated, region declared, no Hebrew but data`, async () => {
      as(locale)
      Object.assign(preLoginEnv, { user: SIGNED_IN })
      const e = EXPECT[locale]
      const view = render(<>{await authTree({ error: '1' })}</>)
      const grid = view.container.querySelector('.auth-surface')!
      expect([grid.getAttribute('lang'), grid.getAttribute('dir')]).toEqual([locale, e.dir])
      expect(view.container.textContent).toContain(e.heading)
      expect(view.container.textContent).toContain(e.join)
      expect(view.getByRole('button', { name: e.submit })).toBeTruthy()
      expect(view.getByRole('button', { name: e.facebook })).toBeTruthy()
      expect(view.getByRole('textbox')).toBeTruthy()
      expect(findHebrewLeaks(view.container, [{ text: 'דנה כהן', reason: 'customer-data' }])).toEqual([])
      cleanup()
      const reg = render(<>{await registerTree()}</>)
      expect(reg.container.querySelector('.auth-surface')!.getAttribute('lang')).toBe(locale)
      expect(reg.getByRole('button', { name: e.register })).toBeTruthy()
      expect(findHebrewLeaks(reg.container, [])).toEqual([])
    })
  }

  test('the phone sign-in: the matched social buttons stay LTR, labels translated', async () => {
    as('en')
    preLoginEnv.mobile = true
    const view = render(<>{await authTree()}</>)
    const row = view.getByTestId('social-auth-buttons')
    expect(row.getAttribute('dir')).toBe('ltr')
    expect(row.textContent).toBe('Sign in with GoogleSign in with Facebook')
  })
})

describe('tab titles', () => {
  test('he = the recorded metadata; en / ar re-word only the title', async () => {
    const auth = await import('@/app/(auth)/auth/page')
    const register = await import('@/app/(auth)/auth/register/page')
    as(null)
    const heAuth = (await auth.generateMetadata()) as Record<string, unknown>
    expect(heAuth.title).toBe('התחברות | SocialCRM — מערכת ניהול לידים')
    expect((await register.generateMetadata()).title).toBe('הרשמה')
    as('en')
    const enAuth = (await auth.generateMetadata()) as Record<string, unknown>
    expect(enAuth.title).toBe('Sign in | SocialCRM — lead management')
    expect({ ...enAuth, title: heAuth.title }).toEqual(heAuth)
    expect((await register.generateMetadata()).title).toBe('Sign up')
    as('ar')
    expect((await register.generateMetadata()).title).toBe('إنشاء حساب')
  })
})

describe('hydration', () => {
  for (const locale of ['he', 'en', 'ar'] as const) {
    test(`${locale}: the sign-in page hydrates without a mismatch`, async () => {
      ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
      as(locale === 'he' ? null : locale)
      preLoginEnv.user = SIGNED_IN
      const tree = await authTree({ error: '1' })
      const container = document.createElement('div')
      container.innerHTML = renderRaw(<>{tree}</>)
      document.body.appendChild(container)
      const errors: unknown[] = []
      const spy = vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a))
      const recoverable: unknown[] = []
      const root = await act(async () =>
        hydrateRoot(container, <>{tree}</>, { onRecoverableError: (e) => void recoverable.push(e) }),
      )
      expect(recoverable).toEqual([])
      expect(errors.filter((e) => String(e).match(/hydrat|did not match/i))).toEqual([])
      act(() => root.unmount())
      spy.mockRestore()
      container.remove()
    })
  }
})

describe('ChunkReloader', () => {
  async function overlay(cookie: string | null) {
    try {
      sessionStorage.clear()
    } catch {}
    if (cookie) document.cookie = `ui_locale=${cookie}; Path=/`
    vi.useFakeTimers()
    const { default: ChunkReloader } = await import('@/lib/ChunkReloader')
    const { container } = render(<ChunkReloader />)
    act(() => void window.dispatchEvent(new ErrorEvent('error', { message: 'ChunkLoadError' })))
    vi.useRealTimers()
    return container.firstElementChild as HTMLElement
  }
  test('en / ar from the cookie; none or invalid → the Hebrew overlay exactly', async () => {
    const he = (await overlay(null)).outerHTML
    cleanup()
    expect((await overlay('zz')).outerHTML).toBe(he)
    cleanup()
    const en = await overlay('en')
    expect([en.getAttribute('lang'), en.getAttribute('dir'), en.textContent]).toEqual([
      'en',
      'ltr',
      'A new update is loading, refreshing...',
    ])
    cleanup()
    const ar = await overlay('ar')
    expect([ar.getAttribute('lang'), ar.getAttribute('dir')]).toEqual(['ar', 'rtl'])
    expect(findHebrewLeaks(ar, [])).toEqual([])
  })
})
