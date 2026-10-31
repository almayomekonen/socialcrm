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
 * pages under the `ui_locale` cookie — every activation state, the "workspace
 * ready" screen, the phone handoff and its copy states, every consent state;
 * the region each declares; Hebrew identical without a usable cookie; the tab
 * title; and the redirects / not-found are the same in every language.
 */

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
})

function as(locale: string | null, flag = true) {
  if (flag) process.env.UI_LOCALE_ENABLED = '1'
  else delete process.env.UI_LOCALE_ENABLED
  preLoginEnv.cookies = { ...preLoginEnv.cookies, ...(locale === null ? {} : { ui_locale: locale }) }
  if (locale === null) delete preLoginEnv.cookies.ui_locale
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
  const mod = path === 'activate' ? await import('@/app/activate/page') : await import('@/app/oauth/consent/page')
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

describe('Hebrew is untouched without a usable cookie', () => {
  test('every state: invalid cookie / he / en with the flag off = no cookie', async () => {
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

describe('en / ar from the cookie', () => {
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
    const consent = await import('@/app/oauth/consent/page')
    as(null)
    expect((await consent.generateMetadata()).title).toBe('חיבור אפליקציה ל-SocialCRM')
    as('en')
    expect((await consent.generateMetadata()).title).toBe('Connect an app to SocialCRM')
    as('ar')
    expect((await consent.generateMetadata()).title).toBe('ربط تطبيق بـ SocialCRM')
  })
})
