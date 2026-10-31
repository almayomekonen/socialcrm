// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import {
  UI_LOCALE_COOKIE,
  UI_LOCALE_COOKIE_MAX_AGE,
  preLoginLocaleFrom,
  readUiLocaleCookie,
  rtlOrRegionAttrs,
  uiLocaleCookieWrite,
} from '@/lib/i18n/preLoginLocale'

/**
 * The pre-login locale mechanism (i18n Phase F4): the pure reader, the cookie
 * writer's exact strings, the server reader behind the kill switch, and the
 * signed-in provider writing / removing the cookie — and never writing for a
 * Hebrew user who has none, nor on the pre-login pages themselves.
 */

const cookieJar = { value: undefined as string | undefined }
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (n === 'ui_locale' && cookieJar.value !== undefined ? { name: n, value: cookieJar.value } : undefined),
  }),
}))

const saved = { ...process.env }
afterEach(() => {
  cleanup()
  process.env = { ...saved }
  cookieJar.value = undefined
  document.cookie = `${UI_LOCALE_COOKIE}=; Path=/; Max-Age=0`
  vi.restoreAllMocks()
})

describe('preLoginLocaleFrom (pure)', () => {
  test('valid en / ar / he honoured with the flag on', () => {
    expect(preLoginLocaleFrom('en', true)).toBe('en')
    expect(preLoginLocaleFrom('ar', true)).toBe('ar')
    expect(preLoginLocaleFrom('he', true)).toBe('he')
  })
  test('missing / invalid → Hebrew', () => {
    for (const raw of [undefined, null, '', 'EN', 'fr', 'en;', ' en', 'he-IL', '<script>'])
      expect(preLoginLocaleFrom(raw, true)).toBe('he')
  })
  test('flag off → Hebrew whatever the cookie says', () => {
    expect(preLoginLocaleFrom('en', false)).toBe('he')
    expect(preLoginLocaleFrom('ar', false)).toBe('he')
  })
})

describe('readUiLocaleCookie / uiLocaleCookieWrite / rtlOrRegionAttrs', () => {
  test('reads the cookie among others, null when absent', () => {
    expect(readUiLocaleCookie('a=1; ui_locale=ar; b=2')).toBe('ar')
    expect(readUiLocaleCookie('ui_locale=en')).toBe('en')
    expect(readUiLocaleCookie('a=1; xui_locale=en')).toBeNull()
    expect(readUiLocaleCookie('')).toBeNull()
  })
  test('exact attributes: Path=/, SameSite=Lax, one year, Secure only on https, never HttpOnly', () => {
    expect(UI_LOCALE_COOKIE_MAX_AGE).toBe(31_536_000)
    expect(uiLocaleCookieWrite('en', null, true)).toBe('ui_locale=en; Path=/; SameSite=Lax; Secure; Max-Age=31536000')
    expect(uiLocaleCookieWrite('ar', 'en', false)).toBe('ui_locale=ar; Path=/; SameSite=Lax; Max-Age=31536000')
    expect(uiLocaleCookieWrite('he', 'en', true)).toBe('ui_locale=; Path=/; SameSite=Lax; Secure; Max-Age=0')
    expect(uiLocaleCookieWrite('he', null, true)).toBeNull()
    for (const l of ['en', 'ar', 'he'] as const) expect(uiLocaleCookieWrite(l, 'x', true) ?? '').not.toMatch(/HttpOnly/i)
  })
  test('Hebrew keeps a hard-coded dir="rtl" exactly; other languages declare their region', () => {
    expect(rtlOrRegionAttrs('he')).toEqual({ dir: 'rtl' })
    expect(rtlOrRegionAttrs('en')).toEqual({ lang: 'en', dir: 'ltr' })
    expect(rtlOrRegionAttrs('ar')).toEqual({ lang: 'ar', dir: 'rtl' })
  })
})

describe('getPreLoginLocale (server, behind UI_LOCALE_ENABLED)', () => {
  const read = async () => (await import('@/lib/i18n/preLoginServer')).getPreLoginLocale()
  test('flag on: cookie en / ar honoured; missing / invalid / he → Hebrew', async () => {
    process.env.UI_LOCALE_ENABLED = '1'
    cookieJar.value = 'en'
    expect(await read()).toBe('en')
    cookieJar.value = 'ar'
    expect(await read()).toBe('ar')
    cookieJar.value = 'he'
    expect(await read()).toBe('he')
    cookieJar.value = 'xx'
    expect(await read()).toBe('he')
    cookieJar.value = undefined
    expect(await read()).toBe('he')
  })
  test('flag off (the kill switch) → Hebrew even with a cookie; the allowlist is not consulted (no user)', async () => {
    delete process.env.UI_LOCALE_ENABLED
    cookieJar.value = 'en'
    expect(await read()).toBe('he')
    process.env.UI_LOCALE_ENABLED = '0'
    expect(await read()).toBe('he')
  })
})

describe('the signed-in provider writes the hint', () => {
  async function mount(locale: 'he' | 'en' | 'ar', persistLocale?: boolean) {
    const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
    const writes: string[] = []
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!
    vi.spyOn(document, 'cookie', 'set').mockImplementation((v: string) => {
      writes.push(v)
      desc.set!.call(document, v)
    })
    render(
      <I18nProvider locale={locale} {...(persistLocale === undefined ? {} : { persistLocale })}>
        <p>x</p>
      </I18nProvider>,
    )
    return writes
  }

  test('en / ar: written with the exact attributes (http in jsdom → no Secure)', async () => {
    expect(await mount('en')).toEqual(['ui_locale=en; Path=/; SameSite=Lax; Max-Age=31536000'])
    expect(readUiLocaleCookie(document.cookie)).toBe('en')
    cleanup()
    vi.restoreAllMocks()
    expect(await mount('ar')).toEqual(['ui_locale=ar; Path=/; SameSite=Lax; Max-Age=31536000'])
    expect(readUiLocaleCookie(document.cookie)).toBe('ar')
  })

  test('he with the cookie present: removed', async () => {
    document.cookie = 'ui_locale=en; Path=/'
    expect(await mount('he')).toEqual(['ui_locale=; Path=/; SameSite=Lax; Max-Age=0'])
    expect(readUiLocaleCookie(document.cookie)).toBeNull()
  })

  test('he without the cookie: no write at all (non-pilot users unchanged)', async () => {
    expect(await mount('he')).toEqual([])
  })

  test('pre-login pages (persistLocale=false) never write, in any language', async () => {
    for (const l of ['en', 'ar', 'he'] as const) {
      expect(await mount(l, false)).toEqual([])
      cleanup()
      vi.restoreAllMocks()
    }
  })
})
