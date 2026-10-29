// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CARD, NOW, NO_CARD, SUBSCRIPTION, TRIAL_ROW, resetSetEnv, setEnv } from './settingsEnv'
import { EXPIRED, setShell, settingsPage, type SettingsPage } from './settingsHarness'

/**
 * HEBREW BASELINE for the user settings pages (Phase E4) — server HTML of every
 * page-level state of /settings/self_edit, update_user_details,
 * update_security, update_default, whatsapp_reminders, update_agency and
 * update_payment. Recorded BEFORE Phase E4 on unmodified product code.
 * (Integrations: settingsHebrewBaselineIntegrations; interactions:
 * settingsHebrewBaselineInteractions / …Connections.)
 *
 * Real server pages, I/O mocked, no i18n provider. Normalized: `<!-- -->`
 * separators and `useId` values only.
 */

vi.mock('next/navigation', async () => (await import('./settingsMocks')).navigationModule('/settings/self_edit'))
vi.mock('next/script', async () => (await import('./settingsMocks')).nextScriptModule())
vi.mock('@/db/auth', async () => (await import('./settingsMocks')).authModule())
vi.mock('@/lib/requireUser', async () => (await import('./settingsMocks')).requireUserModule())
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: null, agencyLocale: null }) }))
vi.mock('@/lib/device', async () => (await import('./settingsMocks')).deviceModule())
vi.mock('@/lib/access/productAccess', async () => (await import('./settingsMocks')).productAccessModule())
vi.mock('@/config/db', async () => (await import('./settingsMocks')).configDbModule())
vi.mock('@/db/usersNTeams', async () => (await import('./settingsMocks')).usersNTeamsDbModule())
vi.mock('@/db/filter', async () => (await import('./settingsMocks')).filterDbModule())
vi.mock('@/db/loginActivity', async () => (await import('./settingsMocks')).loginActivityModule())
vi.mock('@/actions/usersNteams', async () => (await import('./settingsMocks')).usersNteamsActionsModule())
vi.mock('@/actions/filter', async () => (await import('./settingsMocks')).filterActionsModule())
vi.mock('@/actions/linkFacebookAccount', async () => (await import('./settingsMocks')).linkFacebookModule())
vi.mock('@/lib/auth/facebookUserAuthFlags', async () => (await import('./settingsMocks')).facebookUserAuthFlagsModule())
vi.mock('@/lib/flags/ownerWhatsappReminderFlags', async () => (await import('./settingsMocks')).remindersFlagsModule())
vi.mock('@/db/ownerWhatsappRecipients', async () => (await import('./settingsMocks')).ownerRecipientsModule())
vi.mock('@/actions/whatsappReminders', async () => (await import('./settingsMocks')).remindersActionsModule())
vi.mock('@/db/billing/issuer', async () => (await import('./settingsMocks')).issuerDbModule())
vi.mock('@/actions/billing/issuer', async () => (await import('./settingsMocks')).issuerActionsModule())
vi.mock('@/actions/files', async () => (await import('./settingsMocks')).filesActionsModule())
vi.mock('@/lib/quota', async () => (await import('./settingsMocks')).quotaModule())
vi.mock('@/lib/quota/planUsage', async () => (await import('./settingsMocks')).planUsageModule())
vi.mock('@/lib/quota/subscription', async () => (await import('./settingsMocks')).subscriptionModule())
vi.mock('@/lib/payments/cardTrial/recoverCardSetup', async () => (await import('./settingsMocks')).recoverCardModule())
vi.mock('@/lib/payments/cardTrial/cardTrialView', async () => (await import('./settingsMocks')).cardTrialViewModule())
vi.mock('@/db/trial', async () => (await import('./settingsMocks')).trialDbModule())
vi.mock('@/lib/payments/cardTrial/availability', async () => (await import('./settingsMocks')).availabilityModule())
vi.mock('@/actions/subscription', async () => (await import('./settingsMocks')).subscriptionActionsModule())
vi.mock('@/actions/paymentMethod', async () => (await import('./settingsMocks')).paymentMethodActionsModule())
vi.mock('@/actions/trial', async () => (await import('./settingsMocks')).trialActionsModule())
// The lead import inside self_edit is the leads package's (Phase C), baselined there.
vi.mock('@/components/settings/UploadClientData', () => ({ default: () => <div data-stub='UploadClientData' /> }))

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const renderToString = (node: ReactNode) => normalizeIds(renderRaw(<>{node}</>).replaceAll('<!-- -->', ''))
const set = (overrides: Partial<typeof setEnv>) => Object.assign(setEnv, overrides)
const html = async (name: SettingsPage, ent?: typeof EXPIRED) => renderToString(await setShell(null, await settingsPage(name), ent))
const settle = (p: Promise<unknown>) => p.then(() => 'RENDERED', (e: Error) => e.message)

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetSetEnv()
})

