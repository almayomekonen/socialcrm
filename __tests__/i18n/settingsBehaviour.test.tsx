// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NOW, TRIAL_ROW, NO_CARD, resetSetEnv, setEnv } from './settingsEnv'
import { FACEBOOK_NOTICES, WHATSAPP_NOTICES, facebookNotice, whatsappHealthNotice, whatsappNotice } from '@/lib/connections/messages'
import { facebookNoticeFor, localizeFacebookNotice, localizeWhatsappNotice, whatsappHealthNoticeFor, whatsappNoticeFor } from '@/lib/connections/localizedNotices'
import { metaSignupErrorNextStep } from '@/lib/connections/metaSignupErrorSteps'
import { TEMPLATE_REJECTION_COPY, TEMPLATE_STATUS_LABELS, TEMPLATE_VALIDATION_COPY } from '@/lib/whatsapp/templates/messages'
import { RATE_LIMIT_MESSAGE } from '@/lib/whatsapp/templates/rateLimit'
import { SCOPE_LABELS_HE } from '@/lib/oauth/server/config'
import { PRO_INCLUDED, packages } from '@/lib/plans'
import { INTEGRATIONS } from '@/components/settings/integrations/catalog'
import { ISSUER_FIELDS } from '@/lib/billing/issuer/fields'
import { localizeIssuerFields } from '@/components/billing/issuer/localizedFields'
import { relativeDaysLabel, relativeDaysLabelFor } from '@/components/settings/payment/subscriptionDates'
import { he } from '@/lib/i18n/messages/he'

