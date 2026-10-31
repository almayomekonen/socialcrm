// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import { NOW, PENDING_PAGES, PENDING_PHONES, resetSetEnv, setEnv } from './settingsEnv'
import { EXPIRED, setShell, settingsPage } from './settingsHarness'

/**
 * HEBREW BASELINE, phone settings part 1 (i18n Phase F2): server HTML of the
 * REAL `/settings/integrations` page with the device gate answering "phone"
 * (`IntegrationsMobile`: the landing for every WhatsApp / Facebook / Calendar
 * state, every OAuth return the cards read, the ready-messages card states,
 * the phone ready-messages screen (not connected / not ready / empty / list),
 * the website screen) and `/settings/update_security` on a phone (the login
 * activity list). Recorded BEFORE Phase F2 on unmodified code. Interactions:
 * phoneSettingsHebrewBaselineInteractions.test.tsx.
 *
 * No i18n provider. Normalized: React's `<!-- -->` text separators and `useId` values only.
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

vi.mock('@/db/usersNTeams', async () => (await import('./settingsMocks')).usersNTeamsDbModule())
vi.mock('@/db/loginActivity', async () => (await import('./settingsMocks')).loginActivityModule())
vi.mock('@/lib/auth/facebookUserAuthFlags', async () => (await import('./settingsMocks')).facebookUserAuthFlagsModule())
vi.mock('@/actions/usersNteams', async () => (await import('./settingsMocks')).usersNteamsActionsModule())
// The website connectors (Phase E5b) are not phone copy: their screen is scanned with the phone chrome around a stand-in.
const website = vi.hoisted(() => ({ visible: false }))
vi.mock('@/components/settings/integrations/WebsiteConnection', () => ({
  isWebsiteSectionVisible: () => website.visible,
  default: () => <div data-testid='website-connection' />,
}))

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const renderToString = (node: ReactNode) => normalizeIds(renderRaw(<>{node}</>).replaceAll('<!-- -->', ''))
const set = (overrides: Partial<typeof setEnv>) => Object.assign(setEnv, overrides)
const page = async (sp: Record<string, string> = {}, ent?: typeof EXPIRED) => {
  set({ mobile: true, searchParams: sp })
  return renderToString(await setShell(null, await settingsPage('integrations'), ent))
}

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ connected: false }))) as typeof fetch
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetSetEnv()
})

describe('Hebrew baseline — phone Integrations landing', () => {
  test('everything connected; nothing connected; every WhatsApp health status; Facebook repairing / expired / unhealthy', async () => {
    const out: Record<string, string> = {}
    out.connected = await page()
    set({ fbPage: null, waConnection: null, calendar: null, templateCounts: {} })
    out.nothing = await page()
    for (const waStatus of ['registration_pending', 'restricted', 'token', 'webhook', 'throttled', 'unknown', 'disconnected']) {
      resetSetEnv()
      set({ waStatus })
      out[`wa_${waStatus}`] = await page()
    }
    resetSetEnv()
    set({ fbHealth: { tokenValid: true, permissionsOk: true, subscribed: false, needsReconnect: false } })
    out.fbRepairing = await page()
    set({ fbHealth: { tokenValid: false, permissionsOk: true, subscribed: true, needsReconnect: true } })
    out.fbExpired = await page()
    set({ fbHealth: null })
    out.fbNoHealth = await page()
    set({ calendar: { google_email: 'dana@gmail.test', sync_status: 'reauth_required', last_error: 'invalid_grant' } })
    out.calendarReauth = await page()
    set({ calendar: { google_email: null, sync_status: 'ok', last_error: null } })
    out.calendarNoEmail = await page()
    out.expired = await page({}, EXPIRED)
    expect(out.connected).toContain('אינטגרציות')
    expect(out).toMatchSnapshot()
  })

  test('OAuth returns: pending Pages / phones, every error query, calendar and drive returns, deep links', async () => {
    const out: Record<string, string> = {}
    set({ fbPage: null, pendingPages: PENDING_PAGES })
    out.pendingPagesMany = await page()
    set({ fbPage: null, pendingPages: PENDING_PAGES.slice(0, 1) })
    out.pendingPagesOne = await page()
    resetSetEnv()
    set({ fbPage: null })
    for (const error of ['denied', 'no_pages', 'token', 'state', 'unknown_code']) out[`fb_${error}`] = await page({ error })
    out.fbSelectNothing = await page({ select: '1' })
    resetSetEnv()
    set({ waConnection: null, pendingPhones: PENDING_PHONES })
    out.pendingPhone = await page()
    set({ waConnection: null, pendingPhones: [...PENDING_PHONES, { id: 'ph2', displayPhone: '+972 52-000-0000', verifiedName: 'סניף' }] })
    out.pendingPhones = await page()
    set({ pendingPhones: null })
    for (const wa_error of ['cancelled', 'denied', 'no_phones', 'network', 'unknown_code']) out[`wa_${wa_error}`] = await page({ wa_error })
    resetSetEnv()
    set({ calendar: null })
    out.gcalConnecting = await page({ gcal: 'connected' })
    out.gcalDenied = await page({ gcal_error: 'denied' })
    out.gcalFailed = await page({ gcal_error: 'failed' })
    out.gdriveConnected = await page({ gdrive: 'connected' })
    out.gdriveDenied = await page({ gdrive_error: 'denied' })
    out.gdriveFailed = await page({ gdrive_error: 'x' })
    out.sectionWhatsapp = await page({ section: 'whatsapp' })
    out.sectionCalendar = await page({ section: 'google-calendar' })
    expect(out).toMatchSnapshot()
  })

  test('ready-message card states and the phone ready-messages screen', async () => {
    const out: Record<string, string> = {}
    set({ templateCounts: {} })
    out.cardEmpty = await page()
    set({ templateCounts: { pending: 2 } })
    out.cardPending = await page()
    set({ waReady: false })
    out.cardNotReady = await page()
    out.screenNotReady = await page({ section: 'templates' })
    set({ waConnection: null, waReady: true })
    out.cardNotConnected = await page()
    out.screenNotConnected = await page({ section: 'templates' })
    resetSetEnv()
    out.screenList = await page({ section: 'templates' })
    set({ templates: [] })
    out.screenEmpty = await page({ section: 'templates' })
    set({ templatesEnabled: false })
    out.templatesOff = await page({ section: 'templates' })
    resetSetEnv()
    website.visible = true
    out.landingWithWebsite = await page()
    out.website = await page({ section: 'website' })
    website.visible = false
    expect(out.screenList).toContain('הודעות מוכנות')
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — phone security page', () => {
  test('the login activity list on a phone; empty', async () => {
    const out: Record<string, string> = {}
    set({ mobile: true })
    out.list = renderToString(await setShell(null, await settingsPage('security')))
    set({ loginActivity: [] })
    out.empty = renderToString(await setShell(null, await settingsPage('security')))
    expect(out).toMatchSnapshot()
  })
})
