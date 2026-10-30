// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { act, cleanup, render } from '@testing-library/react'
import { findHebrewLeaks } from './leakScan'
import { NOW, SETTINGS_CUSTOMER_DATA, resetSetEnv, setEnv } from './settingsEnv'

/**
 * User settings pages (Phase E4) in en / ar: every registered page state (the
 * leak-gate surfaces) declares its language on its root, shows no Hebrew
 * outside data / recorded terms, and nothing in it is declared Hebrew except
 * the recorded-terms islands; Hebrew declares nothing; the tab title; a
 * language switch within one session; hydration he / en / ar.
 */

const H = vi.hoisted(() => ({ prefs: { userLocale: 'en' as string | null } }))
vi.mock('next/navigation', async () => (await import('./settingsMocks')).navigationModule())
vi.mock('next/headers', async () => (await import('./settingsMocks')).headersModule())
vi.mock('next/script', async () => (await import('./settingsMocks')).nextScriptModule())
vi.mock('@/lib/toast', async () => (await import('./settingsMocks')).toastModule())
vi.mock('@/lib/analytics/track', () => ({ track: () => {} }))
vi.mock('@/db/auth', async () => (await import('./settingsMocks')).authModule())
vi.mock('@/lib/requireUser', async () => (await import('./settingsMocks')).requireUserModule())
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: H.prefs.userLocale, agencyLocale: null }) }))
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
vi.mock('@/components/settings/UploadClientData', () => ({ default: () => <div data-stub='UploadClientData' /> }))
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

const { SETTINGS_SURFACES } = await import('./settingsSurfaces')
const { setShell, settingsPage, withSetEnv } = await import('./settingsHarness')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DIR = { en: 'ltr', ar: 'rtl' } as const
const textOf = (el: Element) => (el.textContent ?? '').replace(/[‎‏]/g, '').replace(/\s+/g, ' ')
const has = (text: string, ...parts: string[]) => parts.forEach((p) => expect(text, p).toContain(p))
const DATA = SETTINGS_CUSTOMER_DATA.map((text) => ({ text, reason: 'customer-data' as const }))
const regionOf = (el: Element | null | undefined) => [el?.getAttribute('lang') ?? null, el?.getAttribute('dir') ?? null]

const savedEnv = { ...process.env }
beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {} })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  Object.assign(process.env, { UI_LOCALE_ENABLED: '1', UI_LOCALE_AGENCY_ALLOWLIST: '103' })
})
afterAll(() => {
  vi.useRealTimers()
  process.env = { ...savedEnv }
})
afterEach(() => {
  cleanup()
  resetSetEnv()
})

/** What each surface must say in English (a sample per screen). */
const EN: Record<string, string[]> = {
  'settings — account (admin)': ['Account settings', 'Personal details', 'Start here', 'Access permissions', 'Reps for assigning leads', 'Send an invitation to a system user', 'Upload leads', 'Saved filters', 'Add rep', 'Permitted reps:', 'Save'],
  'settings — account, office role denied': ["You don't have permission to view this page"],
  'settings — rep details': ['Rep details', 'Update personal details', 'Update contact details', 'First name', 'ID number', 'Business email', 'Save changes', 'Landline'],
  'settings — security': ['Security', 'Your account security settings', 'Automatic sign-out time', '20 minutes', 'Recent sign-in activity', 'Device / browser', 'IP address', 'When'],
  'settings — system settings': ['System settings', 'Lead detection', 'Turn on cold lead detection', 'months', 'Assignment management', 'Highlight leads with no rep', 'Save settings'],
  'settings — WhatsApp reminders, off': ['WhatsApp reminders', 'My reminders', 'Turn on WhatsApp reminders'],
  'settings — WhatsApp reminders, pending code': ["An activation code was created but hasn't been sent yet.", 'Create a new activation code', 'Cancel'],
  'settings — WhatsApp reminders, active': ['Reminders are on and sent to', '••••••72', 'send "STOP"', 'Turn off reminders'],
  'settings — business details (issuer, logo)': ['Business details', 'Business name', 'Business type', 'Licensed dealer', 'Address', 'Email for invoices', 'Logo', 'Save details'],
  'settings — business details, not an admin': ["You don't have permission to view this page"],
  'billing centre — Pro renewing, usage, history': ['Plan and billing', 'Current plan: Pro', 'Active subscription', 'Billing period: Monthly · ₪89 a month', 'Next renewal', 'in 12 days', "What's included in Pro", 'Manage plan', 'Your plan usage', 'Charge history', 'Paid', 'Payment method'],
  'billing centre — cancelling, card on file': ['Cancellation request received', 'Pro access until', 'Saved card · Visa •••• 4242', 'No further charge will be made.', 'Resume subscription'],
  'billing centre — subscription ended': ['Subscription ended', 'Subscription ended on'],
  'billing centre — granted Pro, card declined': ['Full Pro access · no charge and no end date', "The last charge wasn't approved.", 'Replace card'],
  'billing centre — trial, card with charge in progress, local mode': ['Development mode', 'Trial', 'Trial active', '4 days left in the trial', 'Plans', 'Your trial', 'Current plan: Pro'],
  'billing centre — payments unavailable, no charges': ["A payment method can't be added right now", 'No charges yet', 'Plan: Free', 'Status: inactive'],
  'integrations — everything connected': ['Integrations', 'Lead sources', 'Connected to Page:', 'The connection is working', 'Disconnect Page', 'Disconnect WhatsApp', 'Messenger greeting and menu', 'Persistent menu', 'Messenger saved replies', '1 quick reply', 'WhatsApp ready messages', '1 ready', 'Rejected', 'In WhatsApp review', 'Ready to send', 'Connected tools', 'Google Calendar', 'AI connections', 'Disconnect Claude'],
  'integrations — Facebook repairing, WhatsApp expired, Messenger read failure': ['The connection is updating — no action needed', 'The WhatsApp connection has expired', 'Usually because:', 'Reconnect'],
  'integrations — nothing connected, ready messages need WhatsApp, no AI': ['Connect your Facebook Page to receive leads automatically.', 'Connect Facebook account', 'Connect WhatsApp Business', 'Connect WhatsApp Business first', 'Go to the WhatsApp connection'],
  'integrations — WhatsApp not ready, no ready messages, subscription expired': ['Your connections stay active.', 'No WhatsApp ready messages yet', 'Create a ready message'],
}

