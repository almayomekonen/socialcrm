// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { NOW, automationsEnv, resetAutomationsEnv } from './automationsEnv'
import { automationsPage, automationsShell, websiteSection } from './automationsHarness'

/**
 * HEBREW BASELINE — the automation-template gallery and the website connectors
 * (Phase E5b): card menu + removal (confirm, failure), the install dialog
 * (variables, update offer, refusals, success), the quote composer inside it
 * (existing / new price list, validation, rows, save), the connection card
 * (details dialog with the real set-up guide, new secret, source rename,
 * disconnect, connect dialog: refusal, issued credentials, copy), plus a JSON
 * snapshot of every label producer the screens read. Recorded BEFORE Phase E5b
 * on unmodified product code, with each action's arguments.
 */

vi.mock('next/navigation', async () => (await import('./automationsMocks')).navigationModule('/settings/automation-templates'))
vi.mock('@/lib/toast', async () => (await import('./automationsMocks')).toastModule())
vi.mock('@/db/auth', async () => (await import('./automationsMocks')).authModule())
vi.mock('@/lib/requireUser', async () => (await import('./automationsMocks')).requireUserModule())
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: null, agencyLocale: null }) }))
vi.mock('@/lib/access/productAccess', async () => (await import('./automationsMocks')).productAccessModule())
vi.mock('@/lib/automations/flags', async () => (await import('./automationsMocks')).flagsModule())
vi.mock('@/config/db', async () => (await import('./automationsMocks')).configDbModule())
vi.mock('@/db/automations/templateInstalls', async () => (await import('./automationsMocks')).templateInstallsDbModule())
vi.mock('@/db/automations/connectionUsage', async () => (await import('./automationsMocks')).connectionUsageDbModule())
vi.mock('@/db/automations/connectionDelivery', async () => (await import('./automationsMocks')).connectionDeliveryDbModule())
vi.mock('@/db/automations/sourceLabels', async () => (await import('./automationsMocks')).sourceLabelsDbModule())
vi.mock('@/lib/automations/connectors/registry', async () => (await import('./automationsMocks')).connectorsRegistryModule())
vi.mock('@/actions/automations/connections', async () => (await import('./automationsMocks')).connectionsActionsModule())
vi.mock('@/actions/automations/firstPartyOptions', async () => (await import('./automationsMocks')).firstPartyOptionsModule())
vi.mock('@/actions/automations/templates', async () => (await import('./automationsMocks')).templatesActionsModule())
vi.mock('@/actions/quotes/templates', async () => (await import('./automationsMocks')).quoteActionsModule())

const norm = (html: string) => html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
const set = (overrides: Partial<typeof automationsEnv>) => Object.assign(automationsEnv, overrides)
const calls = () => JSON.parse(JSON.stringify(automationsEnv.calls))
const dialog = () => norm([...document.querySelectorAll('[role="dialog"]')].map((d) => d.outerHTML).join('\n'))
const click = async (el: Element | null | undefined) => act(async () => void fireEvent.click(el!))
const wait = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))
const type = (el: Element | null | undefined, value: string) => act(async () => void fireEvent.change(el!, { target: { value } }))
const btn = (text: string, root: ParentNode = document) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
const dlg = () => [...document.querySelectorAll('[role="dialog"]')].pop()!
const card = (title: string) => [...document.querySelectorAll('h3')].find((h) => h.textContent?.startsWith(title))!.closest('.group\\/card')!

beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {} })
  Object.assign(navigator, { clipboard: { writeText: async (v: string) => automationsEnv.calls.push(['clipboard', v]) } })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  let seq = 0
  vi.spyOn(Math, 'random').mockImplementation(() => (seq = (seq % 997) + 1) / 1000)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetAutomationsEnv()
})

