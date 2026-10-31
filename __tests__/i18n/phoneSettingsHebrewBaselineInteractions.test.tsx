// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NOW, PENDING_PAGES, PENDING_PHONES, resetSetEnv, setEnv } from './settingsEnv'
import { EXPIRED, setShell, settingsPage } from './settingsHarness'

/**
 * HEBREW BASELINE, phone settings part 2 (i18n Phase F2): the phone
 * Integrations after acting — every manage sheet, the one-tap completion after
 * an OAuth return (success / failure toasts), the Drive card's fetched states
 * — and the phone ready-messages workspace (detail sheet per status, the
 * editor with its validation, create / retry / edit / archive / discard with
 * their confirmations and toasts), plus a JSON snapshot of the landing-copy
 * producers (`integrationStatus.ts`, `oauthReturn.ts`) for every input.
 * Recorded BEFORE Phase F2 on unmodified code, with NO i18n provider.
 */

// A STABLE router, as in Next: `useIntegrationReturnContinuation` lists it in its effect dependencies.
vi.mock('next/navigation', async () => {
  const nav = (await import('./settingsMocks')).navigationModule()
  const router = nav.useRouter()
  return { ...nav, useRouter: () => router }
})
vi.mock('next/headers', async () => (await import('./settingsMocks')).headersModule())
vi.mock('@/db/auth', async () => (await import('./settingsMocks')).authModule())
vi.mock('@/lib/requireUser', async () => (await import('./settingsMocks')).requireUserModule())
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: null, agencyLocale: null }) }))
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

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const html = (el: Element | null | undefined) => {
  if (!el) throw new Error('element not found')
  return normalizeIds(el.outerHTML)
}
const dialog = () => [...document.querySelectorAll('[role="dialog"]')].at(-1)
const click = async (el: Element) => act(async () => fireEvent.click(el))
const byText = (text: string) => screen.getAllByText(text).at(-1)!
const set = (overrides: Partial<typeof setEnv>) => Object.assign(setEnv, overrides)
const mount = async (sp: Record<string, string> = {}, ent?: typeof EXPIRED) => {
  set({ mobile: true, searchParams: sp })
  return render(await setShell(null, await settingsPage('integrations'), ent))
}
const toasts = () => {
  const t = setEnv.calls.filter((c) => c[0] === 'toast' || c[0] === 'proToast')
  setEnv.calls = setEnv.calls.filter((c) => c[0] !== 'toast' && c[0] !== 'proToast')
  return t
}
let fetchAnswer: (url: string) => Response = () => new Response(JSON.stringify({ connected: false }))
const flush = async () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  globalThis.fetch = vi.fn(async (url: string) => fetchAnswer(String(url))) as unknown as typeof fetch
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetSetEnv()
  fetchAnswer = () => new Response(JSON.stringify({ connected: false }))
})

