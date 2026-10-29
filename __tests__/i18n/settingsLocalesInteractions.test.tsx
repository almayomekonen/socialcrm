// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { findHebrewLeaks } from './leakScan'
import { CARD, NOW, NO_CARD, SETTINGS_CUSTOMER_DATA, SUBSCRIPTION, TRIAL_ROW, resetSetEnv, setEnv } from './settingsEnv'
import { CARD_STORAGE_CONSENT_LABEL, CARD_TRIAL_CONSENT_LABEL } from '@/lib/payments/cardTrial/terms'

/**
 * Account and billing interactions (Phase E4) in en / ar: every dialog declares
 * the interface language and shows no Hebrew outside data; validation, inline
 * errors and toasts are worded (the server's Hebrew refusals mapped by
 * sentence); the recorded terms stay Hebrew inside declared Hebrew regions.
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

const { setShell, settingsPage, withSetEnv, EXPIRED } = await import('./settingsHarness')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Loc = 'en' | 'ar'
const DIR = { en: 'ltr', ar: 'rtl' } as const
const DATA = SETTINGS_CUSTOMER_DATA.map((text) => ({ text, reason: 'customer-data' as const }))
const textOf = (el: Element) => (el.textContent ?? '').replace(/[‎‏]/g, '').replace(/\s+/g, ' ')
const has = (text: string, ...parts: string[]) => parts.forEach((p) => expect(text, p).toContain(p))
const regionOf = (el: Element | null | undefined) => [el?.getAttribute('lang') ?? null, el?.getAttribute('dir') ?? null]
const leaks = (el: Element, extra: { text: string; reason: 'recorded-terms' }[] = []) => findHebrewLeaks(el, [...DATA, ...extra], new Set())
const dialog = () => [...document.querySelectorAll('[role="dialog"]')].pop() as HTMLElement
const click = async (el: Element | null | undefined) => act(async () => void fireEvent.click(el!))
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const btn = (text: string) => screen.getAllByText(text).pop()!.closest('button')
const inDialog = (text: string) => [...dialog().querySelectorAll('button')].find((b) => b.textContent === text)
const toasts = () => setEnv.calls.filter((c) => c[0] === 'toast').map((c) => c[2])
const hebrewIn = (v: unknown) => /[֐-׿]/.test(JSON.stringify(v))
/** A copy of `el` without its declared Hebrew regions (the recorded terms). */
function outsideHebrewRegions(el: Element) {
  const copy = el.cloneNode(true) as Element
  copy.querySelectorAll('[lang="he"]').forEach((n) => n.remove())
  return copy
}
const TERMS = [CARD_STORAGE_CONSENT_LABEL, CARD_TRIAL_CONSENT_LABEL.split('תנאי השימוש והתקנון')[0], 'תנאי השימוש והתקנון', CARD_TRIAL_CONSENT_LABEL.split('תנאי השימוש והתקנון')[1]].map((text) => ({ text, reason: 'recorded-terms' as const }))

