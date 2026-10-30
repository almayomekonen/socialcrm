// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CARD, NOW, NO_CARD, SUBSCRIPTION, TRIAL_ROW, resetSetEnv, setEnv } from './settingsEnv'
import { EXPIRED, setShell, settingsPage, type SettingsPage } from './settingsHarness'

/**
 * HEBREW BASELINE — interactions on the account and payment pages (Phase E4):
 * every dialog, confirmation, validation message, inline error and toast, and
 * the arguments each action receives. Recorded BEFORE Phase E4 on unmodified
 * product code. The real pages, I/O mocked, no i18n provider.
 */

vi.mock('next/navigation', async () => (await import('./settingsMocks')).navigationModule('/settings/self_edit'))
vi.mock('next/script', async () => (await import('./settingsMocks')).nextScriptModule())
vi.mock('@/lib/toast', async () => (await import('./settingsMocks')).toastModule())
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
vi.mock('@/components/settings/UploadClientData', () => ({ default: () => <div data-stub='UploadClientData' /> }))

const norm = (html: string) => html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»')
const set = (overrides: Partial<typeof setEnv>) => Object.assign(setEnv, overrides)
const calls = () => JSON.parse(JSON.stringify(setEnv.calls))
const dialogs = () => norm([...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].map((d) => d.outerHTML).join('\n'))
const click = async (el: Element | null | undefined) => act(async () => void fireEvent.click(el!))
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const byText = (text: string) => screen.getAllByText(text).pop()!.closest('button, a, label') ?? screen.getAllByText(text).pop()!
async function mount(name: SettingsPage, ent?: typeof EXPIRED) {
  return render(await setShell(null, await settingsPage(name), ent))
}

const savedEnv = { ...process.env }
beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {} })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => {
  vi.useRealTimers()
  process.env = { ...savedEnv }
})
afterEach(() => {
  cleanup()
  resetSetEnv()
})

