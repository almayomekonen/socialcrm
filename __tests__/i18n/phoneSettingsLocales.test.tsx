// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import type { UiLocale } from '@/lib/i18n/config'
import { NOW, PENDING_PAGES, SETTINGS_CUSTOMER_DATA, resetSetEnv, setEnv } from './settingsEnv'
import { setShell, settingsPage } from './settingsHarness'
import { findHebrewLeaks } from './leakScan'

/**
 * The phone Integrations and ready messages in English and Arabic (i18n
 * Phase F2): the REAL `/settings/integrations` page on a phone — landing
 * cards for every state, OAuth returns, the manage sheets, the one-tap
 * completion toasts, the ready-messages screen, detail sheet, editor and its
 * validation, confirmations and toasts — plus `/settings/update_security`'s
 * phone list, region lang/dir, hydration in he / en / ar, a language switch,
 * and every opened sheet scanned for untranslated Hebrew (sheets are
 * portalled, outside the leak gate's container). The same taps send the same
 * arguments in every language.
 */

vi.mock('next/navigation', async () => {
  const nav = (await import('./settingsMocks')).navigationModule()
  const router = nav.useRouter()
  return { ...nav, useRouter: () => router }
})
vi.mock('next/headers', async () => (await import('./settingsMocks')).headersModule())
vi.mock('@/db/auth', async () => (await import('./settingsMocks')).authModule())
vi.mock('@/lib/requireUser', async () => (await import('./settingsMocks')).requireUserModule())
const prefs = vi.hoisted(() => ({ userLocale: null as string | null }))
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: prefs.userLocale, agencyLocale: null }) }))
vi.mock('@/lib/device', async () => (await import('./settingsMocks')).deviceModule())
vi.mock('@/lib/access/productAccess', async () => (await import('./settingsMocks')).productAccessModule())
vi.mock('@/config/db', async () => (await import('./settingsMocks')).configDbModule())
vi.mock('@/lib/facebook/pendingPages', async () => (await import('./settingsMocks')).pendingPagesModule())
vi.mock('@/lib/facebook/health', async () => (await import('./settingsMocks')).facebookHealthModule())
vi.mock('@/lib/facebook/pageToken', async () => (await import('./settingsMocks')).pageTokenModule())
vi.mock('@/db/facebook', async () => (await import('./settingsMocks')).facebookDbModule())
vi.mock('@/lib/facebook/comments/capability', async () => (await import('./settingsMocks')).commentsCapabilityModule())
vi.mock('@/lib/whatsapp/registration', async () => (await import('./settingsMocks')).registrationModule())
vi.mock('@/lib/whatsapp/operationalStatus', async () => (await import('./settingsMocks')).operationalStatusModule())
vi.mock('@/db/whatsapp', async () => (await import('./settingsMocks')).whatsappDbModule())
vi.mock('@/lib/whatsapp/templates/flag', async () => (await import('./settingsMocks')).templatesFlagModule())
vi.mock('@/db/whatsappTemplates', async () => (await import('./settingsMocks')).templatesDbModule())
vi.mock('@/components/settings/messenger/messengerSectionData', async () => (await import('./settingsMocks')).messengerSectionModule())
vi.mock('@/lib/automations/flags', async () => (await import('./settingsMocks')).automationsFlagsModule())
vi.mock('@/db/googleCalendarConnections', async () => (await import('./settingsMocks')).calendarConnModule())
vi.mock('@/lib/flags/mcpFlags', async () => (await import('./settingsMocks')).mcpFlagsModule())
vi.mock('@/lib/oauth/server/connections', async () => (await import('./settingsMocks')).aiConnectionsModule())
vi.mock('@/lib/oauth/server/config', async () => (await import('./settingsMocks')).oauthConfigModule())
vi.mock('@/lib/facebook/useEmbeddedSignup', async () => (await import('./settingsMocks')).embeddedSignupModule())
vi.mock('@/modules/inbox/client/useAdaptivePoll', async () => (await import('./settingsMocks')).adaptivePollModule())
vi.mock('@/actions/whatsapp/templates/createTemplate', async () => (await import('./settingsMocks')).templatesActionsModules.create())
vi.mock('@/actions/whatsapp/templates/retryTemplate', async () => (await import('./settingsMocks')).templatesActionsModules.retry())
vi.mock('@/actions/whatsapp/templates/archiveTemplate', async () => (await import('./settingsMocks')).templatesActionsModules.archive())
vi.mock('@/actions/whatsapp/templates/discardTemplate', async () => (await import('./settingsMocks')).templatesActionsModules.discard())
vi.mock('@/modules/messenger/profileActions', async () => (await import('./settingsMocks')).messengerProfileActionsModule())
vi.mock('@/modules/messenger/savedReplyActions', async () => (await import('./settingsMocks')).savedReplyActionsModule())
vi.mock('@/actions/oauthGrants', async () => (await import('./settingsMocks')).oauthGrantsActionsModule())

