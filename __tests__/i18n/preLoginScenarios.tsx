import { vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import { preLoginEnv } from './preLoginEnv'

/**
 * Scripted taps on the pre-login screens (i18n Phase F4), shared by the Hebrew
 * baseline and the behaviour tests: each scenario renders the REAL component,
 * drives it, and returns the visible outcome (the form's text, toasts, recorded
 * server calls and navigations). The behaviour tests replay the same scenario in
 * en / ar and compare every recorded call with Hebrew's.
 */

export type Outcome = { html: string; calls: unknown[][] }

async function wrap(locale: UiLocale | null, node: ReactNode) {
  if (!locale) return node
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  return <I18nProvider locale={locale}>{node}</I18nProvider>
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => {})
}

/** The magic-link form: type an e-mail, submit, let the actions settle (optionally advance the slow/timeout timers). */
export async function magicLink(
  locale: UiLocale | null,
  opts: { error?: string; advanceMs?: number; neverResolve?: boolean } = {},
) {
  const { default: LoginMagicLink } = await import('@/components/auth/LoginMagicLink')
  const view = render(await wrap(locale, <LoginMagicLink error={opts.error} />))
  const initial = view.container.innerHTML
  const input = view.container.querySelector('input[name="email"]') as HTMLInputElement
  fireEvent.change(input, { target: { value: 'dana@example.com' } })
  fireEvent.submit(view.container.querySelector('form')!)
  if (!opts.neverResolve) await flush()
  const pending = view.container.innerHTML
  if (opts.advanceMs) {
    await act(async () => {
      vi.advanceTimersByTime(opts.advanceMs!)
    })
  }
  return { initial, html: view.container.innerHTML, pending, calls: [...preLoginEnv.calls] }
}

/** The registration form: fill every field, tick the terms, submit. */
export async function register(
  locale: UiLocale | null,
  props: { defaultEmail?: string; defaultName?: string } = {},
  advanceMs = 0,
) {
  const { default: AddAgencyForm } = await import('@/components/agencies/AddAgencyForm')
  const view = render(await wrap(locale, <AddAgencyForm {...props} />))
  const set = (sel: string, value: string) => fireEvent.change(view.container.querySelector(sel)!, { target: { value } })
  set('[data-prefix="agency"] input[name="name"]', 'סטודיו נועה')
  set('input[name="firstName"]', 'נועה')
  set('input[name="lastName"]', 'לוי')
  set('input[name="email"]', 'noa@example.com')
  fireEvent.click(view.container.querySelector('#terms')!)
  fireEvent.submit(view.container.querySelector('form')!)
  const pending = view.container.innerHTML
  await flush()
  if (advanceMs) {
    await act(async () => {
      vi.advanceTimersByTime(advanceMs)
    })
  }
  return { html: view.container.innerHTML, pending, calls: [...preLoginEnv.calls] }
}

type FbResponse = { status?: string; authResponse?: { accessToken?: string } }

/**
 * The social buttons. `google` holds the GIS callback captured from
 * `google.accounts.id.initialize`; `FB` answers `FB.login` with `fbResponse`.
 * `next/script` is mocked to fire `onLoad` on mount (see the test files).
 */
export async function social(
  locale: UiLocale | null,
  opts: {
    phone?: boolean
    facebook?: boolean
    fbReady?: boolean
    click?: 'facebook' | 'google' | null
    fbResponse?: FbResponse
    advanceMs?: number
    user?: { name?: string; gglName?: string }
  } = {},
) {
  let gisCallback: ((u: { credential: string }) => Promise<void>) | null = null
  ;(globalThis as Record<string, unknown>).google = {
    accounts: {
      id: {
        initialize: (o: { callback: typeof gisCallback }) => {
          gisCallback = o.callback
          preLoginEnv.calls.push(['gis.initialize', Object.keys(o).sort()])
        },
        renderButton: (_el: unknown, o: unknown) => preLoginEnv.calls.push(['gis.renderButton', o]),
      },
    },
  }
  ;(window as unknown as Record<string, unknown>).FB =
    opts.fbReady === false
      ? undefined
      : {
          init: (o: unknown) => preLoginEnv.calls.push(['FB.init', o]),
          login: (cb: (r: FbResponse) => void, o: unknown) => {
            preLoginEnv.calls.push(['FB.login', o])
            cb(opts.fbResponse ?? { status: 'connected', authResponse: { accessToken: 'tok' } })
          },
        }
  const { default: Login } = await import('@/components/auth/Login')
  const view = render(
    await wrap(
      locale,
      <Login user={opts.user} facebookAppId={opts.facebook === false ? undefined : '42'} matchSocialButtons={opts.phone} />,
    ),
  )
  await flush()
  if (opts.click === 'facebook') fireEvent.click(view.container.querySelector('button[type="button"]')!)
  if (opts.click === 'google') await act(async () => void (await gisCallback?.({ credential: 'cred' })))
  await flush()
  if (opts.advanceMs) {
    await act(async () => {
      vi.advanceTimersByTime(opts.advanceMs!)
    })
  }
  return {
    html: view.container.innerHTML,
    calls: [...preLoginEnv.calls],
    names: screen.queryAllByRole('button').map((b) => b.textContent),
  }
}