describe('Hebrew baseline — account page interactions', () => {
  test('self_edit: permission add / remove, rep chip edit / delete / refused delete / duplicate, transfer leads, saved filters', async () => {
    const out: Record<string, unknown> = {}
    const { container } = await mount('selfEdit')
    await click(container.querySelector('button[title="הסר נציג מורשה"]'))
    out.removePermDialog = dialogs()
    await click(screen.getByText('אישור').closest('button'))
    await flush()
    await click(container.querySelector('button[title="מחיקה"]'))
    out.deleteRepDialog = dialogs()
    set({ results: { deleteExtUser: 'throw' } })
    await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'אישור'))
    await flush()
    out.deleteRefused = dialogs()
    await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'אישור'))
    set({ results: { upsertExtUser: 'throw:duplicate key value violates unique constraint' } })
    await click(container.querySelector('button[title="עריכה"]'))
    out.editingForm = norm(container.querySelector('form.max-w-72')!.outerHTML)
    await act(async () => void fireEvent.submit(container.querySelector('form.max-w-72')!))
    await flush()
    out.duplicateOrFailure = dialogs()
    set({ results: {} })
    await click(container.querySelector('button[title="העברת לידים"]'))
    out.transferPopover = norm(document.getElementById('transferSales')!.outerHTML)
    await act(async () => void fireEvent.submit(document.querySelector('#transferSales form')!))
    out.transferConfirm = dialogs()
    await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'אישור'))
    await flush()
    await click(container.querySelector('[aria-label="מחיקת סינון שמור"]'))
    await click(screen.getAllByText('שמירה').pop()!.closest('button'))
    await flush()
    out.calls = calls()
    expect(out).toMatchSnapshot()
  })

  test('user details / contact / logout minutes / system settings submit; cold-lead toggle disables its months', async () => {
    const out: Record<string, unknown> = {}
    let view = await mount('userDetails')
    for (const form of view.container.querySelectorAll('form')) await act(async () => void fireEvent.submit(form))
    await flush()
    cleanup()
    view = await mount('security')
    await act(async () => void fireEvent.submit(view.container.querySelector('form')!))
    await flush()
    cleanup()
    view = await mount('system')
    await click(view.container.querySelector('input[name="isRiskUpdated"]'))
    out.coldOff = norm(view.container.querySelector('input[name="monthsLidimSheloHufku"]')!.outerHTML)
    await act(async () => void fireEvent.submit(view.container.querySelector('form')!))
    await flush()
    out.calls = calls()
    expect(out).toMatchSnapshot()
  })

  test('Facebook login: SDK missing → error toast; linked failure toast', async () => {
    process.env.AUTH_FACEBOOK_APP_ID = 'fb-app'
    set({ facebookUserAuth: true })
    const view = await mount('security')
    await click(screen.getByText('חיבור Facebook').closest('button'))
    expect({ toasts: calls(), html: norm(view.container.innerHTML) }).toMatchSnapshot()
    delete process.env.AUTH_FACEBOOK_APP_ID
  })

  test('WhatsApp reminders: consent gate, code issued, start refused, turn off, cancel a pending code', async () => {
    const out: Record<string, unknown> = {}
    let view = await mount('reminders')
    out.offButton = norm(view.container.querySelector('button')!.outerHTML)
    await click(view.container.querySelector('input[type="checkbox"]'))
    await click(screen.getByText('הפעלת תזכורות בוואטסאפ').closest('button'))
    await flush()
    out.issued = norm(view.container.innerHTML)
    cleanup()
    set({ results: { startWhatsappReminderActivation: { fail: true, msg: 'התזכורות כבר פעילות' } } })
    view = await mount('reminders')
    await click(view.container.querySelector('input[type="checkbox"]'))
    await click(screen.getByText('הפעלת תזכורות בוואטסאפ').closest('button'))
    await flush()
    cleanup()
    set({ results: {}, reminderRow: { status: 'active', phoneE164: '+972501234572' } })
    view = await mount('reminders')
    await click(screen.getByText('כיבוי תזכורות').closest('button'))
    await flush()
    cleanup()
    set({ reminderRow: { status: 'pending', activationExpiresAt: new Date(NOW + 600_000).toISOString(), phoneE164: null } })
    view = await mount('reminders')
    await click(screen.getByText('ביטול').closest('button'))
    await flush()
    out.calls = calls()
    expect(out).toMatchSnapshot()
  })

  test('business details: validation errors, save toasts and payload', async () => {
    const out: Record<string, unknown> = {}
    const view = await mount('agency')
    const name = view.container.querySelector('input[type="text"]') as HTMLInputElement
    fireEvent.change(name, { target: { value: '' } })
    const email = view.container.querySelector('input[type="email"]') as HTMLInputElement
    fireEvent.change(email, { target: { value: 'not-an-email' } })
    await act(async () => void fireEvent.submit(view.container.querySelector('form')!))
    out.invalid = norm(view.container.querySelector('form')!.outerHTML)
    fireEvent.change(name, { target: { value: 'דנה כהן ייעוץ' } })
    fireEvent.change(email, { target: { value: 'billing@example.test' } })
    await act(async () => void fireEvent.submit(view.container.querySelector('form')!))
    await flush()
    out.calls = calls()
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — payment interactions', () => {
  test('manage plan: renewing → confirm cancel → refused (both codes) → cancelled; cancelling → resume; expired; not manageable', async () => {
    const out: Record<string, unknown> = {}
    let view = await mount('payment')
    await click(screen.getByText('נהל מסלול').closest('button'))
    out.manage = dialogs()
    await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'בטל מנוי'))
    out.confirmCancel = dialogs()
    for (const error of ['no_subscription', 'boom']) {
      set({ results: { cancelRenewal: { error } } })
      await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'בטל מנוי'))
      await flush()
      out[`cancelError_${error}`] = dialogs()
    }
    set({ results: {} })
    await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'בטל מנוי'))
    await flush()
    out.afterCancel = dialogs()
    set({ results: { resumeRenewal: { error: 'no_subscription' } } })
    await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'חידוש מסלול'))
    await flush()
    out.resumeError = dialogs()
    cleanup()
    set({ results: {}, subscription: { ...SUBSCRIPTION, expiresAt: new Date(NOW - 86_400_000) }, hasAccess: false })
    view = await mount('payment', EXPIRED)
    await click(screen.getByText('נהל מסלול').closest('button'))
    out.expired = dialogs()
    cleanup()
    set({ subscription: { ...SUBSCRIPTION, manageable: false }, hasAccess: true })
    view = await mount('payment')
    await click(screen.getByText('נהל מסלול').closest('button'))
    out.notManageable = dialogs()
    void view
    out.calls = calls()
    expect(out).toMatchSnapshot()
  })

  test('card on file: replace (consent → continue, failure), cancel before the charge (dialog, every error), resume', async () => {
    const out: Record<string, unknown> = {}
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload, assign: vi.fn() })
    set({ cardView: CARD })
    let view = await mount('payment')
    await click(screen.getByText('החלפת כרטיס').closest('button'))
    out.replace = norm(view.container.querySelector('.mb-6.max-w-3xl.p-6')!.outerHTML)
    await click(view.container.querySelector('.mb-6.max-w-3xl.p-6 input[type="checkbox"]'))
    set({ results: { startCardSetup: { error: 'provider_unavailable' } } })
    await click(screen.getByText('המשך להחלפת הכרטיס').closest('button'))
    await flush()
    out.replaceError = norm(view.container.querySelector('[role="alert"]')!.outerHTML)
    await click(screen.getByText('חזרה').closest('button'))
    await click(screen.getByText('ביטול לפני החיוב').closest('button'))
    out.cancelDialog = dialogs()
    for (const error of ['reactivation_required', 'no_subscription', 'boom']) {
      set({ results: { cancelRenewal: { error } } })
      await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'ביטול המנוי'))
      await flush()
      out[`cancelError_${error}`] = norm(view.container.querySelector('[role="alert"]')?.outerHTML ?? '')
    }
    set({ results: { cancelRenewal: { ok: true, chargeInProgress: true } } })
    await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'ביטול המנוי'))
    await flush()
    out.chargeInProgressNotice = norm(view.container.querySelector('[role="status"]')?.outerHTML ?? '')
    cleanup()
    set({ results: {}, cardView: { ...CARD, cancelAtPeriodEnd: true } })
    view = await mount('payment')
    await click(screen.getByText('חידוש המנוי').closest('button'))
    await flush()
    vi.unstubAllGlobals()
    out.calls = calls()
    expect(out).toMatchSnapshot()
  })

  test('card setup form: every refusal, the holder field error, network failure, redirect payload', async () => {
    const out: Record<string, unknown> = {}
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() })
    set({ plan: 'free', subscription: null, usage: null as never, trialRow: TRIAL_ROW, cardView: NO_CARD, setupPurpose: 'trial_start' })
    const view = await mount('payment')
    const submit = () => click(screen.getByText('הוספת כרטיס והפעלת הניסיון').closest('button'))
    for (const error of ['unauthorized', 'not_eligible', 'provider_unavailable', 'terms_required', 'card_storage_consent_required', 'something_else']) {
      set({ results: { startCardSetup: { error } } })
      await submit()
      await flush()
      out[`error_${error}`] = norm(view.container.querySelector('#card-setup [role="alert"]')?.outerHTML ?? '')
    }
    set({ results: { startCardSetup: { error: 'invalid_holder', field: 'phone', message: 'מספר הטלפון אינו תקין' } } })
    await submit()
    await flush()
    out.holderError = norm(view.container.querySelector('#card-setup')!.outerHTML)
    set({ results: { startCardSetup: 'throw' } })
    await submit()
    await flush()
    out.network = norm(view.container.querySelector('#card-setup [role="alert"]')?.outerHTML ?? '')
    set({ results: {} })
    for (const box of view.container.querySelectorAll('#card-setup input[type="checkbox"]')) await click(box)
    await submit()
    await flush()
    vi.unstubAllGlobals()
    out.calls = calls()
    expect(out).toMatchSnapshot()
  })
})