vi.mock('@/lib/toast', async () => (await import('./settingsMocks')).toastModule())
vi.mock('@/db/usersNTeams', async () => (await import('./settingsMocks')).usersNTeamsDbModule())
vi.mock('@/db/loginActivity', async () => (await import('./settingsMocks')).loginActivityModule())
vi.mock('@/lib/auth/facebookUserAuthFlags', async () => (await import('./settingsMocks')).facebookUserAuthFlagsModule())
vi.mock('@/actions/usersNteams', async () => (await import('./settingsMocks')).usersNteamsActionsModule())

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let fetchAnswer: (url: string) => Response = () => new Response(JSON.stringify({ connected: false }))
const saved = { ...process.env }
beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  globalThis.fetch = vi.fn(async (url: string) => fetchAnswer(String(url))) as unknown as typeof fetch
})
afterAll(() => vi.useRealTimers())
beforeEach(() => {
  process.env.UI_LOCALE_ENABLED = '1'
  process.env.UI_LOCALE_AGENCY_ALLOWLIST = '103'
})
afterEach(() => {
  cleanup()
  process.env = { ...saved }
  resetSetEnv()
  prefs.userLocale = null
  fetchAnswer = () => new Response(JSON.stringify({ connected: false }))
})

const dialog = () => [...document.querySelectorAll('[role="dialog"]')].at(-1)!
const click = async (el: Element) => act(async () => fireEvent.click(el))
const flush = async () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const set = (o: Partial<typeof setEnv>) => Object.assign(setEnv, o)
const allowed = SETTINGS_CUSTOMER_DATA.map((text) => ({ text, reason: 'customer-data' as const }))
const noLeaks = (root: Element = dialog()) => expect(findHebrewLeaks(root, allowed)).toEqual([])
const tree = async (locale: UiLocale, sp: Record<string, string> = {}, page: 'integrations' | 'security' = 'integrations') => {
  prefs.userLocale = locale
  set({ mobile: true, searchParams: sp })
  return setShell(locale, await settingsPage(page))
}
const mount = async (locale: UiLocale, sp: Record<string, string> = {}) => render(await tree(locale, sp))
const toasts = () => {
  const t = setEnv.calls.filter((c) => c[0] === 'toast' || c[0] === 'proToast')
  setEnv.calls = setEnv.calls.filter((c) => c[0] !== 'toast' && c[0] !== 'proToast')
  return t
}
const cards = () => [...screen.getByTestId('integrations-mobile').querySelectorAll('article')]

