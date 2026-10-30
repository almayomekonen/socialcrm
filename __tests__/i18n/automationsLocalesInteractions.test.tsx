// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import { findHebrewLeaks, type Allowance } from './leakScan'
import { AUTOMATIONS_CUSTOMER_DATA, NOW, automationsEnv, resetAutomationsEnv } from './automationsEnv'

/**
 * The automations screens' interactions in he / en / ar (Phase E5b): every flow
 * — row menu, toggle + undo, duplicate, delete, run log, the sheet (new: chips,
 * CTA, conditions, timing, refusals, test send; each action shape; edit), the
 * library's install dialog, the gallery (remove, install, quote composer), the
 * website connectors (details, new secret, rename, copy, disconnect, connect)
 * — submits IDENTICAL arguments in every language, and every checkpoint (dialogs
 * and menus included) shows no Hebrew outside data and verbatim content; no
 * toast is Hebrew outside Hebrew. Selectors are structural, never by Hebrew text.
 */

const H = vi.hoisted(() => ({ prefs: { userLocale: 'en' as string | null } }))
vi.mock('@/lib/toast', async () => (await import('./automationsMocks')).toastModule())
vi.mock('@/lib/analytics/track', () => ({ track: () => {} }))
vi.mock('next/navigation', async () => (await import('./automationsMocks')).navigationModule())
vi.mock('@/db/auth', async () => (await import('./automationsMocks')).authModule())
vi.mock('@/lib/requireUser', async () => (await import('./automationsMocks')).requireUserModule())
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: H.prefs.userLocale, agencyLocale: null }) }))
vi.mock('@/lib/access/productAccess', async () => (await import('./automationsMocks')).productAccessModule())
vi.mock('@/lib/automations/flags', async () => (await import('./automationsMocks')).flagsModule())
vi.mock('@/config/db', async () => (await import('./automationsMocks')).configDbModule())
vi.mock('@/db/automations/definitions', async () => (await import('./automationsMocks')).definitionsDbModule())
vi.mock('@/db/automations/activity', async () => (await import('./automationsMocks')).activityDbModule())
vi.mock('@/db/automations/leadFacts', async () => (await import('./automationsMocks')).leadFactsDbModule())
vi.mock('@/db/automations/templateInstalls', async () => (await import('./automationsMocks')).templateInstallsDbModule())
vi.mock('@/db/automations/connectionUsage', async () => (await import('./automationsMocks')).connectionUsageDbModule())
vi.mock('@/db/automations/connectionDelivery', async () => (await import('./automationsMocks')).connectionDeliveryDbModule())
vi.mock('@/db/automations/sourceLabels', async () => (await import('./automationsMocks')).sourceLabelsDbModule())
vi.mock('@/lib/automations/connectors/registry', async () => (await import('./automationsMocks')).connectorsRegistryModule())
vi.mock('@/actions/automations/manage', async () => (await import('./automationsMocks')).manageActionsModule())
vi.mock('@/actions/automations/activity', async () => (await import('./automationsMocks')).activityActionsModule())
vi.mock('@/actions/automations/sendTest', async () => (await import('./automationsMocks')).sendTestModule())
vi.mock('@/actions/automations/connections', async () => (await import('./automationsMocks')).connectionsActionsModule())
vi.mock('@/actions/automations/firstPartyOptions', async () => (await import('./automationsMocks')).firstPartyOptionsModule())
vi.mock('@/actions/automations/previewMessage', async () => (await import('./automationsMocks')).previewMessageModule())
vi.mock('@/actions/automations/previewEmail', async () => (await import('./automationsMocks')).previewEmailModule())
vi.mock('@/actions/automations/templates', async () => (await import('./automationsMocks')).templatesActionsModule())
vi.mock('@/actions/quotes/templates', async () => (await import('./automationsMocks')).quoteActionsModule())
const { automationsPage, automationsShell, websiteSection } = await import('./automationsHarness')
const { VERBATIM } = await import('./automationsVerbatim')

