// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CHANNEL, NOW, adminEnv, resetAdminEnv } from './adminEnv'
import { EXPIRED, adminPage, adminShell } from './adminHarness'

/**
 * HEBREW BASELINE, phone admin settings (i18n Phase F2): the REAL
 * `/settings/edit_users` and `/settings/auto-response` pages inside the REAL
 * (admin_settings) layout with the device gate answering "phone" — the users
 * list (users + invitations, none), each user's sheet (active / suspended /
 * no phone), the auto-response screen (AI with business description, AI
 * without, fixed, fixed not set, WhatsApp channel off, questionnaire
 * answering, master off) and its switch (off, refused, failed, on, expired).
 * Recorded BEFORE Phase F2 on unmodified code, with NO i18n provider.
 * Normalized: React's `<!-- -->` and `useId` only.
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

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const renderToString = (node: ReactNode) => normalizeIds(renderRaw(<>{node}</>).replaceAll('<!-- -->', ''))
const html = (el: Element | null | undefined) => {
  if (!el) throw new Error('element not found')
  return normalizeIds(el.outerHTML)
}
const dialog = () => [...document.querySelectorAll('[role="dialog"]')].at(-1)
const set = (overrides: Partial<typeof adminEnv>) => Object.assign(adminEnv, overrides)
type Name = 'editUsers' | 'autoResponse'
const serverHtml = async (name: Name, ent?: typeof EXPIRED) => {
  set({ mobile: true })
  return renderToString(await adminShell(null, await adminPage(name), ent))
}
const mount = async (name: Name, ent?: typeof EXPIRED) => {
  set({ mobile: true })
  return render(await adminShell(null, await adminPage(name), ent))
}
const sw = () => document.querySelector('[data-testid="auto-response-toggle"] input') as HTMLInputElement

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetAdminEnv()
})

describe('Hebrew baseline — phone users list (/settings/edit_users on a phone)', () => {
  test('users + invitations, none; every user sheet', async () => {
    const out: Record<string, unknown> = {}
    out.list = await serverHtml('editUsers')
    set({ allUsers: [], invitations: [] })
    out.empty = await serverHtml('editUsers')
    resetAdminEnv()
    await mount('editUsers')
    for (const name of ['דנה כהן', 'משה לוי', 'רונית אברהם']) {
      await act(async () => fireEvent.click(screen.getByText(name).closest('button')!))
      out[`sheet_${name}`] = html(dialog())
      await act(async () => fireEvent.click(dialog()!.querySelector('button[aria-label]')!))
    }
    expect(out.list).toContain('הזמנות')
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — phone auto-response (/settings/auto-response on a phone)', () => {
  test('every screen state', async () => {
    const out: Record<string, string> = {}
    out.aiWithGuidance = await serverHtml('autoResponse')
    set({ channel: { ...CHANNEL, guidance: null } })
    out.aiNoGuidance = await serverHtml('autoResponse')
    set({ channel: { ...CHANNEL, replyMode: 'fixed', fixedBody: 'שלום {{firstName}}, נחזור אליך בהקדם.' } })
    out.fixed = await serverHtml('autoResponse')
    set({ channel: { ...CHANNEL, replyMode: 'fixed', fixedBody: null } })
    out.fixedNotSet = await serverHtml('autoResponse')
    set({ channel: { ...CHANNEL, enabled: false } })
    out.channelOff = await serverHtml('autoResponse')
    set({ channel: { ...CHANNEL, responder: 'questionnaire' } })
    out.questionnaire = await serverHtml('autoResponse')
    set({ channel: null, master: false })
    out.masterOffNoChannel = await serverHtml('autoResponse')
    resetAdminEnv()
    out.expired = await serverHtml('autoResponse', EXPIRED)
    expect(out.aiWithGuidance).toContain('ההודעה שנשלחת')
    expect(out).toMatchSnapshot()
  })

  test('the switch: off, refused, failed, on, expired', async () => {
    const out: Record<string, unknown> = {}
    await mount('autoResponse')
    await act(async () => fireEvent.click(sw()))
    out.off = html(screen.getByTestId('auto-response-toggle'))
    set({ results: { setAutoResponseMasterEnabled: { ok: false, reason: 'forbidden' } } })
    await act(async () => fireEvent.click(sw()))
    out.refused = html(screen.getByTestId('auto-response-toggle'))
    set({ results: { setAutoResponseMasterEnabled: { ok: false, reason: 'failed' } } })
    await act(async () => fireEvent.click(sw()))
    out.failed = html(screen.getByTestId('auto-response-toggle'))
    set({ results: {} })
    await act(async () => fireEvent.click(sw()))
    out.on = html(screen.getByTestId('auto-response-toggle'))
    out.calls = adminEnv.calls
    cleanup()
    resetAdminEnv()
    await mount('autoResponse', EXPIRED)
    await act(async () => fireEvent.click(sw()))
    out.expiredCalls = adminEnv.calls
    expect(out).toMatchSnapshot()
  })
})