describe('Hebrew baseline — phone Integrations sheets and returns', () => {
  test('each manage sheet; the not-connected WhatsApp sheet title; Drive connected / disconnected', async () => {
    const out: Record<string, unknown> = {}
    fetchAnswer = () => new Response(JSON.stringify({ connected: true, email: 'dana@gmail.test' }))
    await mount()
    await flush()
    out.landing = html(screen.getByTestId('integrations-mobile'))
    const actions = [...screen.getByTestId('integrations-mobile').querySelectorAll('article button')]
    for (const [i, name] of ['whatsapp', 'facebook', 'templates', 'calendar', 'drive'].entries()) {
      if (!actions[i]) continue
      await click(actions[i])
      out[`sheet_${name}`] = dialog() ? html(dialog()) : null
      const close = dialog()?.querySelector('button[aria-label]')
      if (close) await click(close)
    }
    cleanup()
    resetSetEnv()
    set({ waConnection: null, fbPage: null })
    await mount()
    await flush()
    await click(screen.getByTestId('integrations-mobile').querySelector('article button')!)
    out.waNotConnectedSheet = html(dialog())
    out.toasts = toasts()
    expect(out).toMatchSnapshot()
  })

  test('one-tap completion after a return: Facebook and WhatsApp, success and failure', async () => {
    const out: Record<string, unknown> = {}
    for (const ok of [true, false]) {
      fetchAnswer = (url) => (url.includes('/connect') ? new Response('{}', { status: ok ? 200 : 500 }) : new Response(JSON.stringify({ connected: false })))
      resetSetEnv()
      set({ fbPage: null, pendingPages: PENDING_PAGES.slice(0, 1) })
      await mount()
      out[`fbCompleting_${ok}`] = html(screen.getByTestId('integrations-mobile').querySelector('article:nth-of-type(2)'))
      await flush()
      out[`fbToasts_${ok}`] = toasts()
      cleanup()
      resetSetEnv()
      set({ waConnection: null, pendingPhones: PENDING_PHONES })
      await mount()
      out[`waCompleting_${ok}`] = html(dialog())
      await flush()
      out[`waToasts_${ok}`] = toasts()
      cleanup()
    }
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — phone ready messages', () => {
  test('detail sheet per status, editor and validation, every action and toast', async () => {
    const out: Record<string, unknown> = {}
    await mount({ section: 'templates' })
    const open = async (title: string) => click(screen.getAllByText(title).find((e) => e.closest('[data-testid="ready-messages-mobile"]'))!)
    for (const title of ['תזכורת פגישה', 'מבצע חגים', 'הצעה אחרונה']) {
      await open(title)
      out[`detail_${title}`] = html(dialog())
      await click(dialog()!.querySelector('button[aria-label]')!)
    }
    await click(byText('הודעה מוכנה חדשה'))
    out.editorEmpty = html(dialog())
    fireEvent.change(dialog()!.querySelector('input')!, { target: { value: 'א'.repeat(600) } })
    fireEvent.change(dialog()!.querySelector('textarea')!, { target: { value: 'שלום {{1}}' } })
    fireEvent.click(dialog()!.querySelector('input[type="radio"]')!)
    await act(async () => fireEvent.submit(dialog()!.querySelector('form')!))
    out.validation = html(dialog()!.querySelector('[role="alert"]'))
    fireEvent.change(dialog()!.querySelector('input')!, { target: { value: 'תזכורת' } })
    fireEvent.change(dialog()!.querySelector('textarea')!, { target: { value: 'שלום' } })
    await click([...dialog()!.querySelectorAll('button')].find((b) => b.className.includes('bg-primary-tint'))!)
    out.withToken = html(dialog())
    await act(async () => fireEvent.submit(dialog()!.querySelector('form')!))
    await flush()
    out.created = toasts()
    setEnv.results.createTemplate = { ok: false, error: 'יצרתם היום את מכסת ההודעות המוכנות. נסו שוב מחר.' }
    await click(byText('הודעה מוכנה חדשה'))
    fireEvent.change(dialog()!.querySelector('input')!, { target: { value: 'עוד' } })
    fireEvent.change(dialog()!.querySelector('textarea')!, { target: { value: 'טקסט' } })
    fireEvent.click(dialog()!.querySelectorAll('input[type="radio"]')[1])
    await act(async () => fireEvent.submit(dialog()!.querySelector('form')!))
    await flush()
    out.createFailed = toasts()
    // approved → edit; rejected → retry; approved → archive; pending → discard
    await open('תזכורת פגישה')
    await click(byText('עריכת הודעה'))
    out.editEditor = html(dialog())
    await click(byText('ביטול'))
    await open('הצעה אחרונה')
    await click(byText('ערוך ונסה שוב'))
    out.retryEditor = html(dialog())
    await click(byText('ביטול'))
    await open('תזכורת פגישה')
    await click(byText('העבר לארכיון'))
    out.archiveConfirm = html(dialog())
    setEnv.results.archiveTemplate = { ok: false, error: 'אין הרשאה לנהל הודעות WhatsApp מוכנות.' }
    await click(byText('העבר לארכיון'))
    await flush()
    out.archiveFailed = toasts()
    setEnv.results.archiveTemplate = undefined
    await open('תזכורת פגישה')
    await click(byText('העבר לארכיון'))
    await click(byText('העבר לארכיון'))
    await flush()
    out.archived = toasts()
    await open('מבצע חגים')
    await click(byText('מחק הודעה'))
    out.discardConfirm = html(dialog())
    await click(byText('מחק'))
    await flush()
    out.discarded = toasts()
    out.calls = setEnv.calls.filter((c) => !String(c[0]).startsWith('router'))
    expect(out).toMatchSnapshot()
  })

  test('the empty workspace and its create button', async () => {
    set({ templates: [] })
    await mount({ section: 'templates' })
    const out: Record<string, unknown> = { empty: html(screen.getByTestId('ready-messages-mobile')) }
    await click(byText('צרו הודעה מוכנה'))
    out.editor = html(dialog())
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — landing-copy producers (as data)', () => {
  test('integrationStatus and oauthReturn for every input', async () => {
    const S = await import('@/modules/settings/mobile/integrationStatus')
    const R = await import('@/modules/settings/mobile/oauthReturn')
    const out: Record<string, unknown> = {}
    for (const status of ['operational', 'registration_pending', 'restricted', 'token', 'webhook', 'throttled', 'unknown', 'disconnected'] as const) {
      out[`wa_${status}`] = S.whatsappLandingCopy({ connected: true, status })
    }
    out.waOff = S.whatsappLandingCopy({ connected: false, status: 'operational' })
    const health = (h: Partial<Record<string, boolean>>) => ({ tokenValid: true, permissionsOk: true, subscribed: true, needsReconnect: false, ...h }) as never
    out.fbNone = S.facebookLandingCopy({ connection: null, health: null })
    for (const [k, h] of Object.entries({ healthy: health({}), expired: health({ needsReconnect: true }), repairing: health({ subscribed: false }), bad: health({ tokenValid: false }) }))
      out[`fb_${k}`] = S.facebookLandingCopy({ connection: { pageName: 'סטודיו דנה' }, health: h })
    out.fbNoHealth = S.facebookLandingCopy({ connection: { pageName: 'סטודיו דנה' }, health: null })
    const rm = { enabled: true, connected: true, messagingReady: true, total: 3, approved: 2, pending: 1 }
    for (const [k, v] of Object.entries({ off: { enabled: false }, notConnected: { connected: false }, notReady: { messagingReady: false }, empty: { total: 0, approved: 0, pending: 0 }, both: {}, approvedOnly: { pending: 0 }, pendingOnly: { approved: 0 }, neither: { approved: 0, pending: 0 } }))
      out[`rm_${k}`] = S.readyMessagesLandingCopy({ ...rm, ...v })
    for (const state of ['not_connected', 'connected', 'reauth_required'] as const) {
      out[`cal_${state}`] = S.calendarLandingCopy({ state, email: 'dana@gmail.test' })
      out[`cal_${state}_noEmail`] = S.calendarLandingCopy({ state, email: null })
    }
    for (const error of [null, 'denied', 'no_pages', 'token', 'x']) for (const pendingPages of [null, [1], [1, 2]]) for (const select of [false, true])
      out[`fbR_${error}_${pendingPages?.length ?? 0}_${select}`] = R.facebookReturnCopy({ pendingPages, error, select, completing: false })
    out.fbR_completing = R.facebookReturnCopy({ pendingPages: null, error: null, select: false, completing: true })
    for (const error of [null, 'cancelled', 'denied', 'no_phones', 'network', 'x']) for (const pendingPhones of [null, [1], [1, 2]])
      out[`waR_${error}_${pendingPhones?.length ?? 0}`] = R.whatsappReturnCopy({ pendingPhones, error, completing: false })
    out.waR_completing = R.whatsappReturnCopy({ pendingPhones: null, error: null, completing: true })
    for (const f of ['calendarReturnCopy', 'driveReturnCopy'] as const)
      for (const connected of [false, true]) for (const error of [null, 'denied', 'x']) for (const connecting of [false, true])
        out[`${f}_${connected}_${error}_${connecting}`] = R[f]({ connected, error, connecting })
    expect(out).toMatchSnapshot()
  })
})
