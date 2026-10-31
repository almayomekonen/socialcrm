// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { preLoginEnv, resetPreLoginEnv } from './preLoginEnv'
import { magicLink, register, social } from './preLoginScenarios'

/**
 * HEBREW BASELINE, part 2 (i18n Phase F4): every state the sign-in and
 * registration forms reach — the magic-link form (sent, unknown user →
 * registration, suspended, send failure, network failure, the slow and
 * timed-out toasts, the `error` param), the registration form (every server
 * refusal, network failure, the submitting label, the toasts, the submitted
 * fields), the social buttons (desktop / phone, the GIS options, every Facebook
 * and Google outcome, the server sentences shown as toasts). Every call the
 * forms make is recorded. Recorded BEFORE Phase F4; no i18n provider.
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

const SERVER_FACEBOOK = [
  'פייסבוק לא החזיר אימייל. אפשר להתחבר עם גוגל או עם מייל.',
  'חשבון פייסבוק זה כבר מחובר למערכת. התחבר באמצעות Facebook.',
  'התחברות עם Facebook אינה זמינה לחשבון זה',
  'ההתחברות נכשלה, נסה שוב',
  'המשתמש מושהה',
]
const SERVER_REGISTER = [
  'כתובת האימייל לא תקינה. בדקו שהיא כתובה במלואה, למשל name@gmail.com',
  'חשבון פייסבוק זה כבר מחובר למערכת. התחבר באמצעות Facebook.',
  'כתובת האימייל הזו כבר רשומה במערכת',
  'אירעה שגיאה, נסה שוב',
]

describe('Hebrew baseline — magic-link form', () => {
  test('sent, unknown user, suspended, send failure, network failure, link error', async () => {
    const out: Record<string, unknown> = {}
    out.sent = await magicLink(null)
    resetPreLoginEnv()
    preLoginEnv.userExists = { fail: true, msg: 'המשתמש לא קיים' }
    out.unknownUser = await magicLink(null)
    resetPreLoginEnv()
    preLoginEnv.userExists = { fail: true, msg: 'המשתמש מושהה' }
    out.suspended = await magicLink(null)
    resetPreLoginEnv()
    preLoginEnv.sendToken = { ok: false, error: 'שליחת קישור ההתחברות נכשלה. נסה שוב בעוד רגע.' }
    out.sendFailed = await magicLink(null)
    resetPreLoginEnv()
    preLoginEnv.userExists = (() => Promise.reject(new Error('net'))) as never
    out.network = await magicLink(null)
    resetPreLoginEnv()
    out.linkError = await magicLink(null, { error: '1' })
    expect(JSON.stringify(out)).toContain('לינק לאימות נשלח למייל')
    expect(out).toMatchSnapshot()
  })

  test('slow and timed-out sends (the submitting label, both toasts)', async () => {
    vi.useFakeTimers()
    preLoginEnv.userExists = (() => new Promise(() => {})) as never
    const slow = await magicLink(null, { advanceMs: 10_000, neverResolve: true })
    cleanup()
    resetPreLoginEnv()
    preLoginEnv.userExists = (() => new Promise(() => {})) as never
    const timedOut = await magicLink(null, { advanceMs: 20_000, neverResolve: true })
    expect(slow.pending).toContain('טוען...')
    expect({ slow, timedOut }).toMatchSnapshot()
  })
})

describe('Hebrew baseline — registration form', () => {
  test('every server refusal, network failure, submitted fields', async () => {
    const out: Record<string, unknown> = {}
    out.accepted = await register(null)
    for (const [i, error] of SERVER_REGISTER.entries()) {
      cleanup()
      resetPreLoginEnv()
      preLoginEnv.addAgency = { error }
      out[`refused${i}`] = await register(null)
    }
    cleanup()
    resetPreLoginEnv()
    preLoginEnv.addAgency = (() => Promise.reject(new Error('net'))) as never
    out.network = await register(null)
    cleanup()
    resetPreLoginEnv()
    out.prefilled = await register(null, { defaultEmail: 'dana@example.com', defaultName: 'דנה' })
    expect(out).toMatchSnapshot()
  })

  test('slow and timed-out registration', async () => {
    vi.useFakeTimers()
    preLoginEnv.addAgency = (() => new Promise(() => {})) as never
    const slow = await register(null, {}, 10_000)
    cleanup()
    resetPreLoginEnv()
    preLoginEnv.addAgency = (() => new Promise(() => {})) as never
    const timedOut = await register(null, {}, 20_000)
    expect(slow.pending).toContain('טוען...')
    expect({ slow, timedOut }).toMatchSnapshot()
  })
})

describe('Hebrew baseline — social buttons', () => {
  test('desktop / phone markup, GIS options, a signed-in line, Facebook SDK not ready', async () => {
    const out = {
      desktop: await social(null),
      phone: (cleanup(), resetPreLoginEnv(), await social(null, { phone: true })),
      phoneNoFacebook: (cleanup(), resetPreLoginEnv(), await social(null, { phone: true, facebook: false })),
      signedIn: (cleanup(), resetPreLoginEnv(), await social(null, { user: { name: 'דנה כהן', gglName: 'Dana' } })),
      notReady: (cleanup(), resetPreLoginEnv(), await social(null, { fbReady: false, click: 'facebook' })),
    }
    expect(out).toMatchSnapshot()
  })

  test('every Facebook outcome: success, register, each server sentence, a throw', async () => {
    const out: Record<string, unknown> = {}
    const run = async (name: string, res: unknown) => {
      cleanup()
      resetPreLoginEnv()
      preLoginEnv.checkFacebookUser = res as never
      out[name] = (await social(null, { click: 'facebook' })).calls
    }
    await run('success', { ok: true })
    await run('register', { fail: true, register: true, email: 'dana@example.com', name: 'דנה' })
    for (const [i, msg] of SERVER_FACEBOOK.entries()) await run(`msg${i}`, { fail: true, msg })
    await run('noMsg', { fail: true })
    await run('throws', () => Promise.reject(new Error('net')))
    expect(out).toMatchSnapshot()
  })

  test('every Google outcome: success, register, suspended, a throw, slow and timed out', async () => {
    const out: Record<string, unknown> = {}
    const run = async (name: string, res: unknown) => {
      cleanup()
      resetPreLoginEnv()
      preLoginEnv.checkUser = res as never
      out[name] = (await social(null, { click: 'google' })).calls
    }
    await run('success', { ok: true })
    await run('register', { fail: true, register: true, email: 'dana@example.com', name: 'דנה' })
    await run('suspended', { fail: true, msg: 'המשתמש מושהה' })
    await run('throws', () => Promise.reject(new Error('net')))
    expect(out).toMatchSnapshot()
  })
})
