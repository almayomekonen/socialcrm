// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import type { UiLocale } from '@/lib/i18n/config'
import { ADMIN_CUSTOMER_DATA, CHANNEL, NOW, adminEnv, resetAdminEnv } from './adminEnv'
import { EXPIRED, adminPage, adminShell } from './adminHarness'
import { findHebrewLeaks } from './leakScan'

/**
 * The phone admin settings in English and Arabic (i18n Phase F2): the users
 * list and a user's sheet (roles by code, chevrons mirrored in LTR), the
 * auto-response screen (the fixed message and the Smart Agent's business
 * description stay in declared Hebrew islands — data / AI configuration) and
 * its switch (state line, refusals, the Pro toast, the same action argument in
 * every language), hydration in he / en / ar. Sheets are portalled and scanned
 * here.
 */

vi.mock('next/navigation', async () => (await import('./adminMocks')).navigationModule())
vi.mock('next/dynamic', async () => (await import('./adminMocks')).nextDynamicModule())
vi.mock('@/db/auth', async () => (await import('./adminMocks')).authModule())
vi.mock('@/actions/auth', async () => (await import('./adminMocks')).authModule())
vi.mock('@/lib/requireUser', async () => (await import('./adminMocks')).requireUserModule())
vi.mock('@/db/uiLocale', async () => {
  const { adminEnv: env } = await import('./adminEnv')
  return { getUiLocalePrefs: async () => ({ userLocale: (env as { userLocale?: string | null }).userLocale ?? null, agencyLocale: null }) }
})
vi.mock('@/lib/device', async () => (await import('./adminMocks')).deviceModule())
vi.mock('@/lib/access/productAccess', async () => (await import('./adminMocks')).productAccessModule())
vi.mock('@/config/db', async () => (await import('./adminMocks')).configDbModule())
vi.mock('@/db/usersNTeams', async () => (await import('./adminMocks')).usersNTeamsDbModule())
vi.mock('@/db/invitations', async () => (await import('./adminMocks')).invitationsDbModule())
vi.mock('@/actions/usersNteams', async () => (await import('./adminMocks')).usersNteamsActionsModule())
vi.mock('@/actions/invitations', async () => (await import('./adminMocks')).invitationsActionsModule())
vi.mock('@/actions/global', async () => (await import('./adminMocks')).globalActionsModule())
vi.mock('@/db/autoResponseSettings', async () => (await import('./adminMocks')).autoResponseDbModule())
vi.mock('@/lib/flags/questionnaireBuilderFlags', async () => (await import('./adminMocks')).builderFlagsModule())
vi.mock('@/actions/autoResponse/updateSettings', async () => (await import('./adminMocks')).updateAutoResponseModule())
vi.mock('@/actions/autoResponse/previewAgent', async () => (await import('./adminMocks')).previewAgentModule())
vi.mock('@/lib/toast', async () => (await import('./adminMocks')).toastModule())
vi.mock('@/actions/autoResponse/setMasterEnabled', async () => {
  const { adminEnv: env } = await import('./adminEnv')
  return {
    setAutoResponseMasterEnabled: async (next: boolean) => {
      env.calls.push(['setAutoResponseMasterEnabled', next])
      return (env.results.setAutoResponseMasterEnabled as object) ?? { ok: true }
    },
  }
})


;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const saved = { ...process.env }
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
beforeEach(() => {
  process.env.UI_LOCALE_ENABLED = '1'
  process.env.UI_LOCALE_AGENCY_ALLOWLIST = '103'
})
afterEach(() => {
  cleanup()
  process.env = { ...saved }
  resetAdminEnv()
})

type Name = 'editUsers' | 'autoResponse'
const allowed = [...ADMIN_CUSTOMER_DATA, 'שלום {{firstName}}, נחזור אליך בהקדם.', 'על העסק שלכם'].map((text) => ({ text, reason: 'customer-data' as const }))
const noLeaks = (root: Element) => expect(findHebrewLeaks(root, allowed)).toEqual([])
const dialog = () => [...document.querySelectorAll('[role="dialog"]')].at(-1)!
const tree = async (locale: UiLocale, name: Name, ent?: typeof EXPIRED) => {
  Object.assign(adminEnv, { mobile: true, userLocale: locale })
  return adminShell(locale, await adminPage(name), ent)
}
const mount = async (locale: UiLocale, name: Name, ent?: typeof EXPIRED) => render(await tree(locale, name, ent))
const sw = () => document.querySelector('[data-testid="auto-response-toggle"] input') as HTMLInputElement
const islands = (root: Element) => [...root.querySelectorAll('[lang="he"]')].map((e) => e.textContent)

