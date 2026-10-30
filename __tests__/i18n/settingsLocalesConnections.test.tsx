// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { findHebrewLeaks } from './leakScan'
import { NOW, PENDING_PAGES, PENDING_PHONES, SETTINGS_CUSTOMER_DATA, resetSetEnv, setEnv } from './settingsEnv'

/**
 * Integrations interactions (Phase E4) in en / ar: every Facebook `?error=`
 * code and WhatsApp `?wa_error=` / launch failure / health notice, the Page and
 * number pickers, disconnect dialogs, the ready-message dialog (labels,
 * variable chips, validation, server refusals mapped by sentence, confirms),
 * Messenger failures and the saved-reply form, Calendar / Drive / AI dialogs
 * and toasts. Meta's own error text is shown as received.
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

type Loc = 'en' | 'ar'
const DIR = { en: 'ltr', ar: 'rtl' } as const
const DATA = SETTINGS_CUSTOMER_DATA.map((text) => ({ text, reason: 'customer-data' as const }))
const textOf = (el: Element) => (el.textContent ?? '').replace(/[‎‏⁨⁩]/g, '').replace(/\s+/g, ' ')
const has = (text: string, ...parts: string[]) => parts.forEach((p) => expect(text, p).toContain(p))
const regionOf = (el: Element | null | undefined) => [el?.getAttribute('lang') ?? null, el?.getAttribute('dir') ?? null]
const leaks = (el: Element) => findHebrewLeaks(el, DATA, new Set())
const dialog = () => [...document.querySelectorAll('[role="dialog"]')].pop() as HTMLElement
const click = async (el: Element | null | undefined) => act(async () => void fireEvent.click(el!))
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const btn = (text: string) => screen.getAllByText(text).pop()!.closest('button')
const inDialog = (text: string) => [...dialog().querySelectorAll('button')].find((b) => b.textContent === text)
const section = (id: string) => document.getElementById(id)!
const toasts = () => setEnv.calls.filter((c) => c[0] === 'toast').map((c) => c[2])
const hebrewIn = (v: unknown) => /[֐-׿]/.test(JSON.stringify(v))
const fetchMock = (ok: boolean, json: unknown = {}) => vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => json }))

async function mount(locale: Loc, overrides: Parameters<typeof withSetEnv>[0] = {}) {
  H.prefs.userLocale = locale
  const earlier = [...setEnv.calls] // toasts of earlier mounts in the same test
  const node = await withSetEnv(overrides, () => settingsPage('integrations'))
  Object.assign(setEnv, overrides)
  setEnv.calls.unshift(...earlier)
  return render(await setShell(locale, node))
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

const FB_CODES = ['denied', 'missing_permission', 'no_page_selected', 'no_pages', 'comments_permission', 'pages_permission', 'resource_claimed', 'token', 'state', 'no_code', 'subscription_failed', 'selection_expired', 'save_failed', 'expired', 'messenger_permission', 'messenger_declined', 'unknown_code']
const WA_CODES = ['not_completed', 'verification_incomplete', 'sdk', 'config', 'token', 'network', 'missing_details', 'no_accounts', 'no_phones', 'not_ready', 'subscribe_incomplete', 'needs_verification', 'resource_claimed', 'restricted', 'expired', 'webhook', 'throttled', 'in_app_browser']

describe('Facebook and WhatsApp in en / ar', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`every notice code is worded (${locale})`, async () => {
      for (const error of FB_CODES) {
        const { container } = await mount(locale, { fbPage: null, messenger: { visible: false }, searchParams: { error } })
        const fb = section('facebook')
        expect(leaks(fb), `${locale} fb ${error}`).toEqual([])
        expect(fb.querySelector('[role="status"]'), `${locale} fb ${error}`).not.toBeNull()
        if (locale === 'en' && error === 'no_pages') has(textOf(fb), "We didn't find a Facebook Page that can be connected", 'Usually because:', "I've checked the Page and access, try connecting again")
        void container
        cleanup()
      }
      for (const wa_error of WA_CODES) {
        await mount(locale, { waConnection: null, waStatus: 'disconnected', searchParams: { wa_error } })
        expect(leaks(section('whatsapp')), `${locale} wa ${wa_error}`).toEqual([])
        cleanup()
      }
      for (const waStatus of ['registration_pending', 'restricted', 'token', 'webhook', 'throttled', 'unknown']) {
        await mount(locale, { waStatus })
        const wa = section('whatsapp')
        expect(leaks(wa), `${locale} health ${waStatus}`).toEqual([])
        if (locale === 'en' && waStatus === 'unknown') has(textOf(wa), 'Reconnect and verify')
        if (locale === 'en' && waStatus === 'registration_pending') has(textOf(wa), 'Usually because:')
        cleanup()
      }
    })

    test(`dialogs, pickers, launch failures and toasts (${locale})`, async () => {
      const en = locale === 'en'
      vi.stubGlobal('fetch', fetchMock(false))
      await mount(locale)
      await click(btn(en ? 'Disconnect Page' : 'فصل الصفحة'))
      if (en) has(scan(locale, 'fbDisconnect'), 'Disconnect the Page "סטודיו דנה"?')
      await click(inDialog(en ? 'OK' : 'موافق'))
      await flush()
      await click(btn(en ? 'Disconnect WhatsApp' : 'فصل واتساب'))
      if (en) has(scan(locale, 'waDisconnect'), 'Disconnect the WhatsApp connection?')
      fireEvent.keyDown(dialog(), { key: 'Escape' })
      cleanup()
      // A Meta error keeps Meta's words; a documented one gets its step.
      await mount(locale, { waStatus: 'token' })
      setEnv.results.launch = { ok: false, error: 'cancelled', cancel: { errorReported: true, errorMessage: 'This phone number is registered to an existing WhatsApp account.' } }
      await click(section('whatsapp').querySelector('div[data-edu="whatsapp-connect"] button'))
      await flush()
      const notice = section('whatsapp').querySelector('[role="status"]')!
      expect(leaks(notice)).toEqual([])
      has(textOf(notice), '"This phone number is registered to an existing WhatsApp account."')
      if (en) has(textOf(notice), "We couldn't complete the WhatsApp connection", 'The number is active in another WhatsApp account.')
      cleanup()
      vi.stubGlobal('fetch', fetchMock(false, { error: 'resource_claimed' }))
      await mount(locale, { fbPage: null, pendingPages: PENDING_PAGES, messenger: { visible: false } })
      expect(leaks(section('facebook'))).toEqual([])
      fireEvent.change(section('facebook').querySelector('select')!, { target: { value: 'p2' } })
      await click(section('facebook').querySelector('div[data-edu="facebook-connect"] button'))
      await flush()
      if (en) has(textOf(section('facebook')), 'The Page is already connected to another account', 'Choose the Page you want to connect:')
      vi.stubGlobal('fetch', fetchMock(true))
      await click(section('facebook').querySelector('div[data-edu="facebook-connect"] button'))
      await flush()
      cleanup()
      await mount(locale, { waConnection: null, waStatus: 'disconnected', pendingPhones: PENDING_PHONES })
      expect(leaks(section('whatsapp'))).toEqual([])
      if (en) has(textOf(section('whatsapp')), 'Choose the phone number you want to connect:', 'Business WhatsApp number', 'Choose a number...')
      expect(hebrewIn(toasts().filter((t) => !String(t).includes('סטודיו דנה'))), JSON.stringify(toasts())).toBe(false)
      if (en) expect(toasts()).toEqual(["Couldn't disconnect the Page", 'The Page "Dana Studio EN" was connected'])
    })
  }
})

describe('ready messages, Messenger, Calendar / Drive / AI in en / ar', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`ready-message dialog and row actions (${locale})`, async () => {
      const en = locale === 'en'
      await mount(locale)
      await click(btn(en ? 'New ready message' : 'رسالة جاهزة جديدة'))
      const text = scan(locale, 'create')
      if (en) has(text, 'New ready message', 'Message name', 'Message content', 'Add personal details:', '+ Lead name', '+ Business name', "What's the purpose of the message?", 'Message preview', 'Submit for review')
      const dlg = dialog()
      fireEvent.change(dlg.querySelector('input')!, { target: { value: 'Reminder' } })
      fireEvent.change(dlg.querySelector('textarea')!, { target: { value: 'Hi {{1}}' } })
      await click(dlg.querySelector('input[type="radio"]'))
      await click(inDialog(en ? 'Submit for review' : 'إرسال للمراجعة'))
      expect(hebrewIn(dlg.querySelector('[role="alert"]')!.textContent)).toBe(false)
      // The inserted token is the STORED one (the chip label is translated).
      fireEvent.change(dlg.querySelector('textarea')!, { target: { value: '' } })
      await click([...dlg.querySelectorAll('button')].find((b) => b.textContent?.startsWith('+ ')))
      expect((dlg.querySelector('textarea') as HTMLTextAreaElement).value).toBe('שם הליד')
      setEnv.results.createTemplate = { ok: false, error: 'אין הרשאה ליצור הודעות WhatsApp מוכנות.' }
      await click(inDialog(en ? 'Submit for review' : 'إرسال للمراجعة'))
      await flush()
      await click(btn(en ? 'Archive' : 'أرشفة'))
      if (en) has(scan(locale, 'archive'), 'Move "תזכורת פגישה" to the archive?')
      setEnv.results.archiveTemplate = { ok: false, error: 'Graph said no' }
      await click(inDialog(en ? 'OK' : 'موافق'))
      await flush()
      await click(btn(en ? 'Edit and try again' : 'التعديل والمحاولة مرة أخرى'))
      scan(locale, 'retry')
      if (en) expect(toasts()).toEqual(['No permission to create WhatsApp ready messages.', 'Graph said no'])
      else expect(toasts()[0]).toBe('لا توجد صلاحية لإنشاء رسائل WhatsApp جاهزة.')
    })

    test(`Messenger, saved replies, Calendar, Drive and AI (${locale})`, async () => {
      const en = locale === 'en'
      vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: !String(url).includes('disconnect'), json: async () => ({ connected: true, email: 'dana@gmail.test' }) })))
      await mount(locale)
      await flush()
      for (const reason of ['rate_limited', 'permission_missing']) {
        setEnv.results.updateMessengerProfile = { reason }
        await click(section('messenger').querySelector('button'))
        await flush()
        expect(hebrewIn(section('messenger').querySelector('[role="alert"]')!.textContent)).toBe(false)
      }
      const replies = section('messenger-replies')
      await click(replies.querySelector(`[aria-label="${en ? 'Edit' : 'تعديل'} שעות פעילות"]`))
      expect(leaks(replies)).toEqual([])
      if (en) has(textOf(replies), 'Name (shown only to you)', 'Quick replies (optional)', 'Link buttons (optional)', 'Attachment by address (optional)', 'Save saved reply')
      for (const detail of ['כתובת הקישור בכפתור חייבת להתחיל ב-https', 'אפשר עד 3 כפתורים בהודעה']) {
        setEnv.results.updateSavedReply = { reason: 'invalid', detail }
        await click(replies.querySelector('button.inline-flex, button') && [...replies.querySelectorAll('button')].find((b) => b.textContent === (en ? 'Save saved reply' : 'حفظ الرد المحفوظ')))
        await flush()
      }
      // A sentence with a number in it is shown as returned.
      expect(replies.querySelector('[role="alert"]')!.textContent).toBe('אפשר עד 3 כפתורים בהודעה')
      const confirmSpy = vi.fn(() => false)
      vi.stubGlobal('confirm', confirmSpy)
      await click(replies.querySelector(`[aria-label="${en ? 'Cancel' : 'إلغاء'}"]`) ?? [...replies.querySelectorAll('button')].find((b) => b.textContent === (en ? 'Cancel' : 'إلغاء')))
      await click(replies.querySelector(`[aria-label="${en ? 'Delete' : 'حذف'} שעות פעילות"]`))
      if (en) expect(confirmSpy.mock.calls[0]).toEqual(['Delete "שעות פעילות"?'])
      const disconnects = [...document.querySelectorAll('button')].filter((b) => b.textContent === (en ? 'Disconnect account' : 'فصل الحساب'))
      await click(disconnects[0])
      if (en) has(scan(locale, 'calendar'), "Existing meetings will stay in the CRM but won't be synced anymore.")
      await click(inDialog(en ? 'Disconnect account' : 'فصل الحساب'))
      await flush()
      await click(disconnects[1])
      if (en) has(scan(locale, 'drive'), "Existing files will stay in the CRM, but Google Drive won't be available until you reconnect.")
      await click(inDialog(en ? 'Disconnect account' : 'فصل الحساب'))
      await flush()
      await click(btn(en ? 'Disconnect Claude' : 'فصل Claude'))
      if (en) has(scan(locale, 'ai'), 'Claude will no longer be able to read your leads and conversations.')
      await click(inDialog(en ? 'Disconnect Claude' : 'فصل Claude'))
      await flush()
      await click(btn(en ? 'How to connect' : 'تعليمات الربط'))
      const howTo = document.getElementById('ai-connections-howto')!
      expect(leaks(howTo)).toEqual([])
      if (en) has(textOf(howTo), 'How do I connect?', 'Open Claude or ChatGPT', 'Enter:', 'Copy')
      expect(hebrewIn(toasts()), JSON.stringify(toasts())).toBe(false)
      if (en) expect(toasts()).toEqual(["Couldn't disconnect. Please try again.", "Couldn't disconnect. Please try again.", 'Claude disconnected'])
    })
  }
})
