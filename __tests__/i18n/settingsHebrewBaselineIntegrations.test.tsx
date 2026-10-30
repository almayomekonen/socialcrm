// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MESSENGER, NOW, PENDING_PAGES, PENDING_PHONES, resetSetEnv, setEnv } from './settingsEnv'
import { EXPIRED, setShell, settingsPage } from './settingsHarness'

/**
 * HEBREW BASELINE for /settings/integrations (Phase E4) — server HTML of every
 * page-level state: Facebook (connected healthy / repairing / expired, Page
 * picker, every `?error=` code, reconnected), WhatsApp (every health status,
 * number picker, `?wa_error=`), the ready-made messages section (not
 * connected, not ready, empty, list with every status + header badge),
 * Messenger (entry points, read failure, saved replies), Google Calendar
 * (connected / not / reauth), Google Drive (loading), AI connections, the
 * expired notice, the open-section deep links. Recorded BEFORE Phase E4 on
 * unmodified product code.
 */

vi.mock('next/navigation', async () => (await import('./settingsMocks')).navigationModule())
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

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const renderToString = (node: ReactNode) => normalizeIds(renderRaw(<>{node}</>).replaceAll('<!-- -->', ''))
const set = (overrides: Partial<typeof setEnv>) => Object.assign(setEnv, overrides)
const html = async (ent?: typeof EXPIRED) => renderToString(await setShell(null, await settingsPage('integrations'), ent))

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetSetEnv()
})

describe('Hebrew baseline — /settings/integrations (server HTML)', () => {
  test('everything connected and healthy; each section opened by ?section=; subscription expired', async () => {
    const out: Record<string, string> = {}
    out.connected = await html()
    for (const section of ['whatsapp', 'templates', 'none']) {
      set({ searchParams: { section } })
      out[`section_${section}`] = await html()
    }
    set({ searchParams: {}, hasAccess: false })
    out.expired = await html(EXPIRED)
    expect(out).toMatchSnapshot()
  })

  test('Facebook: repairing, expired, reconnected; Page picker; not connected + every ?error= code', async () => {
    const out: Record<string, string> = {}
    set({ fbHealth: { tokenValid: true, permissionsOk: true, subscribed: false, needsReconnect: false } })
    out.repairing = await html()
    set({ fbHealth: { tokenValid: false, permissionsOk: true, subscribed: true, needsReconnect: true } })
    out.expired = await html()
    set({ fbHealth: setEnv.fbHealth && { tokenValid: true, permissionsOk: true, subscribed: true, needsReconnect: false }, searchParams: { reconnected: '1' } })
    out.reconnected = await html()
    set({ fbPage: null, pendingPages: PENDING_PAGES, searchParams: {}, messenger: { visible: false } })
    out.pagePicker = await html()
    set({ pendingPages: null })
    out.notConnected = await html()
    const codes = ['denied', 'missing_permission', 'no_page_selected', 'no_pages', 'comments_permission', 'pages_permission', 'resource_claimed', 'token', 'state', 'no_code', 'subscription_failed', 'save_failed', 'expired', 'messenger_permission', 'unknown_code']
    for (const error of codes) {
      set({ searchParams: { error } })
      out[`error_${error}`] = await html()
    }
    expect(out).toMatchSnapshot()
  })

  test('WhatsApp: every health status; number picker; not connected + ?wa_error=', async () => {
    const out: Record<string, string> = {}
    for (const waStatus of ['registration_pending', 'inbound_only', 'restricted', 'token', 'webhook', 'throttled', 'unknown']) {
      set({ waStatus, searchParams: { section: 'whatsapp' } })
      out[`status_${waStatus}`] = await html()
    }
    set({ waConnection: null, waStatus: 'disconnected', pendingPhones: PENDING_PHONES })
    out.phonePicker = await html()
    set({ pendingPhones: null })
    out.notConnected = await html()
    for (const wa_error of ['denied', 'config', 'no_accounts', 'no_phones', 'not_ready', 'subscribe_incomplete', 'resource_claimed', 'network', 'sdk']) {
      set({ searchParams: { section: 'whatsapp', wa_error } })
      out[`wa_error_${wa_error}`] = await html()
    }
    expect(out).toMatchSnapshot()
  })

  test('ready-made messages: not connected, not ready, empty, no header badge', async () => {
    const out: Record<string, string> = {}
    set({ searchParams: { section: 'templates' } })
    set({ waConnection: null, waStatus: 'disconnected' })
    out.notConnected = await html()
    set({ waConnection: { phone_number_id: 'ph1', access_token: 'sealed' }, waStatus: 'operational', waReady: false })
    out.notReady = await html()
    set({ waReady: true, templates: [], templateCounts: {} })
    out.empty = await html()
    set({ templates: setEnv.templates, templateCounts: { approved: 0, pending: 2 } })
    out.pendingOnlyBadge = await html()
    set({ templatesEnabled: false })
    out.disabled = await html()
    expect(out).toMatchSnapshot()
  })

  test('Messenger read failure / no saved replies; calendar not connected / reauth; no AI connections; MCP off', async () => {
    const out: Record<string, string> = {}
    set({ messenger: { ...MESSENGER, readFailed: true, savedReplies: [] } })
    out.messengerReadFailed = await html()
    set({ messenger: MESSENGER, calendar: null })
    out.calendarNotConnected = await html()
    set({ calendar: { google_email: 'dana@gmail.test', sync_status: 'reauth_required', last_error: 'invalid_grant: Token has been expired or revoked.' } })
    out.calendarReauth = await html()
    set({ calendar: { google_email: 'dana@gmail.test', sync_status: 'disabled', last_error: null }, aiConnections: [] })
    out.calendarDisabledNoAi = await html()
    set({ mcp: false })
    out.mcpOff = await html()
    expect(out).toMatchSnapshot()
  })
})
