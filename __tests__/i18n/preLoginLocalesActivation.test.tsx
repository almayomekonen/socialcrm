// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SIGNED_IN, preLoginEnv, resetPreLoginEnv } from './preLoginEnv'
import { resolveAsync } from './dashboardHarness'
import { findHebrewLeaks } from './leakScan'

/**
 * Locale tests for `/activate` and `/oauth/consent` (i18n Phase F4): the REAL
 * pages in the signed-in user's interface language — every activation state,
 * the "workspace ready" screen, the phone handoff and its copy states, every
 * consent state; the region each declares; Hebrew identical without a usable
 * stored preference; the tab title; and the redirects / not-found are the same
 * in every language. Since the final UI audit both pages resolve the language
 * with `getUiLocaleState(user)` (flag + pilot allow-list + stored preference),
 * not the `ui_locale` cookie: a hand-set cookie changes nothing here.
 */

const H = vi.hoisted(() => ({ stored: null as string | null, reads: 0 }))
vi.mock('@/db/uiLocale', () => ({
  getUiLocalePrefs: async () => {
    H.reads++
    return { userLocale: H.stored, agencyLocale: null }
  },
}))

vi.mock('next/navigation', async () => (await import('./preLoginMocks')).navigationModule())
vi.mock('next/headers', async () => (await import('./preLoginMocks')).headersModule())
vi.mock('next/server', () => ({ connection: async () => {} }))
vi.mock('@/db/auth', async () => (await import('./preLoginMocks')).authDbModule())
vi.mock('@/config/db', async () => (await import('./preLoginMocks')).configDbModule())
vi.mock('@/lib/device', async () => (await import('./preLoginMocks')).deviceModule())
vi.mock('@/lib/activation/onboarding', async () => (await import('./preLoginMocks')).onboardingModule())
vi.mock('@/lib/activation/useActivationController', async () => (await import('./preLoginMocks')).activationControllerModule())
vi.mock('@/lib/flags/mobileFlags', async () => (await import('./preLoginMocks')).mobileFlagsModule())
vi.mock('@/lib/flags/mcpFlags', async () => (await import('./preLoginMocks')).mcpFlagsModule())
vi.mock('@/lib/clipboard', async () => (await import('./preLoginMocks')).clipboardModule())
vi.mock('@/actions/activation', async () => (await import('./preLoginMocks')).activationActionsModule())
vi.mock('@/lib/facebook/pixelEvents', () => ({ trackCompleteRegistration: () => {} }))
vi.mock('@/lib/oauth/server/pendingRequest', async () => (await import('./preLoginMocks')).oauthPendingModule())
vi.mock('@/lib/oauth/server/consentEligibility', async () => (await import('./preLoginMocks')).consentEligibilityModule())
vi.mock('@/lib/oauth/server/consentDecision', async (orig) => ({
  ...(await orig<object>()),
  isPendingRequestUsed: async () => (await import('./preLoginEnv')).preLoginEnv.pendingUsed,
}))

HTMLMediaElement.prototype.play = () => Promise.resolve()
window.matchMedia = ((media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} })) as never

const renderToString = (node: ReactNode) => renderRaw(<>{node}</>).replaceAll('<!-- -->', '')
const saved = { ...process.env }
afterEach(() => {
  cleanup()
  resetPreLoginEnv()
  process.env = { ...saved }
  Object.assign(H, { stored: null, reads: 0 })
})

/** The signed-in user's STORED preference (agency 103 in the pilot); no `ui_locale` cookie is set. */
function as(locale: string | null, flag = true) {
  if (flag) Object.assign(process.env, { UI_LOCALE_ENABLED: '1', UI_LOCALE_AGENCY_ALLOWLIST: '103' })
  else delete process.env.UI_LOCALE_ENABLED
  H.stored = locale
}

const PAGES = [
  { id: 'p1', name: 'סלון דנה' },
  { id: 'p2', name: 'סטודיו נועה' },
]
const STATUSES = [
  'waitingForActivation',
  'oauthPending',
  'selectingPage',
  'subscribingPage',
  'activationCompleted',
  'failed',
] as const
const REASONS = ['no_user', 'no_agency', 'suspended', 'not_allowlisted', 'trial_not_started', 'subscription_required'] as const