/**
 * User settings behaviour (Phase E4): the Hebrew catalog equals the constants
 * it was copied from; the localized producers return the constants themselves
 * in Hebrew and keep every notice's code, tone and actions elsewhere; every
 * form and action receives IDENTICAL arguments in he / en / ar (stored values
 * — minutes, tokens, codes, the typed text — never change); dialogs close on
 * Escape and return focus; icon-only controls are named in the language.
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

const { setShell, settingsPage, withSetEnv } = await import('./settingsHarness')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const LOCALES = ['he', 'en', 'ar'] as const
const S = he.settings
const hebrewIn = (v: unknown) => /[֐-׿]/.test(JSON.stringify(v))
const click = async (el: Element | null | undefined) => act(async () => void fireEvent.click(el!))
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const actions = () => JSON.parse(JSON.stringify(setEnv.calls.filter((c) => c[0] !== 'toast' && c[0] !== 'router.refresh')))

async function mount(locale: (typeof LOCALES)[number], name: Parameters<typeof settingsPage>[0], overrides: Parameters<typeof withSetEnv>[0] = {}) {
  H.prefs.userLocale = locale
  const earlier = [...setEnv.calls] // calls of earlier mounts in the same run
  const node = await withSetEnv(overrides, () => settingsPage(name))
  Object.assign(setEnv, overrides)
  setEnv.calls.unshift(...earlier)
  return render(await setShell(locale === 'he' ? null : locale, node))
}

const savedEnv = { ...process.env }
beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {} })
  for (const k of ['log', 'warn', 'error'] as const) vi.spyOn(console, k).mockImplementation(() => {})
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
  vi.unstubAllGlobals()
})

describe('the Hebrew catalog is the constants it was copied from', () => {
  test('connection notices, the WhatsApp actions, the Meta steps', () => {
    for (const [code, keys] of Object.entries(S.fb)) {
      const n = FACEBOOK_NOTICES[code]
      const k = keys as Record<string, string>
      expect([k.title, k.explanation, [k.reason1, k.reason2, k.reason3].filter(Boolean), k.nextStep, k.action], code).toEqual([n.title, n.explanation, n.reasons ?? [], n.nextStep, n.action])
    }
    for (const [code, keys] of Object.entries(S.wa)) {
      const n = WHATSAPP_NOTICES[code]
      const k = keys as Record<string, string>
      expect([k.title, k.explanation, [k.reason1, k.reason2].filter(Boolean), k.nextStep, k.action], code).toEqual([n.title, n.explanation, n.reasons ?? [], n.nextStep, n.action])
    }
    for (const [code, action] of Object.entries(S.waAction)) expect(action, code).toBe(WHATSAPP_NOTICES[code].action)
    expect(whatsappNotice('meta_error', 'X')!.explanation).toBe(S.metaShown.replace('{message}', 'X'))
    expect(S.integrations.reasonsLabel).toBe('בדרך כלל בגלל:')
  })

  test('ready messages, plans, integrations catalog, AI scopes, issuer tier 2, the server refusals', () => {
    expect(S.templates.status).toEqual(TEMPLATE_STATUS_LABELS)
    expect(S.templates.rejection).toEqual(TEMPLATE_REJECTION_COPY)
    expect(S.templates.validation).toEqual(TEMPLATE_VALIDATION_COPY)
    expect(S.templates.error.rateLimit).toBe(RATE_LIMIT_MESSAGE)
    expect(Object.values(S.payment.packages.included)).toEqual(PRO_INCLUDED)
    expect(S.payment.packages.tagline).toBe(packages[0].tagline)
    const drive = INTEGRATIONS.find((i) => i.id === 'google-drive')!
    expect([S.integrations.drive.description, S.integrations.drive.connect, S.integrations.drive.disconnected]).toEqual([drive.description, drive.connectLabel, drive.disconnectedToast])
    expect([S.integrations.ai.scope.leads, S.integrations.ai.scope.conversations]).toEqual([SCOPE_LABELS_HE['crm.leads.read'], SCOPE_LABELS_HE['crm.conversations.read']])
    for (const f of ISSUER_FIELDS.filter((x) => x.tier === 2)) {
      const k = he.billing.issuer.field[f.key as 'address'] as Record<string, string>
      // A placeholder that is a sample number / address in Latin script stays the registry's (no key).
      expect([k.label, k.help, k.placeholder ?? f.placeholder], f.key).toEqual([f.label, f.helpText, f.placeholder])
    }
  })
})

describe('localized producers', () => {
  test('Hebrew returns the constants themselves; other languages keep code, tone and reserved actions', () => {
    for (const code of [...Object.keys(FACEBOOK_NOTICES), 'nope']) {
      expect(facebookNoticeFor(code, 'he')).toBe(facebookNotice(code))
      for (const locale of ['en', 'ar'] as const) {
        const n = facebookNoticeFor(code, locale)!
        // `secondary` is reserved and never rendered (lib/connections/messages.ts): kept as it is.
        expect(hebrewIn({ ...n, secondary: undefined }), `${locale} fb ${code}`).toBe(false)
        expect([n.tone, !!n.action, n.secondary], code).toEqual([facebookNotice(code)!.tone, !!facebookNotice(code)!.action, facebookNotice(code)!.secondary])
      }
    }
    for (const code of [...Object.keys(WHATSAPP_NOTICES), 'cancelled', 'nope']) {
      expect(whatsappNoticeFor(code, null, 'he')).toBe(whatsappNotice(code))
      for (const locale of ['en', 'ar'] as const) {
        const n = whatsappNoticeFor(code, null, locale)
        expect(n === null, code).toBe(whatsappNotice(code) === null)
        if (n) expect([hebrewIn({ ...n, secondary: undefined }), n.tone, !!n.action], `${locale} wa ${code}`).toEqual([false, whatsappNotice(code)!.tone, !!whatsappNotice(code)!.action])
      }
    }
    for (const status of ['operational', 'registration_pending', 'inbound_only', 'restricted', 'token', 'webhook', 'throttled', 'unknown'] as const) {
      expect(whatsappHealthNoticeFor(status, 'he')).toBe(whatsappHealthNotice(status))
      expect(hebrewIn({ ...whatsappHealthNoticeFor(status, 'en'), secondary: undefined }), status).toBe(false)
    }
    expect(localizeFacebookNotice({ tone: 'error', title: 'לא מוכר', explanation: 'x' }, 'en')!.title).toBe('לא מוכר')
    expect(localizeWhatsappNotice(null, 'en')).toBeNull()
    const meta = 'This phone number has been blocked'
    expect(metaSignupErrorNextStep(meta)).toBe(metaSignupErrorNextStep(meta, 'he'))
    expect(hebrewIn(metaSignupErrorNextStep(meta, 'ar'))).toBe(false)
    expect(metaSignupErrorNextStep('unknown', 'en')).toBeNull()
    for (const d of [-9, -1, 0, 1, 27]) expect(relativeDaysLabelFor(d, 'he')).toBe(relativeDaysLabel(d))
    expect([relativeDaysLabelFor(1, 'en'), relativeDaysLabelFor(-3, 'en'), relativeDaysLabelFor(12, 'en')]).toEqual(['tomorrow', '3 days ago', 'in 12 days'])
    expect(localizeIssuerFields(ISSUER_FIELDS, 'he')).toBe(ISSUER_FIELDS)
    expect(hebrewIn(localizeIssuerFields(ISSUER_FIELDS, 'en').map(({ label, helpText, placeholder }) => [label, helpText, placeholder]))).toBe(false)
  })
})

describe('identical arguments in every language', () => {
  test('account forms, reminders, the issuer form', async () => {
    const runs: Record<string, unknown[]> = {}
    for (const locale of LOCALES) {
      let v = await mount(locale, 'userDetails')
      for (const form of v.container.querySelectorAll('form')) await act(async () => void fireEvent.submit(form))
      cleanup()
      v = await mount(locale, 'security')
      fireEvent.change(v.container.querySelector('select')!, { target: { value: '30' } })
      await act(async () => void fireEvent.submit(v.container.querySelector('form')!))
      cleanup()
      v = await mount(locale, 'system')
      await click(v.container.querySelector('input[name="isRiskUpdated"]'))
      await act(async () => void fireEvent.submit(v.container.querySelector('form')!))
      cleanup()
      v = await mount(locale, 'reminders')
      await click(v.container.querySelector('input[type="checkbox"]'))
      await click([...v.container.querySelectorAll('button')].at(-1))
      cleanup()
      v = await mount(locale, 'agency')
      await act(async () => void fireEvent.submit(v.container.querySelector('form')!))
      await flush()
      runs[locale] = actions()
      setEnv.calls.length = 0
      cleanup()
    }
    expect(runs.he.length).toBeGreaterThan(5)
    expect(runs.en).toEqual(runs.he)
    expect(runs.ar).toEqual(runs.he)
    expect(JSON.stringify(runs.he)).toContain('"logoutMinutes":"30"')
  })

  test('integrations: ready message (stored token), Messenger profile and saved reply, card setup', async () => {
    const runs: Record<string, unknown[]> = {}
    for (const locale of LOCALES) {
      vi.stubGlobal('location', { ...window.location, assign: vi.fn() })
      let v = await mount(locale, 'integrations')
      const create = [...v.container.querySelectorAll('button')].find((b) => b.querySelector('[class*="plus"]') || b.textContent?.includes(locale === 'he' ? 'הודעה מוכנה חדשה' : locale === 'en' ? 'New ready message' : 'رسالة جاهزة جديدة'))
      await click(create)
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop()!
      fireEvent.change(dlg.querySelector('input')!, { target: { value: 'Reminder' } })
      await click([...dlg.querySelectorAll('button')].find((b) => b.textContent?.startsWith('+ ')))
      await click(dlg.querySelectorAll('input[type="radio"]')[1])
      await click([...dlg.querySelectorAll('button')].at(-1))
      await flush()
      await click(document.getElementById('messenger')!.querySelector('button'))
      await flush()
      const replies = document.getElementById('messenger-replies')!
      await click([...replies.querySelectorAll('button')].find((b) => b.getAttribute('aria-label')?.includes('שעות פעילות') && !b.getAttribute('title')))
      await click([...replies.querySelectorAll('button')].filter((b) => !b.getAttribute('aria-label')).at(-2))
      await flush()
      cleanup()
      v = await mount(locale, 'payment', { plan: 'free', subscription: null, usage: null as never, trialRow: TRIAL_ROW, cardView: NO_CARD, setupPurpose: 'trial_start' })
      for (const box of v.container.querySelectorAll('#card-setup input[type="checkbox"]')) await click(box)
      await click([...v.container.querySelectorAll('#card-setup button')].at(-1))
      await flush()
      runs[locale] = actions().filter((c: unknown[]) => c[0] !== 'launch')
      setEnv.calls.length = 0
      cleanup()
      vi.unstubAllGlobals()
    }
    expect(runs.he.map((c) => c[0])).toEqual(['createTemplate', 'updateMessengerProfile', 'updateSavedReply', 'startCardSetup'])
    expect(runs.en).toEqual(runs.he)
    expect(runs.ar).toEqual(runs.he)
    expect(JSON.stringify(runs.en[0])).toContain('שם הליד') // the stored variable token
  })
})

describe('dialogs and names', () => {
  test('Escape closes the manage-plan dialog and returns focus to its opener; icon-only controls are named', async () => {
    for (const locale of ['en', 'ar'] as const) {
      const v = await mount(locale, 'payment')
      const opener = screen.getByText(locale === 'en' ? 'Manage plan' : 'إدارة الباقة').closest('button')!
      opener.focus()
      await click(opener)
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop()!
      expect(dlg.getAttribute('aria-label')).toBe(locale === 'en' ? 'Manage subscription' : 'إدارة الاشتراك')
      fireEvent.keyDown(dlg, { key: 'Escape' })
      await flush()
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(document.activeElement).toBe(opener)
      cleanup()
      const s = await mount(locale, 'selfEdit')
      const remove = s.container.querySelector('button[title]')!
      expect(hebrewIn(remove.getAttribute('title'))).toBe(false)
      cleanup()
      const i = await mount(locale, 'integrations')
      for (const el of i.container.querySelectorAll('[aria-label]')) expect(hebrewIn(el.getAttribute('aria-label')!.replace('שעות פעילות', '')), el.outerHTML.slice(0, 80)).toBe(false)
      void v
      cleanup()
    }
  })
})