describe('Hebrew baseline — account pages (server HTML)', () => {
  test('self_edit: admin, rep, office denial, each deep-linked tab, no saved filters', async () => {
    const out: Record<string, string> = {}
    out.admin = await html('selfEdit')
    set({ user: { ...setEnv.user, role: 'AGENT' } })
    out.rep = await html('selfEdit')
    set({ user: { ...setEnv.user, role: 'OFFICE' } })
    out.office = await html('selfEdit')
    for (const tab of ['ext_users', 'upload', 'filters']) {
      set({ user: { ...setEnv.user, role: 'ADMIN', savedFilters: tab === 'filters' ? [] : setEnv.user.savedFilters }, searchParams: { tab } })
      out[`tab_${tab}`] = await html('selfEdit')
    }
    expect(out).toMatchSnapshot()
  })

  test('update_user_details, update_default (on / off)', async () => {
    const out: Record<string, string> = {}
    out.userDetails = await html('userDetails')
    out.system = await html('system')
    set({ defaults: { isRiskUpdated: false, monthsLidimSheloHufku: null, isMahalotKashotUpdated: true, monthsUpdated: null, isBituachHaimMutzarHaser: false } as never })
    out.systemOff = await html('system')
    expect(out).toMatchSnapshot()
  })

  test('update_security: activity table, no activity, Facebook login linked / not linked', async () => {
    const out: Record<string, string> = {}
    out.base = await html('security')
    set({ loginActivity: [] })
    out.noActivity = await html('security')
    process.env.AUTH_FACEBOOK_APP_ID = 'fb-app'
    set({ facebookUserAuth: true, loginActivity: setEnv.loginActivity })
    out.facebookNotLinked = await html('security')
    set({ facebookLinked: true })
    out.facebookLinked = await html('security')
    delete process.env.AUTH_FACEBOOK_APP_ID
    expect(out).toMatchSnapshot()
  })

  test('whatsapp_reminders: off, pending, expired code, active, opted out; outside the audience / without access → 404', async () => {
    const out: Record<string, string> = {}
    out.off = await html('reminders')
    set({ reminderRow: { status: 'pending', activationExpiresAt: new Date(NOW + 600_000).toISOString(), phoneE164: null } })
    out.pending = await html('reminders')
    set({ reminderRow: { status: 'pending', activationExpiresAt: new Date(NOW - 600_000).toISOString(), phoneE164: null } })
    out.expiredCode = await html('reminders')
    set({ reminderRow: { status: 'active', phoneE164: '+972501234572' } })
    out.active = await html('reminders')
    set({ reminderRow: { status: 'opted_out', phoneE164: null } })
    out.optedOut = await html('reminders')
    set({ remindersAudience: false })
    out.noAudience = await settle(settingsPage('reminders'))
    set({ remindersAudience: true, hasAccess: false })
    out.noAccess = await settle(settingsPage('reminders'))
    expect(out).toMatchSnapshot()
  })

  test('update_agency: issuer form (tier 1 + 2, logo uploader), non-admin, issuer load failure', async () => {
    const out: Record<string, string> = {}
    out.base = await html('agency')
    set({ issuer: { ...setEnv.issuer!, businessType: null, taxId: null, address: null } as never })
    out.partial = await html('agency')
    set({ user: { ...setEnv.user, role: 'AGENT' } })
    out.denied = await html('agency')
    set({ user: { ...setEnv.user, role: 'ADMIN' }, issuer: null })
    out.loadFailed = await html('agency')
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — /settings/update_payment (server HTML)', () => {
  test('subscriber: renewing, cancelling, expired, granted, annual; with a card on file', async () => {
    const out: Record<string, string> = {}
    out.renewing = await html('payment')
    set({ subscription: { ...SUBSCRIPTION, cancelAtPeriodEnd: true, status: 'cancelling' } })
    out.cancelling = await html('payment')
    set({ subscription: { ...SUBSCRIPTION, expiresAt: new Date(NOW - 6 * 86_400_000) }, hasAccess: false })
    out.expired = await html('payment', EXPIRED)
    set({ subscription: { ...SUBSCRIPTION, source: 'grant', manageable: false, expiresAt: null }, hasAccess: true, setupPurpose: 'card_update' })
    out.grantNoCard = await html('payment')
    set({ subscription: { ...SUBSCRIPTION, billingPeriod: 'annual' }, setupPurpose: null })
    out.annual = await html('payment')
    set({ subscription: SUBSCRIPTION, cardView: CARD })
    out.card = await html('payment')
    for (const payment of ['in_progress', 'unknown', 'declined']) {
      set({ cardView: { ...CARD, payment } })
      out[`card_${payment}`] = await html('payment')
    }
    set({ cardView: { ...CARD, cancelAtPeriodEnd: true }, subscription: { ...SUBSCRIPTION, cancelAtPeriodEnd: true, status: 'cancelling' } })
    out.cardCancelling = await html('payment')
    set({ cardView: CARD, subscription: { ...SUBSCRIPTION, source: 'grant', manageable: false } })
    out.cardGranted = await html('payment')
    set({ usage: { leads: { used: 40, limit: 50 }, ai: { used: 3, limit: 10 }, automations: { used: 0, limit: null, created: 0 } } })
    out.cappedUsage = await html('payment')
    expect(out).toMatchSnapshot()
  })

  test('free / trialling: trial without a card (setup offered), trial ending, trial with a card, no trial + payments unavailable, no access, local mode, no charges, non-admin', async () => {
    const out: Record<string, string> = {}
    set({ plan: 'free', subscription: null, usage: null as never, trialRow: TRIAL_ROW, cardView: NO_CARD, setupPurpose: 'trial_start' })
    out.trialNoCard = await html('payment')
    set({ trialRow: { ...TRIAL_ROW, trialEndsAt: new Date(NOW + 20 * 3_600_000) } })
    out.trialLastDay = await html('payment')
    set({ trialRow: TRIAL_ROW, cardView: CARD, setupPurpose: null })
    out.trialCard = await html('payment')
    set({ cardView: { ...CARD, cancelAtPeriodEnd: true } })
    out.trialCardCancelled = await html('payment')
    set({ trialRow: null, cardView: NO_CARD, billingAvailable: false, setupPurpose: 'reactivate' })
    out.unavailable = await html('payment')
    set({ hasAccess: false })
    out.unavailableNoAccess = await html('payment', EXPIRED)
    set({ hasAccess: true, billingAvailable: true, setupPurpose: 'reactivate', charges: [], searchParams: { mode: 'local' } })
    out.reactivateLocalNoCharges = await html('payment')
    set({ user: { ...setEnv.user, role: 'AGENT' }, searchParams: {} })
    out.denied = await html('payment')
    expect(out).toMatchSnapshot()
  })
})