/** Typed into the forms by the flows, or the stored bodies / a task title greeting the preview lead — data too. */
const DATA: Allowance[] = [...AUTOMATIONS_CUSTOMER_DATA, 'שלום {{שם הליד}},\nנחזור אליך היום.', 'שלום {{שם הליד}}, קיבלנו את הטופס.', 'להתקשר אל רועי', 'גוף', 'אוטומציה לבדיקה', 'שלום רועי', 'שלום רועי, נתראה מחר', 'חבילת בסיס', 'ייעוץ ראשוני', 'טופס ראשי'].map((text) => ({ text, reason: 'customer-data' as const }))
const HEBREW = /[֐-׿]/
const click = async (el: Element | null | undefined) => {
  if (!el) throw new Error('control not found')
  await act(async () => void fireEvent.click(el))
}
const wait = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))
const type = (el: Element | null | undefined, value: string) => act(async () => void fireEvent.change(el!, { target: { value } }))
const dlg = () => [...document.querySelectorAll('[role="dialog"]')].pop()!
const closeDialog = () => click(dlg().querySelector('button.absolute'))
const confirmBtn = () => [...dlg().querySelectorAll('button:not(.absolute)')].pop()
const set = (overrides: Partial<typeof automationsEnv>) => Object.assign(automationsEnv, overrides)
const rowOf = (name: string) => [...document.querySelectorAll('aside button')].find((b) => b.textContent?.includes(name))!.parentElement!
const sections = () => [...dlg().querySelectorAll('section')]
const selects = () => [...dlg().querySelectorAll('select')]
const footer = () => dlg().querySelector('.gap-5 > .gap-2:last-child')!.querySelectorAll('button')

let scans: string[] = []
const scan = (where: string) => {
  for (const leak of findHebrewLeaks(document.body, [...DATA, ...VERBATIM])) scans.push(`${where}: ${leak.where} «${leak.text}»`)
}

async function across(build: (locale: UiLocale) => Promise<ReactNode>, flow: (c: HTMLElement, scan: (w: string) => void) => Promise<void>) {
  const results: Record<string, { actions: unknown[]; toasts: string[]; scans: string[] }> = {}
  for (const locale of ['he', 'en', 'ar'] as const) {
    resetAutomationsEnv()
    H.prefs.userLocale = locale
    scans = []
    const { container } = render(await automationsShell(locale, await build(locale)))
    await wait()
    await flow(container, locale === 'he' ? () => {} : scan)
    const calls = JSON.parse(JSON.stringify(automationsEnv.calls)) as unknown[][]
    results[locale] = {
      actions: calls.filter((c) => c[0] !== 'toast' && c[0] !== 'proToast'),
      toasts: calls.filter((c) => c[0] === 'toast' || c[0] === 'proToast').map((c) => JSON.stringify(c.slice(1))),
      scans: [...scans],
    }
    cleanup()
  }
  for (const locale of ['en', 'ar'] as const) {
    expect(results[locale].actions, `${locale} submits what Hebrew submits`).toEqual(results.he.actions)
    expect(results[locale].scans, locale).toEqual([])
    for (const msg of results[locale].toasts) expect(HEBREW.test(msg), `${locale} toast ${msg}`).toBe(false)
  }
  expect(results.he.actions.length, 'the flow reached its actions').toBeGreaterThan(0)
  return results
}
const names = (r: Awaited<ReturnType<typeof across>>) => new Set(r.he.actions.map((a) => (a as unknown[])[0]))
const reached = (r: Awaited<ReturnType<typeof across>>, ...expected: string[]) => expect([...names(r)]).toEqual(expect.arrayContaining(expected))
const workspace = () => automationsPage('automations')

beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {}, scrollIntoView() {} })
  Object.assign(navigator, { clipboard: { writeText: async (v: string) => automationsEnv.calls.push(['clipboard', v]) } })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  let seq = 0
  vi.spyOn(Math, 'random').mockImplementation(() => (seq = (seq % 997) + 1) / 1000)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  Object.assign(process.env, { UI_LOCALE_ENABLED: '1', UI_LOCALE_AGENCY_ALLOWLIST: '103' })
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetAutomationsEnv()
})

