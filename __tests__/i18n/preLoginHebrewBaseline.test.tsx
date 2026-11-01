// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { act, cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SIGNED_IN, preLoginEnv, resetPreLoginEnv } from './preLoginEnv'
import { resolveAsync } from './dashboardHarness'

/**
 * HEBREW BASELINE, part 1 (i18n Phase F4): the REAL `/auth` and `/auth/register`
 * pages (desktop / phone, Facebook login on / off, signed-in Google line, the
 * magic-link `error` param, prefilled registration), the three pre-login layouts
 * (`(auth)`, `activate`, `oauth`), the pages' metadata, and the root
 * `ChunkReloader` overlay. Recorded BEFORE Phase F4; Hebrew must match
 * byte-for-byte afterwards. Interactions: …Interactions.test.tsx; activation and
 * OAuth consent: …Activation.test.tsx.
 *
 * No i18n provider, no locale cookie. Normalized: React's `<!-- -->` only.
 */

vi.mock('next/navigation', async () => (await import('./preLoginMocks')).navigationModule())
vi.mock('next/headers', async () => (await import('./preLoginMocks')).headersModule())
vi.mock('next/script', () => ({ default: () => null }))
vi.mock('@/db/auth', async () => (await import('./preLoginMocks')).authDbModule())
vi.mock('@/lib/device', async () => (await import('./preLoginMocks')).deviceModule())
vi.mock('@/lib/auth/facebookUserAuthFlags', async () => (await import('./preLoginMocks')).facebookAuthFlagsModule())
vi.mock('@/actions/auth', async () => (await import('./preLoginMocks')).authActionsModule())
vi.mock('@/actions/agencies', async () => (await import('./preLoginMocks')).agenciesActionsModule())
// The consent page's module graph (its metadata is recorded here; the page itself in …Activation).
vi.mock('@/config/db', async () => (await import('./preLoginMocks')).configDbModule())
vi.mock('next/server', () => ({ connection: async () => {} }))
vi.mock('@/lib/toast', async () => (await import('./preLoginMocks')).toastModule())

const renderToString = (node: ReactNode) => renderRaw(<>{node}</>).replaceAll('<!-- -->', '')

afterEach(() => {
  cleanup()
  resetPreLoginEnv()
  vi.useRealTimers()
})

async function authPage(env: Partial<typeof preLoginEnv> = {}, search: Record<string, string> = {}) {
  Object.assign(preLoginEnv, env)
  const { default: Page } = await import('@/app/(he)/(auth)/auth/page')
  return renderToString(await resolveAsync(await Page({ searchParams: Promise.resolve(search) })))
}

async function registerPage(env: Partial<typeof preLoginEnv> = {}, search: Record<string, string> = {}) {
  Object.assign(preLoginEnv, env)
  const { default: Page } = await import('@/app/(he)/(auth)/auth/register/page')
  return renderToString(await resolveAsync(await Page({ searchParams: Promise.resolve(search) })))
}

/** A page's metadata, whether it is a constant or (after Phase F4) produced per request. */
async function metadataOf(mod: { metadata?: unknown; generateMetadata?: () => Promise<unknown> }) {
  return mod.generateMetadata ? await mod.generateMetadata() : mod.metadata
}

describe('Hebrew baseline — /auth', () => {
  test('desktop / phone, Facebook on / off, signed in, magic-link error', async () => {
    const out = {
      desktop: await authPage(),
      desktopNoFacebook: await authPage({ facebookAuth: false }),
      phone: await authPage({ mobile: true }),
      phoneNoFacebook: await authPage({ mobile: true, facebookAuth: false }),
      signedIn: await authPage({ user: SIGNED_IN }),
      linkError: await authPage({}, { error: '1' }),
    }
    expect(out.desktop).toContain('ברוך שובך')
    expect(out.signedIn).toContain('כניסה בשם')
    expect(out.linkError).toContain('הקישור אינו תקין או שפג תוקפו')
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — /auth/register', () => {
  test('desktop / phone, Facebook on / off, prefilled from a social sign-in', async () => {
    const out = {
      desktop: await registerPage(),
      desktopNoFacebook: await registerPage({ facebookAuth: false }),
      phone: await registerPage({ mobile: true }),
      prefilled: await registerPage({}, { email: 'dana@example.com', name: 'דנה' }),
    }
    expect(out.desktop).toContain('צור חשבון')
    expect(out.desktop).toContain('אני מסכים לתנאי השימוש')
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — pre-login layouts and metadata', () => {
  test('the (auth), activate and oauth layouts', async () => {
    const { default: AuthLayout } = await import('@/app/(he)/(auth)/layout')
    const { default: ActivateLayout } = await import('@/app/(he)/activate/layout')
    const { default: OAuthLayout } = await import('@/app/(he)/oauth/layout')
    const out = {
      auth: renderToString(await resolveAsync(<AuthLayout>child</AuthLayout>)),
      activate: renderToString(await resolveAsync(<ActivateLayout>child</ActivateLayout>)),
      oauth: renderToString(await resolveAsync(<OAuthLayout>child</OAuthLayout>)),
    }
    expect(out.auth).toContain('lang="he"')
    expect(out).toMatchSnapshot()
  })

  test('tab titles and the sign-in page metadata', async () => {
    const out = {
      auth: await metadataOf(await import('@/app/(he)/(auth)/auth/page')),
      register: await metadataOf(await import('@/app/(he)/(auth)/auth/register/page')),
      consent: await metadataOf(await import('@/app/(he)/oauth/consent/page')),
    }
    expect(JSON.stringify(out)).toContain('התחברות')
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — ChunkReloader (root layout)', () => {
  test('nothing until a chunk fails, then the reloading overlay', async () => {
    vi.useFakeTimers()
    try {
      sessionStorage.clear()
    } catch {}
    const { default: ChunkReloader } = await import('@/lib/ChunkReloader')
    const { container } = render(<ChunkReloader />)
    const idle = container.innerHTML
    act(() => {
      window.dispatchEvent(new ErrorEvent('error', { message: 'ChunkLoadError: Loading chunk 12 failed' }))
    })
    const reloading = container.innerHTML
    expect(idle).toBe('')
    expect(reloading).toContain('עדכון חדש נטען')
    expect({ idle, reloading }).toMatchSnapshot()
  })
})
