// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { preLoginEnv, resetPreLoginEnv } from './preLoginEnv'
import { magicLink, register, social } from './preLoginScenarios'

/**
 * Behaviour is identical in every language (i18n Phase F4): the sign-in,
 * registration and social-login scenarios of the Hebrew baseline are replayed
 * in en / ar and every recorded call — server actions with their exact
 * arguments, navigations, SDK calls, toast KINDS — must equal Hebrew's; only
 * the toast wording and the GIS button's own `locale` differ, and those are
 * checked to be translated. The consent form posts the same fields, the
 * registration form carries the same field names and namespaces.
 */

vi.mock('next/navigation', async () => (await import('./preLoginMocks')).navigationModule())
vi.mock('next/script', async () => (await import('./preLoginMocks')).scriptModule())
vi.mock('@/actions/auth', async () => (await import('./preLoginMocks')).authActionsModule())
vi.mock('@/actions/agencies', async () => (await import('./preLoginMocks')).agenciesActionsModule())
vi.mock('@/lib/toast', async () => (await import('./preLoginMocks')).toastModule())

beforeEach(() => {
  window.matchMedia = ((q: string) => ({
    matches: q.includes('1000px'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as never
})
afterEach(() => {
  cleanup()
  resetPreLoginEnv()
  vi.useRealTimers()
})

const HEBREW = /[֐-׿]/
type Calls = unknown[][]

/** Calls with the language-dependent parts set aside: toast text and the GIS button's own locale. */
function shape(calls: Calls) {
  return calls.map((c) => {
    if (c[0] === 'toast') return ['toast', c[1]]
    if (c[0] === 'gis.renderButton') return ['gis.renderButton', { ...(c[1] as object), locale: '·' }]
    return c
  })
}
function checkWording(calls: Calls, locale: 'en' | 'ar') {
  for (const c of calls) {
    if (c[0] === 'toast' && typeof c[2] === 'string') expect(c[2]).not.toMatch(HEBREW)
    if (c[0] === 'gis.renderButton') expect((c[1] as { locale: string }).locale).toBe(locale)
  }
}

type Setup = () => void
async function compare(run: (locale: 'he' | 'en' | 'ar') => Promise<{ calls: Calls }>, setup: Setup = () => {}) {
  const out: Record<string, Calls> = {}
  for (const locale of ['he', 'en', 'ar'] as const) {
    cleanup()
    resetPreLoginEnv()
    setup()
    out[locale] = (await run(locale)).calls
  }
  expect(shape(out.en)).toEqual(shape(out.he))
  expect(shape(out.ar)).toEqual(shape(out.he))
  checkWording(out.en, 'en')
  checkWording(out.ar, 'ar')
  return out
}

describe('the magic-link form sends the same thing in every language', () => {
  const cases: [string, Setup][] = [
    ['sent', () => {}],
    ['unknown user → registration', () => void (preLoginEnv.userExists = { fail: true, msg: 'המשתמש לא קיים' })],
    ['suspended', () => void (preLoginEnv.userExists = { fail: true, msg: 'המשתמש מושהה' })],
    ['send failed', () => void (preLoginEnv.sendToken = { ok: false, error: 'שליחת קישור ההתחברות נכשלה. נסה שוב בעוד רגע.' })],
    ['network', () => void (preLoginEnv.userExists = (() => Promise.reject(new Error('net'))) as never)],
  ]
  for (const [name, setup] of cases) test(name, async () => void (await compare((l) => magicLink(l), setup)))

  test('slow and timed-out toasts: same kinds, translated', async () => {
    vi.useFakeTimers()
    const out = await compare(
      (l) => magicLink(l, { advanceMs: 20_000, neverResolve: true }),
      () => void (preLoginEnv.userExists = (() => new Promise(() => {})) as never),
    )
    expect(out.en.filter((c) => c[0] === 'toast')).toEqual([
      ['toast', 'loading', 'This is taking longer than usual...'],
      ['toast', 'error', 'This is taking much longer than usual. Please try again.'],
    ])
  })

  test('the status line: a known server sentence is worded, an unknown one is shown as received in a Hebrew region', async () => {
    preLoginEnv.userExists = { fail: true, msg: 'המשתמש מושהה' }
    const known = await magicLink('en')
    expect(known.html).toContain('<p class="text-destructive text-sm">This user is suspended</p>')
    cleanup()
    resetPreLoginEnv()
    preLoginEnv.sendToken = { ok: false, error: 'שגיאה חדשה מהשרת' }
    const unknown = await magicLink('en')
    expect(unknown.html).toContain('<p class="text-destructive text-sm" lang="he" dir="rtl">שגיאה חדשה מהשרת</p>')
  })
})

describe('the registration form sends the same fields in every language', () => {
  const cases: [string, Setup][] = [
    ['accepted', () => {}],
    [
      'email invalid',
      () => void (preLoginEnv.addAgency = { error: 'כתובת האימייל לא תקינה. בדקו שהיא כתובה במלואה, למשל name@gmail.com' }),
    ],
    ['email taken', () => void (preLoginEnv.addAgency = { error: 'כתובת האימייל הזו כבר רשומה במערכת' })],
    ['network', () => void (preLoginEnv.addAgency = (() => Promise.reject(new Error('net'))) as never)],
  ]
  for (const [name, setup] of cases) {
    test(name, async () => {
      const out = await compare((l) => register(l), setup)
      expect(out.he.find((c) => c[0] === 'addAgency')).toBeTruthy()
    })
  }

  test('field names, namespaces, the required terms box and the terms link are unchanged', async () => {
    const fields = async (locale: 'he' | 'en' | 'ar') => {
      cleanup()
      const { default: AddAgencyForm } = await import('@/components/agencies/AddAgencyForm')
      const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
      const { container } = render(
        <I18nProvider locale={locale}>
          <AddAgencyForm />
        </I18nProvider>,
      )
      return {
        inputs: [...container.querySelectorAll('input')].map((i) => [
          i.closest('[data-prefix]')?.getAttribute('data-prefix') ?? '',
          i.name,
          i.type,
          i.required,
        ]),
        terms: [container.querySelector('#terms')!.hasAttribute('required'), container.querySelector('a')!.getAttribute('href')],
        labels: [...container.querySelectorAll('label')].map((l) => l.textContent),
      }
    }
    const he = await fields('he')
    for (const l of ['en', 'ar'] as const) {
      const out = await fields(l)
      expect([out.inputs, out.terms]).toEqual([he.inputs, he.terms])
      expect(out.labels.join(' ')).not.toMatch(HEBREW)
    }
  })
})

describe('social login sends the same thing in every language', () => {
  const fb =
    (res: unknown): Setup =>
    () =>
      void (preLoginEnv.checkFacebookUser = res as never)
  const gg =
    (res: unknown): Setup =>
    () =>
      void (preLoginEnv.checkUser = res as never)
  const cases: [string, 'facebook' | 'google', Setup][] = [
    ['facebook success', 'facebook', fb({ ok: true })],
    ['facebook register', 'facebook', fb({ fail: true, register: true, email: 'a@b.c', name: 'דנה' })],
    ['facebook no email', 'facebook', fb({ fail: true, msg: 'פייסבוק לא החזיר אימייל. אפשר להתחבר עם גוגל או עם מייל.' })],
    ['facebook suspended', 'facebook', fb({ fail: true, msg: 'המשתמש מושהה' })],
    ['facebook no msg', 'facebook', fb({ fail: true })],
    ['facebook throws', 'facebook', fb(() => Promise.reject(new Error('net')))],
    ['google success', 'google', gg({ ok: true })],
    ['google register', 'google', gg({ fail: true, register: true, email: 'a@b.c', name: 'דנה' })],
    ['google suspended', 'google', gg({ fail: true, msg: 'המשתמש מושהה' })],
    ['google throws', 'google', gg(() => Promise.reject(new Error('net')))],
  ]
  for (const [name, click, setup] of cases) test(name, async () => void (await compare((l) => social(l, { click }), setup)))

  test('the phone buttons: accessible names translated, the Facebook SDK still loads he_IL, scope unchanged', async () => {
    const out = await compare((l) => social(l, { phone: true, click: 'facebook' }))
    expect(out.en).toContainEqual(['script', 'https://connect.facebook.net/he_IL/sdk.js'])
    expect(out.en).toContainEqual(['FB.login', { scope: 'public_profile,email' }])
    cleanup()
    await social('ar', { phone: true })
    expect(screen.getByRole('button', { name: 'تسجيل الدخول باستخدام Facebook' })).toBeTruthy()
  })
})

describe('the consent form posts the same fields in every language', () => {
  test('approve / deny: one decision from the clicked button, the same csrf, the same action', async () => {
    const { default: ConsentCard } = await import('@/components/oauth/ConsentCard')
    const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
    const sent: Record<string, unknown[]> = {}
    for (const locale of ['he', 'en', 'ar'] as const) {
      sent[locale] = []
      for (const decision of ['approve', 'deny'] as const) {
        const { container } = render(
          <I18nProvider locale={locale}>
            <ConsentCard
              clientName='Claude'
              redirectHost='claude.ai'
              userName='דנה'
              agencyName=''
              scopes={['crm.leads.read']}
              csrf={'c'.repeat(32)}
              locale={locale}
            />
          </I18nProvider>,
        )
        const form = container.querySelector('form')!
        const submitter = container.querySelector(`[data-decision="${decision}"]`) as HTMLElement
        const listener = (e: Event) => {
          const data = new FormData(form, (e as SubmitEvent).submitter)
          sent[locale].push([form.method, form.getAttribute('action'), [...data.entries()], e.defaultPrevented])
          e.preventDefault()
        }
        document.addEventListener('submit', listener)
        const ev = new Event('submit', { bubbles: true, cancelable: true })
        Object.defineProperty(ev, 'submitter', { value: submitter })
        act(() => void form.dispatchEvent(ev))
        document.removeEventListener('submit', listener)
        expect(container.querySelector('[role="status"]')!.textContent).not.toBe('')
        if (locale !== 'he') expect(container.querySelector('[role="status"]')!.textContent).not.toMatch(HEBREW)
        cleanup()
      }
    }
    expect(sent.en).toEqual(sent.he)
    expect(sent.ar).toEqual(sent.he)
  })
})