async function mount(locale: Loc, name: Parameters<typeof settingsPage>[0], overrides: Parameters<typeof withSetEnv>[0] = {}, ent?: typeof EXPIRED) {
  H.prefs.userLocale = locale
  const node = await withSetEnv(overrides, () => settingsPage(name))
  Object.assign(setEnv, overrides)
  return render(await setShell(locale, node, ent))
}
function scan(locale: Loc, name: string) {
  const dlg = dialog()
  expect(regionOf(dlg), `${locale} ${name}`).toEqual([locale, DIR[locale]])
  expect(leaks(dlg), `${locale} ${name}`).toEqual([])
  return textOf(dlg)
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

describe('account dialogs, errors and toasts in en / ar', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`self_edit ${locale}: permission, rep delete / refused / duplicate, transfer, filters`, async () => {
      const en = locale === 'en'
      const { container } = await mount(locale, 'selfEdit')
      const remove = container.querySelector(`button[title="${en ? 'Remove permitted rep' : 'إزالة المندوب المصرّح له'}"]`)
      expect(remove).not.toBeNull()
      await click(remove)
      if (en) has(scan(locale, 'removePerm'), 'Delete this permission?', 'Cancel', 'OK')
      else scan(locale, 'removePerm')
      await click(inDialog(en ? 'OK' : 'موافق'))
      await flush()
      await click(container.querySelector(`button[title="${en ? 'Delete' : 'حذف'}"]`))
      if (en) has(scan(locale, 'deleteRep'), 'Delete יעל שמש?')
      setEnv.results.deleteExtUser = 'throw'
      await click(inDialog(en ? 'OK' : 'موافق'))
      await flush()
      if (en) has(scan(locale, 'refused'), "יעל שמש wasn't deleted because there are leads assigned to them.")
      else scan(locale, 'refused')
      await click(inDialog(en ? 'OK' : 'موافق'))
      setEnv.results.upsertExtUser = 'throw:duplicate key'
      await click(container.querySelector(`button[title="${en ? 'Edit' : 'تعديل'}"]`))
      await act(async () => void fireEvent.submit(container.querySelector('form.max-w-72')!))
      await flush()
      has(scan(locale, 'duplicate'), en ? 'This name already exists in the system' : 'هذا الاسم موجود بالفعل في النظام')
      await click(inDialog(en ? 'OK' : 'موافق'))
      expect(leaks(document.getElementById('transferSales')!)).toEqual([])
      await act(async () => void fireEvent.submit(document.querySelector('#transferSales form')!))
      if (en) has(scan(locale, 'transfer'), 'Transfer the leads of יעל שמש to undefined?')
      else scan(locale, 'transfer')
      await click(inDialog(en ? 'OK' : 'موافق'))
      await flush()
      await click(btn(en ? 'Save' : 'حفظ'))
      await flush()
      expect(hebrewIn(toasts()), `${locale} toasts ${JSON.stringify(toasts())}`).toBe(false)
      if (en) expect(toasts().filter(Boolean)).toEqual(['The permission was deleted', 'Filters saved'])
    })
  }

  test('business details: validation in en / ar, the logo uploader, save toasts', async () => {
    for (const locale of ['en', 'ar'] as const) {
      const { container } = await mount(locale, 'agency')
      fireEvent.change(container.querySelector('input[type="text"]')!, { target: { value: '' } })
      fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: 'nope' } })
      await act(async () => void fireEvent.submit(container.querySelector('form')!))
      const form = container.querySelector('form')!
      expect(leaks(form), locale).toEqual([])
      has(textOf(form), ...(locale === 'en' ? ['Business name is required', 'The email address is not valid', 'Logo', 'A PNG or JPG image.'] : ['اسم النشاط التجاري مطلوب']))
      fireEvent.change(container.querySelector('input[type="text"]')!, { target: { value: 'דנה כהן ייעוץ' } })
      fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: 'billing@example.test' } })
      await act(async () => void fireEvent.submit(form))
      await flush()
      if (locale === 'en') expect(toasts()).toContain('Details saved')
      expect(hebrewIn(toasts())).toBe(false)
      cleanup()
      setEnv.calls.length = 0
    }
  })

  test('WhatsApp reminders: the consent stays Hebrew (declared), refusals are worded, turn-off toast', async () => {
    for (const locale of ['en', 'ar'] as const) {
      const { container } = await mount(locale, 'reminders')
      const consent = container.querySelector('label [lang="he"]')
      expect(regionOf(consent)).toEqual(['he', 'rtl'])
      setEnv.results.startWhatsappReminderActivation = { fail: true, msg: 'התזכורות כבר פעילות' }
      await click(container.querySelector('input[type="checkbox"]'))
      await click(btn(locale === 'en' ? 'Turn on WhatsApp reminders' : 'تفعيل تذكيرات واتساب'))
      await flush()
      setEnv.results.startWhatsappReminderActivation = { fail: true, msg: 'שגיאה לא מוכרת מהשרת' }
      await click(btn(locale === 'en' ? 'Turn on WhatsApp reminders' : 'تفعيل تذكيرات واتساب'))
      await flush()
      if (locale === 'en') expect(toasts()).toEqual(['Reminders are already on', 'שגיאה לא מוכרת מהשרת'])
      cleanup()
      setEnv.calls.length = 0
    }
  })
})