describe('settings pages in en / ar', () => {
  for (const surface of SETTINGS_SURFACES) {
    test(surface.name, async () => {
      for (const locale of ['en', 'ar'] as const) {
        H.prefs.userLocale = locale
        const { container } = render(await surface.render(locale))
        const root = container.firstElementChild?.matches('[role="status"], .mb-6') ? container.querySelector('[lang]') : container.firstElementChild
        expect(regionOf(root), `${locale} ${surface.name}`).toEqual([locale, DIR[locale]])
        // This file's mocks answer every read from the settings fixtures (the gate shares some with other screens), so all declared data may show.
        expect(findHebrewLeaks(container, [...surface.allowed, ...DATA], new Set()), `${locale} ${surface.name}`).toEqual([])
        // Only the recorded-terms islands are declared Hebrew.
        for (const he of container.querySelectorAll('[lang="he"]')) expect(he.textContent, `${locale} ${surface.name}`).toMatch(/מאשר\/ת|SocialCRM/)
        if (locale === 'en') has(textOf(container), ...(EN[surface.name] ?? []))
        cleanup()
      }
      H.prefs.userLocale = 'he'
      const { container } = render(await surface.render('he'))
      expect(container.querySelector('[lang]'), `he ${surface.name}: Hebrew declares nothing`).toBeNull()
    })
  }
})

describe('tab title, language switch, hydration', () => {
  test('the user-settings group and integrations titles follow the interface language', async () => {
    const group = await import('@/app/(app)/settings/(user_settings)/layout')
    const integrations = await import('@/app/(app)/settings/(user_settings)/integrations/page')
    for (const [locale, g, i] of [['he', 'הגדרות אישיות', 'אינטגרציות'], ['en', 'Personal settings', 'Integrations'], ['ar', 'الإعدادات الشخصية', 'التكاملات']] as const) {
      H.prefs.userLocale = locale
      expect((await group.generateMetadata()).title, locale).toBe(g)
      expect((await integrations.generateMetadata()).title, locale).toBe(i)
    }
  })

  test('a page re-renders in the new language within one session', async () => {
    H.prefs.userLocale = 'en'
    const node = await withSetEnv({}, () => settingsPage('selfEdit'))
    const v = render(await setShell('en', node))
    has(textOf(v.container), 'Account settings', 'Saved filters')
    v.rerender(await setShell('ar', node))
    has(textOf(v.container), 'إعدادات الحساب', 'الفلاتر المحفوظة')
    expect(regionOf(v.container.firstElementChild)).toEqual(['ar', 'rtl'])
    v.rerender(await setShell('he', node))
    has(textOf(v.container), 'הגדרות החשבון', 'סינונים שמורים')
    expect(v.container.firstElementChild?.getAttribute('lang')).toBeNull()
  })

  for (const locale of ['he', 'en', 'ar'] as const) {
    for (const name of ['selfEdit', 'security', 'reminders', 'agency', 'payment', 'integrations'] as const) {
      test(`hydration ${locale} · ${name}`, async () => {
        H.prefs.userLocale = locale
        const node = await setShell(locale, await withSetEnv(name === 'payment' ? { cardView: setEnv.cardView } : {}, () => settingsPage(name)))
        const container = document.createElement('div')
        container.innerHTML = renderToString(node)
        document.body.appendChild(container)
        const errors: unknown[] = []
        const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a))
        let root: ReturnType<typeof hydrateRoot> | undefined
        await act(async () => {
          root = hydrateRoot(container, node, { onRecoverableError: (e) => errors.push(e) })
        })
        spy.mockRestore()
        expect(errors.map((e) => (Array.isArray(e) ? e.map(String).join(' ') : String(e)).slice(0, 400))).toEqual([])
        act(() => root!.unmount())
        container.remove()
      })
    }
  }
})