describe('the phone Integrations landing', () => {
  test('English: header, sections, every card, region; each manage sheet', async () => {
    fetchAnswer = () => new Response(JSON.stringify({ connected: true, email: 'dana@gmail.test' }))
    const { container } = await mount('en')
    await flush()
    const root = screen.getByTestId('integrations-mobile')
    expect(root.getAttribute('lang')).toBe('en')
    expect(root.getAttribute('dir')).toBe('ltr')
    for (const s of ['Integrations', 'Lead sources', 'Connected tools', 'Facebook and Instagram', 'Ready messages', 'Connected', 'Manage', 'Connected · dana@gmail.test'])
      expect(root.textContent, s).toContain(s)
    expect(root.textContent).toContain('1 ready to send · 1 in review')
    expect(root.textContent).toContain('3 messages')
    noLeaks(container)
    for (const card of cards()) {
      const button = card.querySelector('button')
      if (!button) continue
      await click(button)
      expect(dialog().getAttribute('lang')).toBe('en')
      noLeaks()
      await click(dialog().querySelector('button[aria-label]')!)
    }
  })

  test('Arabic: nothing connected, plurals, calendar re-auth', async () => {
    set({ fbPage: null, waConnection: null, calendar: { google_email: 'x@y.z', sync_status: 'reauth_required', last_error: null } })
    const { container } = await mount('ar')
    const root = screen.getByTestId('integrations-mobile')
    expect(root.getAttribute('dir')).toBe('rtl')
    expect(root.textContent).toContain('غير مرتبط')
    expect(root.textContent).toContain('بانتظار الربط')
    noLeaks(container)
    await click(cards()[0].querySelector('button')!)
    expect(dialog().textContent).toContain('يلزم ربط WhatsApp')
    noLeaks()
  })

  test('every WhatsApp health status and OAuth return is worded (en, ar)', async () => {
    for (const locale of ['en', 'ar'] as const) {
      for (const waStatus of ['registration_pending', 'restricted', 'token', 'webhook', 'throttled', 'unknown']) {
        resetSetEnv()
        set({ waStatus })
        const { container } = await mount(locale)
        noLeaks(container)
        cleanup()
      }
      for (const sp of [{ error: 'denied' }, { error: 'no_pages' }, { select: '1' }, { wa_error: 'cancelled' }, { wa_error: 'no_phones' }, { gcal_error: 'denied' }, { gcal_error: 'x' }, { gdrive_error: 'denied' }, { gcal: 'connected' }]) {
        resetSetEnv()
        set({ fbPage: null, waConnection: null, calendar: null })
        const { container } = await mount(locale, sp)
        noLeaks(container)
        cleanup()
      }
    }
  })

  test('the one-tap completion toasts follow the language', async () => {
    fetchAnswer = (url) => (url.includes('/connect') ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ connected: false })))
    set({ fbPage: null, pendingPages: PENDING_PAGES.slice(0, 1) })
    await mount('en')
    await flush()
    expect(toasts()).toEqual([['toast', 'error', "We couldn't complete the Facebook connection. You can choose a Page manually."]])
  })
})