describe('billing dialogs, errors and toasts in en / ar', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`manage plan + card controls ${locale}`, async () => {
      const en = locale === 'en'
      vi.stubGlobal('location', { ...window.location, reload: vi.fn(), assign: vi.fn() })
      let view = await mount(locale, 'payment')
      await click(btn(en ? 'Manage plan' : 'إدارة الباقة'))
      if (en) has(scan(locale, 'manage'), 'Pro plan', 'Next charge: ', 'Status: Active', 'Cancel subscription', 'Close')
      await click(inDialog(en ? 'Cancel subscription' : 'إلغاء الاشتراك'))
      if (en) has(scan(locale, 'confirm'), 'Cancel the Pro plan?', 'your Pro access will stay active until')
      for (const error of ['no_subscription', 'boom']) {
        setEnv.results.cancelRenewal = { error }
        await click(inDialog(en ? 'Cancel subscription' : 'إلغاء الاشتراك'))
        await flush()
        scan(locale, `cancel ${error}`)
      }
      cleanup()
      view = await mount(locale, 'payment', { cardView: CARD })
      await click(btn(en ? 'Replace card' : 'استبدال البطاقة'))
      const card = view.container.querySelector('.mb-6.max-w-3xl.p-6')!
      expect(regionOf(card.querySelector('label [lang="he"]'))).toEqual(['he', 'rtl'])
      expect(leaks(card, TERMS)).toEqual([])
      await click(card.querySelector('input[type="checkbox"]'))
      setEnv.results.startCardSetup = { error: 'provider_unavailable' }
      await click(btn(en ? 'Continue to replace the card' : 'متابعة استبدال البطاقة'))
      await flush()
      if (en) has(textOf(card), "We couldn't open the payment page.")
      await click(btn(en ? 'Back' : 'رجوع'))
      await click(btn(en ? 'Cancel before the charge' : 'الإلغاء قبل الخصم'))
      if (en) has(scan(locale, 'cardCancel'), 'Cancel the subscription renewal?', 'No ₪89 charge will be made.')
      for (const error of ['reactivation_required', 'no_subscription', 'boom']) {
        setEnv.results.cancelRenewal = { error }
        await click(inDialog(en ? 'Cancel subscription' : 'إلغاء الاشتراك'))
        await flush()
        expect(leaks(view.container), `${locale} ${error}`).toEqual([])
      }
      cleanup()
      await mount(locale, 'payment', { subscription: { ...SUBSCRIPTION, expiresAt: new Date(NOW - 86_400_000) }, hasAccess: false }, EXPIRED)
      await click(btn(en ? 'Manage plan' : 'إدارة الباقة'))
      if (en) has(scan(locale, 'expired'), 'Subscription ended on', 'Status: Subscription ended', 'Renew subscription')
    })

    test(`card setup form ${locale}: chrome worded, terms Hebrew, every refusal`, async () => {
      const en = locale === 'en'
      vi.stubGlobal('location', { ...window.location, assign: vi.fn() })
      const view = await mount(locale, 'payment', { plan: 'free', subscription: null, usage: null as never, trialRow: TRIAL_ROW, cardView: NO_CARD, setupPurpose: 'trial_start' })
      const setup = view.container.querySelector('#card-setup')!
      // Hebrew only inside the declared recorded-terms regions.
      expect(leaks(outsideHebrewRegions(setup)), locale).toEqual([])
      expect(setup.querySelectorAll('[lang="he"]').length, 'disclosure + two consents').toBe(3)
      for (const he of setup.querySelectorAll('[lang="he"]')) expect(he.getAttribute('dir')).toBe('rtl')
      if (en) has(textOf(setup), 'Full name as it appears on the card', 'Mobile phone', 'Read the terms of use and regulations', "Card details are entered on Grow's secure page.", 'Add a card and start the trial')
      for (const error of ['unauthorized', 'not_eligible', 'provider_unavailable', 'terms_required', 'card_storage_consent_required', 'unknown']) {
        setEnv.results.startCardSetup = { error }
        await click(btn(en ? 'Add a card and start the trial' : 'إضافة بطاقة وبدء الفترة التجريبية'))
        await flush()
        const alert = setup.querySelector('[role="alert"]')!
        expect(hebrewIn(alert.textContent), `${locale} ${error}`).toBe(false)
      }
      setEnv.results.startCardSetup = 'throw'
      await click(btn(en ? 'Add a card and start the trial' : 'إضافة بطاقة وبدء الفترة التجريبية'))
      await flush()
      has(textOf(setup.querySelector('[role="alert"]')!), en ? 'A network error occurred, please try again' : 'حدث خطأ في الشبكة')
    })
  }
})