async function page(path: 'activate' | 'consent', env: Partial<typeof preLoginEnv> = {}) {
  Object.assign(preLoginEnv, { user: SIGNED_IN }, env)
  const mod = path === 'activate' ? await import('@/app/(he)/activate/page') : await import('@/app/(he)/oauth/consent/page')
  try {
    return await resolveAsync(await mod.default())
  } catch (e) {
    return (e as Error).message
  }
}

/** Every page state of both routes, as env overrides. */
const STATES: [string, 'activate' | 'consent', Partial<typeof preLoginEnv>][] = [
  ...STATUSES.map((status): [string, 'activate', Partial<typeof preLoginEnv>] => [
    status,
    'activate',
    {
      machine: { status, context: { pages: PAGES, selectedPageId: null, connectedPageName: 'סלון דנה', errorReason: 'denied' } },
    },
  ]),
  ['ready', 'activate', { alreadyConnected: true }],
  ['phone', 'activate', { mobile: true }],
  ['redirect desktop onboarded', 'activate', { onboarded: true }],
  ['redirect signed out', 'activate', { user: null }],
  ['card', 'consent', {}],
  ['card without business', 'consent', { agencyName: null }],
  ['expired', 'consent', { pending: null }],
  ['used', 'consent', { pendingUsed: true }],
  ['mcp off', 'consent', { mcp: false }],
  ...REASONS.map((reason): [string, 'consent', Partial<typeof preLoginEnv>] => [reason, 'consent', { eligibility: { reason } }]),
]

describe('Hebrew is untouched without a usable stored preference', () => {
  test('every state: invalid preference / he / en with the flag off = no preference', async () => {
    for (const [name, path, env] of STATES) {
      as(null)
      const reference = renderToString(await page(path, env))
      for (const [cookie, flag] of [
        ['xx', true],
        ['he', true],
        ['en', false],
      ] as const) {
        resetPreLoginEnv()
        as(cookie, flag)
        expect(renderToString(await page(path, env)), `${name} ${cookie}/${flag}`).toBe(reference)
      }
      resetPreLoginEnv()
    }
  })
})

const DATA = [
  { text: 'סלון דנה', reason: 'customer-data' as const },
  { text: 'סטודיו נועה', reason: 'external' as const },
  { text: 'דנה', reason: 'customer-data' as const },
]

describe('en / ar from the stored preference', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`${locale}: every state translated, its region declared, redirects identical`, async () => {
      for (const [name, path, env] of STATES) {
        as(null)
        const heOut = renderToString(await page(path, env))
        resetPreLoginEnv()
        as(locale)
        const tree = await page(path, env)
        if (typeof tree === 'string') {
          expect(tree, name).toBe(heOut) // REDIRECT … / NEXT_NOT_FOUND: same in every language
          resetPreLoginEnv()
          continue
        }
        const view = render(<>{tree}</>)
        expect(findHebrewLeaks(view.container, DATA), `${name} [${locale}]`).toEqual([])
        expect(view.container.querySelector(`[lang="${locale}"]`), name).not.toBeNull()
        expect(view.container.querySelector('[lang="he"]'), name).toBeNull()
        cleanup()
        resetPreLoginEnv()
      }
    })
  }

  test('en: the activation dialog, the ready screen and the consent wording', async () => {
    as('en')
    const ready = render(<>{await page('activate', { alreadyConnected: true })}</>)
    const dialog = ready.getByRole('dialog', { name: 'SocialCRM activation' })
    expect([dialog.getAttribute('lang'), dialog.getAttribute('dir')]).toEqual(['en', 'ltr'])
    expect(ready.getByRole('heading', { level: 1 }).textContent).toBe('Your workspace is ready')
    cleanup()
    const card = render(<>{await page('consent')}</>)
    expect(card.getByRole('heading', { level: 1 }).textContent).toBe('Connect Claude to SocialCRM')
    expect(card.getByRole('button', { name: 'Approve connection to Claude' })).toBeTruthy()
    expect(card.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(card.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'View your leads, your follow-ups and the daily summary',
      'View summaries of WhatsApp conversations with your leads, and the messages themselves on request',
    ])
    cleanup()
    const access = render(<>{await page('consent', { eligibility: { reason: 'trial_not_started' } })}</>)
    expect(access.container.textContent).toContain('Connecting Claude requires an active subscription or an active trial.')
    expect(access.getByRole('link', { name: 'Manage subscription' }).getAttribute('href')).toBe('/settings/update_payment')
    cleanup()
    const expired = render(<>{await page('consent', { pending: null })}</>)
    expect(expired.getByRole('heading', { level: 1 }).textContent).toBe('Connect an app to SocialCRM')
    expect(expired.getByRole('link', { name: 'Back to SocialCRM' }).getAttribute('href')).toBe('/dashboard')
  })

  test('ar: the phone handoff copy states and the consent pending lines', async () => {
    as('ar')
    for (const ok of [true, false]) {
      preLoginEnv.copyOk = ok
      const view = render(<>{await page('activate', { mobile: true, copyOk: ok })}</>)
      expect(view.getByRole('main').getAttribute('lang')).toBe('ar')
      fireEvent.click(view.getByRole('button', { name: 'نسخ رابط الدخول من الحاسوب' }))
      for (let i = 0; i < 3; i++) await act(async () => {})
      expect(view.getByRole('status').textContent).not.toBe('')
      expect(findHebrewLeaks(view.container, [])).toEqual([])
      cleanup()
    }
  })

  test('tab title', async () => {
    const consent = await import('@/app/(he)/oauth/consent/page')
    preLoginEnv.user = SIGNED_IN
    as(null)
    expect((await consent.generateMetadata()).title).toBe('חיבור אפליקציה ל-SocialCRM')
    as('en')
    expect((await consent.generateMetadata()).title).toBe('Connect an app to SocialCRM')
    as('ar')
    expect((await consent.generateMetadata()).title).toBe('ربط تطبيق بـ SocialCRM')
  })
})