describe('the phone ready messages', () => {
  test('English: screen, rows, detail per status, editor, validation, confirmations, toasts', async () => {
    await mount('en', { section: 'templates' })
    const root = screen.getByTestId('ready-messages-mobile')
    expect(root.getAttribute('lang')).toBe('en')
    for (const s of ['Back to Integrations', 'Ready messages', 'New ready message', 'Ready to send', 'Update', 'Offer']) expect(root.textContent, s).toContain(s)
    expect(root.querySelector('a [class*="-scale-x-100"]')).toBeTruthy()
    noLeaks(root)
    for (const title of ['תזכורת פגישה', 'מבצע חגים', 'הצעה אחרונה']) {
      await click(screen.getAllByText(title).find((e) => e.closest('[data-testid="ready-messages-mobile"]'))!)
      expect(dialog().getAttribute('lang')).toBe('en')
      noLeaks()
      await click(dialog().querySelector('button[aria-label]')!)
    }
    await click(screen.getByText('New ready message'))
    noLeaks()
    fireEvent.change(dialog().querySelector('input')!, { target: { value: 'x'.repeat(600) } })
    fireEvent.change(dialog().querySelector('textarea')!, { target: { value: 'hi' } })
    fireEvent.click(dialog().querySelector('input[type="radio"]')!)
    await act(async () => fireEvent.submit(dialog().querySelector('form')!))
    expect(dialog().querySelector('[role="alert"]')!.textContent).toMatch(/too long/i)
    fireEvent.change(dialog().querySelector('input')!, { target: { value: 'Reminder' } })
    await act(async () => fireEvent.submit(dialog().querySelector('form')!))
    await flush()
    expect(toasts()[0][1]).toBe('success')
    await click(screen.getAllByText('מבצע חגים').find((e) => e.closest('[data-testid="ready-messages-mobile"]'))!)
    await click(screen.getByText('Delete message'))
    expect(dialog().textContent).toContain('Delete "מבצע חגים"?')
    noLeaks()
  })

  test('Arabic: not connected and not ready screens', async () => {
    set({ waConnection: null })
    const a = await mount('ar', { section: 'templates' })
    noLeaks(a.container)
    expect(a.container.textContent).toContain('العودة إلى التكاملات')
    cleanup()
    set({ waConnection: { phone_number_id: 'ph1', access_token: 'sealed' }, waReady: false })
    const b = await mount('ar', { section: 'templates' })
    noLeaks(b.container)
  })

  test('the same editor taps send the same template in every language', async () => {
    const run = async (locale: UiLocale) => {
      resetSetEnv()
      const view = await mount(locale, { section: 'templates' })
      await click(screen.getByTestId('ready-messages-mobile').querySelector('button.bg-solid')!)
      fireEvent.change(dialog().querySelector('input')!, { target: { value: 'תזכורת' } })
      fireEvent.change(dialog().querySelector('textarea')!, { target: { value: 'שלום ' } })
      await click([...dialog().querySelectorAll('button')].find((b) => b.className.includes('bg-primary-tint'))!)
      fireEvent.click(dialog().querySelectorAll('input[type="radio"]')[1])
      await act(async () => fireEvent.submit(dialog().querySelector('form')!))
      await flush()
      view.unmount()
      return setEnv.calls.filter((c) => c[0] === 'createTemplate')
    }
    const he = await run('he')
    expect(he).toHaveLength(1)
    expect(await run('en')).toEqual(he)
    expect(await run('ar')).toEqual(he)
  })
})

describe('the phone security list, hydration and a language switch', () => {
  test('dates in the interface language; device and IP as data', async () => {
    const { container } = render(await tree('en', {}, 'security'))
    expect(container.querySelector('ul')!.closest('[lang="he"]')).toBeNull()
    noLeaks(container)
  })

  for (const locale of ['he', 'en', 'ar'] as const) {
    test(`hydration without a mismatch (${locale})`, async () => {
      const errors: unknown[] = []
      const spy = vi.spyOn(console, 'error').mockImplementation((...a) => {
        if (/hydrat|did not match|server rendered/i.test(String(a[0]))) errors.push(a)
      })
      for (const sp of [{}, { section: 'templates' }]) {
        const t = await tree(locale, sp)
        const host = document.createElement('div')
        host.innerHTML = renderToString(t)
        document.body.appendChild(host)
        await act(async () => {
          hydrateRoot(host, t, { onRecoverableError: (e) => errors.push(e) })
        })
        host.remove()
      }
      spy.mockRestore()
      expect(errors).toEqual([])
    })
  }

  test('switching he → en → ar re-words the landing', async () => {
    const { rerender } = render(await tree('he'))
    expect(screen.getByText('אינטגרציות')).toBeTruthy()
    rerender(await tree('en'))
    expect(screen.getByText('Integrations')).toBeTruthy()
    rerender(await tree('ar'))
    expect(screen.getByTestId('integrations-mobile').getAttribute('lang')).toBe('ar')
  })
})
