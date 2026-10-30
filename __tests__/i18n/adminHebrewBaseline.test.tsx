// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CHANNEL, NOW, resetAdminEnv, adminEnv } from './adminEnv'
import { EXPIRED, adminPage, adminShell, type AdminPage } from './adminHarness'

/**
 * HEBREW BASELINE for the admin settings pages (Phase E5a) — server HTML of
 * every page-level state of the (admin_settings) layout, /settings/edit_users,
 * edit_teams, edit_promotions, edit_tmplts (+ one template), quote-templates
 * and auto-response. Recorded BEFORE Phase E5 on unmodified product code.
 * (Interactions: adminHebrewBaselineInteractions / …QuotesAuto.)
 *
 * Real server pages, I/O mocked, no i18n provider. Normalized: `<!-- -->`
 * separators and `useId` values only.
 */

vi.mock('next/navigation', async () => (await import('./adminMocks')).navigationModule())
vi.mock('next/dynamic', async () => (await import('./adminMocks')).nextDynamicModule())
vi.mock('@/db/auth', async () => (await import('./adminMocks')).authModule())
vi.mock('@/actions/auth', async () => (await import('./adminMocks')).authModule())
vi.mock('@/lib/requireUser', async () => (await import('./adminMocks')).requireUserModule())
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: null, agencyLocale: null }) }))
vi.mock('@/lib/device', async () => (await import('./adminMocks')).deviceModule())
vi.mock('@/lib/access/productAccess', async () => (await import('./adminMocks')).productAccessModule())
vi.mock('@/config/db', async () => (await import('./adminMocks')).configDbModule())
vi.mock('@/db/usersNTeams', async () => (await import('./adminMocks')).usersNTeamsDbModule())
vi.mock('@/db/invitations', async () => (await import('./adminMocks')).invitationsDbModule())
vi.mock('@/actions/usersNteams', async () => (await import('./adminMocks')).usersNteamsActionsModule())
vi.mock('@/actions/invitations', async () => (await import('./adminMocks')).invitationsActionsModule())
vi.mock('@/actions/global', async () => (await import('./adminMocks')).globalActionsModule())
vi.mock('@/db/promos', async () => (await import('./adminMocks')).promosDbModule())
vi.mock('@/actions/promos', async () => (await import('./adminMocks')).promosActionsModule())
vi.mock('@/actions/files', async () => (await import('./adminMocks')).filesActionsModule())
vi.mock('@/db/tasks', async () => (await import('./adminMocks')).tasksDbModule())
vi.mock('@/actions/tasks', async () => (await import('./adminMocks')).tasksActionsModule())
vi.mock('@/db/quotes/templateWrites', async () => (await import('./adminMocks')).quoteWritesDbModule())
vi.mock('@/actions/quotes/templates', async () => (await import('./adminMocks')).quoteActionsModule())
vi.mock('@/db/autoResponseSettings', async () => (await import('./adminMocks')).autoResponseDbModule())
vi.mock('@/lib/flags/questionnaireBuilderFlags', async () => (await import('./adminMocks')).builderFlagsModule())
vi.mock('@/actions/autoResponse/updateSettings', async () => (await import('./adminMocks')).updateAutoResponseModule())
vi.mock('@/actions/autoResponse/previewAgent', async () => (await import('./adminMocks')).previewAgentModule())
vi.mock('@/modules/settings/mobile/AutoResponseMobile', async () => (await import('./adminMocks')).autoResponseMobileModule())

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const renderToString = (node: ReactNode) => normalizeIds(renderRaw(<>{node}</>).replaceAll('<!-- -->', ''))
const set = (overrides: Partial<typeof adminEnv>) => Object.assign(adminEnv, overrides)
const html = async (name: AdminPage, ent?: typeof EXPIRED) => renderToString(await adminShell(null, await adminPage(name), ent))

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetAdminEnv()
})

describe('Hebrew baseline — admin settings (server HTML)', () => {
  test('the (admin_settings) layout: a non-admin is refused', async () => {
    const out: Record<string, string> = {}
    for (const role of ['AGENT', 'MNGR', 'OFFICE']) {
      set({ user: { ...adminEnv.user, role } })
      out[role] = await html('editUsers')
    }
    expect(out).toMatchSnapshot()
  })

  test('edit_users: users + invitations; no invitations', async () => {
    const out: Record<string, string> = {}
    out.base = await html('editUsers')
    set({ invitations: [] })
    out.noInvitations = await html('editUsers')
    expect(out).toMatchSnapshot()
  })

  test('edit_teams: teams; no teams', async () => {
    const out: Record<string, string> = {}
    out.base = await html('editTeams')
    set({ allTeams: [] })
    out.empty = await html('editTeams')
    expect(out).toMatchSnapshot()
  })

  test('edit_promotions: campaigns; no campaigns', async () => {
    const out: Record<string, string> = {}
    out.base = await html('editPromotions')
    set({ promos: [] })
    out.empty = await html('editPromotions')
    expect(out).toMatchSnapshot()
  })

  test('edit_tmplts: list, empty list, one template, missing template', async () => {
    const out: Record<string, string> = {}
    out.list = await html('editTmplts')
    set({ taskTmplts: [] })
    out.emptyList = await html('editTmplts')
    out.detail = await html('tmpltDetail')
    set({ taskTmplt: null })
    out.missing = await html('tmpltDetail')
    expect(out).toMatchSnapshot()
  })

  test('quote-templates: active + archived, only archived, empty, expired, no permission', async () => {
    const out: Record<string, string> = {}
    out.base = await html('quoteTemplates')
    set({ quoteOverviews: adminEnv.quoteOverviews.filter((t) => t.state === 'archived') })
    out.onlyArchived = await html('quoteTemplates')
    set({ quoteOverviews: [], quoteDocuments: {} })
    out.empty = await html('quoteTemplates')
    set({ quoteOverviews: structuredClone((await import('./adminEnv')).QUOTE_OVERVIEWS), hasAccess: false })
    out.expired = await html('quoteTemplates', EXPIRED)
    set({ hasAccess: true, user: { ...adminEnv.user, role: 'AGENT' } })
    out.noPermission = renderToString(await adminShell(null, await (await import('@/app/(app)/settings/(admin_settings)/quote-templates/page')).default()))
    expect(out).toMatchSnapshot()
  })

  test('auto-response: AI mode, fixed mode, master off, no business name, questionnaire (Builder / staff), expired', async () => {
    const out: Record<string, string> = {}
    out.ai = await html('autoResponse')
    set({ channel: { ...CHANNEL, replyMode: 'fixed', fixedBody: 'שלום {{firstName}}, נחזור אליך' } })
    out.fixed = await html('autoResponse')
    set({ master: false, channel: null })
    out.masterOff = await html('autoResponse')
    set({ master: true, channel: { ...CHANNEL }, agencyName: null })
    out.noBusinessName = await html('autoResponse')
    set({ agencyName: 'סטודיו דנה', channel: { ...CHANNEL, responder: 'questionnaire' } })
    out.questionnaireStaff = await html('autoResponse')
    set({ builder: true })
    out.questionnaireBuilder = await html('autoResponse')
    set({ builder: false, channel: { ...CHANNEL }, hasAccess: false })
    out.expired = await html('autoResponse', EXPIRED)
    expect(out).toMatchSnapshot()
  })
})