describe('Hebrew baseline — template gallery and website connectors', () => {
  test('gallery: remove (confirm, failure), install (update offered, refusal), quote composer (existing, new, validation, save)', async () => {
    const out: Record<string, unknown> = {}
    set({ installs: [{ templateKey: 'welcome_sequence', templateVersion: 1, automationId: 21 }, { templateKey: 'internal_task_on_new_lead', templateVersion: 0, automationId: 22 }] })
    render(await automationsShell(null, await automationsPage('templates')))
    await click(card('רצף קבלת פנים').querySelector('button[aria-haspopup="menu"]'))
    out.menu = norm(document.querySelector('[role="menu"]')!.outerHTML)
    await click(document.querySelector('[role="menuitem"]'))
    out.removeConfirm = dialog()
    set({ results: { uninstallTemplate: { ok: false, reason: 'forbidden' } } })
    await click(btn('הסרה', dlg()))
    await wait()
    set({ results: {} })
    await click(card('רצף קבלת פנים').querySelector('button[aria-haspopup="menu"]'))
    await click(document.querySelector('[role="menuitem"]'))
    await click(btn('הסרה', dlg()))
    await wait()
    await click(btn('התקנה נוספת', card('משימה לנציג')))
    out.installUpdate = dialog()
    set({ results: { installTemplate: { ok: false, reason: 'template_invalid' } } })
    await click(btn('התקנה', dlg()))
    await wait()
    out.installRefused = norm(dlg().querySelector('[role="alert"]')?.outerHTML ?? '')
    set({ results: { installTemplate: { ok: true, created: 3 } } })
    await click(btn('התקנה', dlg()))
    await wait()
    await click(btn('התקנה', card('הצעת מחיר אוטומטית')))
    await wait(50)
    out.composerExisting = dialog()
    await type(dlg().querySelector('select'), '__new__')
    out.composerNew = dialog()
    await click(btn('התקנה', dlg()))
    await wait()
    out.composerInvalid = norm(dlg().querySelector('[role="alert"]')?.outerHTML ?? '')
    const inputs = () => [...dlg().querySelectorAll('input')]
    await type(inputs()[0], 'חבילת בסיס')
    await type(inputs()[1], 'ייעוץ ראשוני')
    await type(inputs()[3], '450')
    await click(btn('הוספת שורה', dlg()))
    await click(dlg().querySelectorAll('button[aria-label^="סמן שורה"]')[1])
    out.composerRows = dialog()
    await click(dlg().querySelectorAll('button[aria-label^="מחק שורה"]')[1])
    await click(btn('התקנה', dlg()))
    await wait()
    out.calls = calls()
    expect(out).toMatchSnapshot()
  })

  test('website connectors: details (set-up guide, new secret, rename), disconnect, connect (refusal, issued, copy)', async () => {
    const out: Record<string, unknown> = {}
    const { contactForm7Provider } = await import('@/lib/automations/connectors/contactForm7')
    const guide = contactForm7Provider.setup!({ webhookUrl: 'https://app.example.test/api/automations/hook/abc', secret: null })
    set({ results: { connectionSetup: { ok: true, guide, webhookUrl: 'https://app.example.test/api/automations/hook/abc' } } })
    const { container } = render(await automationsShell(null, await websiteSection()))
    await click(container.querySelectorAll('li')[1].querySelector('button'))
    await wait()
    out.details = dialog()
    await click(btn('יצירת קוד סודי חדש', dlg()))
    await wait()
    out.secret = norm(dlg().querySelector('section')!.outerHTML)
    await click(btn('שינוי שם', dlg()))
    await type(dlg().querySelector('li input'), 'טופס ראשי')
    await click(btn('שמור שם', dlg()))
    await wait()
    await click(btn('העתקת הקוד', dlg()))
    await click(dlg().querySelector('button[aria-label]'))
    await click(btn('ניתוק', container.querySelectorAll('li')[1] as HTMLElement))
    out.disconnect = dialog()
    set({ results: { revokeConnection: { ok: false } } })
    await click(btn('ניתוק', dlg()))
    await wait()
    cleanup()
    set({ results: {}, usage: { 'contact_form_7:4': { automations: 2, lastActivityAt: null } } })
    const used = render(await automationsShell(null, await websiteSection()))
    out.used = norm(used.container.innerHTML)
    await click(btn('ניתוק', used.container.querySelectorAll('li')[1] as HTMLElement))
    out.disconnectUsed = dialog()
    await click(btn('ניתוק', dlg()))
    await wait()
    await click(btn('יצירת חיבור חדש', used.container.querySelectorAll('li')[1] as HTMLElement))
    out.connect = dialog()
    await type(dlg().querySelector('input'), 'not a url')
    set({ results: { provisionApiKeyConnection: { ok: false, reason: 'site_url_invalid' } } })
    await click(btn('יצירת חיבור', dlg()))
    await wait()
    out.connectRefused = norm(dlg().querySelector('[role="alert"]')?.outerHTML ?? '')
    set({ results: {} })
    await type(dlg().querySelector('input'), 'https://dana.example.test')
    await click(btn('יצירת חיבור', dlg()))
    await wait()
    out.issued = dialog()
    await click(btn('העתקה', dlg()))
    out.calls = calls()
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — automations label producers', () => {
  test('catalog, copy maps, sentence, timing, errors, connections copy', async () => {
    const { catalog } = await import('@/lib/automations/catalog/registry')
    const copy = await import('@/lib/automations/copy')
    const { IDENTITY_PROBLEM_COPY } = await import('@/lib/automations/identity')
    const { OPERATOR_LABELS, describeCondition } = await import('@/lib/automations/conditions')
    const { automationSentence, timingPhrase } = await import('@/lib/automations/sentence')
    const { timeSaved } = await import('@/lib/automations/dashboardDemo')
    const { AUTOMATION_EMAIL_VARIABLES } = await import('@/lib/automations/variables')
    const sheet = await import('@/components/settings/automations/sheetOptions')
    const tpl = await import('@/components/settings/templates/copy')
    const conn = await import('@/components/settings/connections/copy')
    const { listTemplates } = await import('@/lib/automations/templates/registry')
    const timings = [
      { kind: 'preset', preset: 'immediate' }, { kind: 'preset', preset: 'one_hour' }, { kind: 'preset', preset: 'one_day' },
      { kind: 'custom', value: 1, unit: 'hours' }, { kind: 'custom', value: 3, unit: 'days' }, { kind: 'custom', value: 5, unit: 'hours' }, { kind: 'custom', value: 1, unit: 'days' },
      { kind: 'before_anchor', anchorField: 'startsAt', value: 1, unit: 'hours' }, { kind: 'before_anchor', anchorField: 'startsAt', value: 2, unit: 'days' },
    ] as never[]
    const event = catalog.events[1]
    const reasons = ['name_required', 'subject_required', 'body_required', 'title_required', 'title_invalid', 'parameter_required', 'parameter_invalid', 'trigger_invalid', 'action_invalid', 'condition_field_unknown', 'condition_operator_invalid', 'condition_value_required', 'condition_value_invalid', 'timing_invalid', 'unknown_variable', 'forbidden', 'not_available', 'not_found', 'no_recipient', 'content_required', 'no_sending_domain', 'no_reply_to', 'send_failed', 'cta_incomplete', 'cta_label_invalid', 'cta_url_invalid', 'preview_failed', 'template_required', 'template_not_found', 'template_not_approved', 'template_unmapped', 'template_not_chosen', 'template_missing', 'other']
    const ago = [null, NOW - 20_000, NOW - 5 * 60_000, NOW - 3 * 3_600_000, NOW - 30 * 3_600_000, NOW - 4 * 86_400_000, NOW + 60_000]
    expect({
      catalog: JSON.parse(JSON.stringify(catalog)),
      skip: copy.SKIP_REASON_COPY,
      failure: copy.FAILURE_COPY,
      accuracy: copy.TIMING_ACCURACY_COPY,
      identity: IDENTITY_PROBLEM_COPY,
      operators: OPERATOR_LABELS,
      timings: timings.map((t) => [timingPhrase(t), sheet.timingKey(t), sheet.timingOptionsFor(t).map((o) => o.lbl)]),
      condition: [describeCondition(event, { field: 'newStatus', operator: 'is', value: 'closed' }), describeCondition(event, { field: 'email', operator: 'exists', value: '' })],
      sentence: automationSentence({ event, conditions: [{ field: 'newStatus', operator: 'is', value: 'lost' }, { field: 'email', operator: 'exists', value: '' }], actionTitle: 'שליחת אימייל', subject: 'נושא', timing: timings[4] }),
      noEvent: automationSentence({ event: null, conditions: [], actionTitle: 'פעולה', subject: '', timing: timings[0] }),
      saved: [0, 5, 20, 40].map(timeSaved),
      variables: AUTOMATION_EMAIL_VARIABLES,
      sheetErrors: Object.fromEntries(reasons.map((r) => [r, sheet.errorMessage(r)])),
      templateErrors: Object.fromEntries([...Object.keys(tpl.ERRORS), 'subscription_required', 'other'].map((r) => [r, tpl.errorMessage(r)])),
      categories: tpl.CATEGORY,
      templates: JSON.parse(JSON.stringify(listTemplates())),
      connections: { health: conn.HEALTH, subscription: conn.SUBSCRIPTION, strategy: conn.STRATEGY, delivery: conn.DELIVERY, errors: conn.ERRORS, other: conn.errorMessage('other') },
      timeAgo: ago.map((v) => conn.timeAgo(v === null ? null : new Date(v).toISOString())),
    }).toMatchSnapshot()
  })
})