describe('the language is the signed-in user\'s, never a hand-set cookie (final UI audit)', () => {
  const cookie = (v: string) => (preLoginEnv.cookies = { ...preLoginEnv.cookies, ui_locale: v })

  test('a non-pilot user with a hand-set ui_locale=en / ar cookie sees byte-identical Hebrew; nothing is read', async () => {
    for (const [name, path, env] of STATES) {
      const reference = renderToString(await page(path, env))
      for (const v of ['en', 'ar']) {
        resetPreLoginEnv()
        Object.assign(process.env, { UI_LOCALE_ENABLED: '1', UI_LOCALE_AGENCY_ALLOWLIST: '999' })
        cookie(v)
        expect(renderToString(await page(path, env)), `${name} cookie ${v}`).toBe(reference)
      }
      resetPreLoginEnv()
      process.env = { ...saved }
    }
    expect(H.reads).toBe(0)
    const consent = await import('@/app/(he)/oauth/consent/page')
    preLoginEnv.user = SIGNED_IN
    cookie('en')
    expect((await consent.generateMetadata()).title).toBe('חיבור אפליקציה ל-SocialCRM')
  })

  test('a pilot user without a stored preference stays Hebrew whatever the cookie says', async () => {
    for (const path of ['activate', 'consent'] as const) {
      const reference = renderToString(await page(path))
      resetPreLoginEnv()
      as(null)
      cookie('en')
      expect(renderToString(await page(path)), path).toBe(reference)
      resetPreLoginEnv()
    }
  })

  test('a pilot user with English stored sees English without any cookie; a cookie saying ar is ignored', async () => {
    for (const path of ['activate', 'consent'] as const) {
      for (const c of [null, 'ar']) {
        resetPreLoginEnv()
        as('en')
        if (c) cookie(c)
        expect(preLoginEnv.cookies.ui_locale ?? null).toBe(c)
        const view = render(<>{await page(path)}</>)
        expect(view.container.querySelector('[lang="en"]'), `${path} ${c}`).not.toBeNull()
        expect(view.container.querySelector('[lang="ar"]'), `${path} ${c}`).toBeNull()
        expect(findHebrewLeaks(view.container, DATA), `${path} ${c}`).toEqual([])
        cleanup()
      }
    }
    const consent = await import('@/app/(he)/oauth/consent/page')
    preLoginEnv.user = SIGNED_IN
    expect((await consent.generateMetadata()).title).toBe('Connect an app to SocialCRM')
  })

  test('the kill switch: flag off → Hebrew even with English stored and an English cookie', async () => {
    for (const path of ['activate', 'consent'] as const) {
      const reference = renderToString(await page(path))
      resetPreLoginEnv()
      as('en', false)
      cookie('en')
      expect(renderToString(await page(path)), path).toBe(reference)
      resetPreLoginEnv()
    }
    expect(H.reads).toBe(0)
  })
})