describe('automations interactions in he / en / ar', () => {
  test('row menu, duplicate, toggle + undo, failure, delete, run log (rows, empty, failure)', async () => {
    const r = await across(workspace, async (c, s) => {
      await type(c.querySelector('input[type="search"]'), 'zzz')
      s('search, nothing matches')
      await type(c.querySelector('input[type="search"]'), '')
      await click(rowOf('מענה ראשון לליד חדש').querySelector('button[aria-haspopup="menu"]'))
      s('row menu')
      await click(document.querySelectorAll('[role="menuitem"]')[2])
      await wait()
      await click(rowOf('מענה ראשון לליד חדש').querySelector('button[aria-pressed]'))
      await wait()
      await act(async () => automationsEnv.undo?.())
      await wait()
      set({ results: { setAutomationStatus: { ok: false } } })
      await click(rowOf('משימה על ליד מעוניין').querySelector('button[aria-pressed]'))
      await wait()
      set({ results: {} })
      await click(rowOf('מעקב טופס מהאתר').querySelector('button[aria-haspopup="menu"]'))
      await click(document.querySelectorAll('[role="menuitem"]')[3])
      s('delete confirm')
      await click(confirmBtn())
      await wait()
      await click(rowOf('מענה ראשון לליד חדש').querySelector('button[aria-haspopup="menu"]'))
      await click(document.querySelectorAll('[role="menuitem"]')[1])
      await wait()
      s('run log')
      await closeDialog()
      set({ results: { listActivityForAutomationAction: { ok: true, rows: [] } } })
      await click(rowOf('מענה ראשון לליד חדש').querySelector('button[aria-haspopup="menu"]'))
      await click(document.querySelectorAll('[role="menuitem"]')[1])
      await wait()
      s('run log, empty')
      await closeDialog()
      set({ results: { listActivityForAutomationAction: { ok: false, reason: 'forbidden' } } })
      await click(rowOf('מענה ראשון לליד חדש').querySelector('button[aria-haspopup="menu"]'))
      await click(document.querySelectorAll('[role="menuitem"]')[1])
      await wait()
    })
    reached(r, 'duplicateAutomation', 'setAutomationStatus', 'listActivityForAutomationAction')
  })

  test('the sheet: a new email automation (chip, CTA, condition, timing, refusal, test), each action shape, save', async () => {
    const r = await across(workspace, async (c, s) => {
      await click(c.querySelector('input[type="search"]')!.closest('.flex-none')!.querySelector('button'))
      s('new sheet')
      await type(dlg().querySelector('input'), 'אוטומציה לבדיקה')
      await click(sections()[1].querySelector('button'))
      await type(selects()[1], 'newStatus')
      s('condition')
      const subject = sections()[2].querySelectorAll('input')[0]
      await act(async () => void fireEvent.focus(subject))
      await type(subject, 'שלום ')
      await click(sections()[2].querySelector('.flex-wrap button'))
      await type(sections()[2].querySelector('textarea'), 'גוף')
      await click([...sections()[2].querySelectorAll('button')].pop())
      await type(sections()[2].querySelectorAll('input')[1], 'לקביעת שיחה')
      await type(sections()[2].querySelectorAll('input')[2], 'http://x')
      await click(sections()[3].querySelectorAll('button')[2])
      await wait(600)
      s('email, CTA, preview')
      set({ results: { createAutomation: { ok: false, reason: 'cta_url_invalid' } } })
      await click(footer()[0])
      await wait()
      s('save refused')
      set({ results: { sendTestEmail: { ok: false, reason: 'no_recipient' } } })
      await click(footer()[1])
      await wait()
      s('test refused')
      set({ results: {} })
      await click(footer()[1])
      await wait()
      await type(selects()[0], 'lead.status_changed')
      await type(selects()[1], 'task.create')
      await wait()
      await click(sections()[2].querySelector('.flex-wrap button'))
      s('task')
      await type(selects()[0], 'appointment.booked')
      await type(selects()[1], 'whatsapp.send')
      await wait()
      await type(selects()[2], '5')
      await wait(500)
      await type(selects()[3], 'leadFirstName')
      await wait(500)
      s('message, mapping, preview')
      await type(selects()[1], 'quote.create')
      await wait()
      s('quote')
      await type(selects()[0], 'form.submitted')
      await wait()
      s('website form (locked)')
      await type(selects()[0], 'lead.created')
      await type(selects()[1], 'email.send')
      await wait()
      await click(footer()[0])
      await wait()
    })
    reached(r, 'createAutomation', 'sendTestEmail', 'previewAutomationEmail', 'listOptionsForCapabilityAction', 'listTemplateSlots', 'previewAutomationMessage', 'listFirstPartyOptionsAction')
    const created = r.he.actions.find((a) => (a as unknown[])[0] === 'createAutomation') as unknown[]
    // The chip inserted the stored Hebrew TOKEN, whatever the button said.
    expect(JSON.stringify(created)).toContain('{{שם הליד}}')
  })

  test('the sheet: editing each saved shape submits the saved values; the library install dialog', async () => {
    const r = await across(workspace, async (c, s) => {
      for (const name of ['מענה ראשון לליד חדש', 'משימה על ליד מעוניין', 'תזכורת פגישה בוואטסאפ', 'מעקב טופס מהאתר']) {
        await click([...c.querySelectorAll('aside button')].find((b) => b.textContent?.includes(name)))
        await wait(600)
        s(`edit ${name}`)
        if (name !== 'מעקב טופס מהאתר') {
          await click(footer()[0])
          await wait()
        } else await closeDialog()
      }
      const cells = [...c.querySelectorAll('section button')].filter((b) => b.querySelector('path[d="M15 6l-6 6 6 6"]'))
      await click(cells[cells.length - 2])
      await wait()
      s('install dialog (task)')
      await type(dlg().querySelector('input'), 'להתקשר עכשיו')
      set({ results: { installTemplate: { ok: false, reason: 'variable_required' } } })
      await click(footer()[0])
      await wait()
      s('install refused')
      set({ results: {} })
      await click(footer()[0])
      await wait()
      await click(cells[0])
    })
    reached(r, 'updateAutomation', 'installTemplate')
    expect(r.he.actions.filter((a) => (a as unknown[])[0] === 'updateAutomation').length).toBe(3)
  })
})