describe('the phone users list', () => {
  test('English: sections, roles, suspended, user sheet, mirrored chevrons', async () => {
    const { container } = await mount('en', 'editUsers')
    const text = container.textContent!
    for (const s of ['Users', 'Invitations', 'Admin', 'Suspended']) expect(text, s).toContain(s)
    noLeaks(container)
    expect([...container.querySelectorAll('[class*="size-4 bg-gray-300"]')].every((c) => c.className.includes('-scale-x-100'))).toBe(true)
    await act(async () => fireEvent.click(screen.getByText('רונית אברהם').closest('button')!))
    expect(dialog().getAttribute('lang')).toBe('en')
    for (const s of ['Role', 'Email', 'Status', 'Suspended', 'available on a computer']) expect(dialog().textContent, s).toContain(s)
    noLeaks(dialog())
  })

  test('Arabic: empty lists', async () => {
    Object.assign(adminEnv, { allUsers: [], invitations: [] })
    const { container } = await mount('ar', 'editUsers')
    expect(container.textContent).toContain('لا يوجد مستخدمون في مساحة العمل بعد.')
    expect(container.textContent).toContain('لا توجد دعوات معلّقة.')
    noLeaks(container)
  })
})

describe('the phone auto-response', () => {
  test('English: every state; only data and AI configuration stay Hebrew', async () => {
    for (const channel of [CHANNEL, { ...CHANNEL, guidance: null }, { ...CHANNEL, replyMode: 'fixed', fixedBody: 'שלום {{firstName}}, נחזור אליך בהקדם.' }, { ...CHANNEL, replyMode: 'fixed', fixedBody: null }, { ...CHANNEL, enabled: false }, { ...CHANNEL, responder: 'questionnaire' }]) {
      resetAdminEnv()
      adminEnv.channel = channel
      const { container } = await mount('en', 'autoResponse')
      noLeaks(container)
      for (const island of islands(container)) expect(island!.includes('אנחנו מוסך') || island!.includes('שלום {{firstName}}')).toBe(true)
      cleanup()
    }
  })

  test('the switch: state line, refusals and the same argument in every language; the Pro toast', async () => {
    const run = async (locale: UiLocale) => {
      resetAdminEnv()
      const view = await mount(locale, 'autoResponse')
      await act(async () => fireEvent.click(sw()))
      const line = screen.getByTestId('auto-response-toggle').textContent
      adminEnv.results.setAutoResponseMasterEnabled = { ok: false, reason: 'forbidden' }
      await act(async () => fireEvent.click(sw()))
      const alert = screen.getByRole('alert').textContent
      view.unmount()
      return { line, alert, calls: adminEnv.calls.filter((c) => c[0] === 'setAutoResponseMasterEnabled') }
    }
    const he = await run('he')
    const en = await run('en')
    const ar = await run('ar')
    expect(en.calls).toEqual(he.calls)
    expect(ar.calls).toEqual(he.calls)
    expect(en.line).toContain('Off · no auto response')
    expect(en.alert).toBe('Only an admin can change auto response.')
    expect(ar.alert).toBe('يمكن للمدير فقط تغيير الرد التلقائي.')
    resetAdminEnv()
    await mount('en', 'autoResponse', EXPIRED)
    await act(async () => fireEvent.click(sw()))
    expect(adminEnv.calls.find((c) => c[0] === 'proToast')![1]).toMatchObject({ title: 'Auto response is available with Pro' })
    expect(sw().getAttribute('aria-label')).toBe('WhatsApp auto response')
  })

  for (const locale of ['he', 'en', 'ar'] as const) {
    test(`hydration without a mismatch (${locale})`, async () => {
      const errors: unknown[] = []
      const spy = vi.spyOn(console, 'error').mockImplementation((...a) => {
        if (/hydrat|did not match|server rendered/i.test(String(a[0]))) errors.push(a)
      })
      for (const name of ['editUsers', 'autoResponse'] as const) {
        const t = await tree(locale, name)
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
})