describe('the gallery and the website connectors in he / en / ar', () => {
  test('remove (confirm, failure), install with an update offered, the quote composer builds and installs', async () => {
    const r = await across(
      async () => {
        Object.assign(automationsEnv, { installs: [{ templateKey: 'welcome_sequence', templateVersion: 1, automationId: 21 }, { templateKey: 'internal_task_on_new_lead', templateVersion: 0, automationId: 22 }] })
        return automationsPage('templates')
      },
      async (c, s) => {
        const cards = () => [...c.querySelectorAll('.group\\/card')]
        await click(cards()[1].querySelector('button[aria-haspopup="menu"]'))
        s('card menu')
        await act(async () => void fireEvent.keyDown(document, { key: 'Escape' }))
        expect(document.activeElement).toBe(cards()[1].querySelector('button[aria-haspopup="menu"]'))
        await click(cards()[1].querySelector('button[aria-haspopup="menu"]'))
        await click(document.querySelector('[role="menuitem"]'))
        s('remove confirm')
        set({ results: { uninstallTemplate: { ok: false, reason: 'forbidden' } } })
        await click(confirmBtn())
        await wait()
        set({ results: {} })
        const install = (card: Element) => [...card.querySelectorAll('button')].pop()
        const task = cards().find((k) => k.querySelector('.bg-\\[\\#5e6ad2\\]'))!
        await click(install(task))
        s('install, update offered')
        await click(footer()[0])
        await wait()
        await click(install(cards()[cards().length - 1]))
        for (let i = 0; i < 100 && !dlg().querySelector('select'); i++) await wait(20)
        s('composer, existing')
        await type(dlg().querySelector('select'), '__new__')
        const inputs = () => [...dlg().querySelectorAll('input')]
        await type(inputs()[0], 'חבילת בסיס')
        await type(inputs()[1], 'ייעוץ ראשוני')
        await type(inputs()[3], '450')
        await click(dlg().querySelectorAll('button[aria-label]')[1])
        s('composer, new')
        await click(footer()[0])
        await wait()
      },
    )
    reached(r, 'uninstallTemplate', 'installTemplate', 'getQuoteComposerDataAction', 'saveQuoteTemplateAction')
  })

  test('details (guide, new secret, rename, copy), disconnect, connect (refusal, issued, copy) — the code copied is identical', async () => {
    const { contactForm7Provider } = await import('@/lib/automations/connectors/contactForm7')
    const guide = contactForm7Provider.setup!({ webhookUrl: 'https://app.example.test/api/automations/hook/abc', secret: null })
    const r = await across(
      async (locale) => {
        Object.assign(automationsEnv, { results: { connectionSetup: { ok: true, guide, webhookUrl: 'https://app.example.test/api/automations/hook/abc' } } })
        return websiteSection(locale)
      },
      async (c, s) => {
        const ok = c.querySelectorAll('li')[1]
        await click(ok.querySelector('button'))
        await wait()
        s('details, guide')
        await click([...dlg().querySelectorAll('section')[0].querySelectorAll('button')].pop())
        await wait()
        s('new secret')
        const rename = [...dlg().querySelectorAll('li button')].pop()
        await click(rename)
        await type(dlg().querySelector('li input'), 'טופס ראשי')
        s('rename source')
        await click(dlg().querySelector('li input')!.closest('li')!.querySelector('button'))
        await wait()
        for (const b of dlg().querySelectorAll('section button')) if (b.querySelector('[style*="copy.svg"]')) await click(b)
        await closeDialog()
        await click([...ok.querySelectorAll('button')].pop())
        s('disconnect confirm')
        await click(confirmBtn())
        await wait()
        await click([...ok.querySelectorAll('button')][1])
        s('connect')
        set({ results: { provisionApiKeyConnection: { ok: false, reason: 'site_url_invalid' } } })
        await type(dlg().querySelector('input'), 'x')
        await click([...dlg().querySelectorAll('button:not(.absolute)')].pop())
        await wait()
        s('connect refused')
        set({ results: {} })
        await click([...dlg().querySelectorAll('button:not(.absolute)')].pop())
        await wait()
        s('issued')
        for (const b of dlg().querySelectorAll('button:not(.absolute)')) if (b.querySelector('[style*="copy.svg"]')) await click(b)
      },
    )
    reached(r, 'connectionSetup', 'regenerateSecret', 'renameSource', 'revokeConnection', 'provisionApiKeyConnection')
    expect(r.he.actions.filter((a) => (a as unknown[])[0] === 'clipboard').length).toBeGreaterThan(2)
  })
})
