// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { NOW, automationsEnv, resetAutomationsEnv } from './automationsEnv'

/**
 * Behaviour of the localized automations screens (Phase E5b): Hebrew producers
 * are the catalog's own objects; stored values (event keys, option values,
 * variable tokens, template keys) are the same in every language; refusals are
 * shown translated; the row menu closes on Escape; icon-only controls carry
 * translated names; and no screen of this package can submit a ready-message
 * template to Meta (nothing here imports a submission path).
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
const { automationsPage, automationsShell } = await import('./automationsHarness')

const click = async (el: Element | null | undefined) => act(async () => void fireEvent.click(el!))
const wait = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))
const type = (el: Element | null | undefined, value: string) => act(async () => void fireEvent.change(el!, { target: { value } }))
const dlg = () => [...document.querySelectorAll('[role="dialog"]')].pop()!
const mount = async (locale: 'he' | 'en' | 'ar') => {
  H.prefs.userLocale = locale
  return render(await automationsShell(locale, await automationsPage('automations')))
}
const openNew = (c: HTMLElement) => click(c.querySelector('input[type="search"]')!.closest('.flex-none')!.querySelector('button'))
const values = (root: ParentNode) => [...root.querySelectorAll('select')].map((s) => [...s.querySelectorAll('option')].map((o) => o.value))

beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {}, scrollIntoView() {} })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  Object.assign(process.env, { UI_LOCALE_ENABLED: '1', UI_LOCALE_AGENCY_ALLOWLIST: '103' })
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetAutomationsEnv()
})

describe('Hebrew producers are the catalog itself', () => {
  test('identity in Hebrew: the same objects, the same constants', async () => {
    const { catalog } = await import('@/lib/automations/catalog/registry')
    const i18n = await import('@/lib/automations/catalogI18n')
    const { listTemplates } = await import('@/lib/automations/templates/registry')
    const { localizeTemplate } = await import('@/lib/automations/templateI18n')
    for (const e of catalog.events) expect(i18n.localizeEvent(e, 'he')).toBe(e)
    for (const a of catalog.actions) expect(i18n.localizeAction(a, 'he')).toBe(a)
    for (const s of catalog.subjects) expect(i18n.localizeSubject(s, 'he')).toBe(s)
    for (const t of listTemplates()) expect(localizeTemplate(t, 'he')).toBe(t)
    // Other languages copy: the codes, values and option VALUES never change.
    for (const e of catalog.events) {
      const en = i18n.localizeEvent(e, 'en')!
      expect(en.key).toBe(e.key)
      expect(en.fields.map((f) => [f.key, f.type, f.options?.map((o) => o.value)])).toEqual(e.fields.map((f) => [f.key, f.type, f.options?.map((o) => o.value)]))
      expect(en.requirements.map((r) => [r.key, r.cta?.href])).toEqual(e.requirements.map((r) => [r.key, r.cta?.href]))
      expect(en.title).not.toBe(e.title)
    }
    for (const t of listTemplates()) {
      const en = localizeTemplate(t, 'en')
      expect([en.key, en.version, en.automations]).toEqual([t.key, t.version, t.automations])
      expect(en.variables.map((v) => [v.key, v.default, v.options?.map((o) => o.value)])).toEqual(t.variables.map((v) => [v.key, v.default, v.options?.map((o) => o.value)]))
    }
  })
})

describe('the sheet in en / ar keeps every stored value', () => {
  test('the pickers offer the same option VALUES in he / en / ar; chips insert the Hebrew token', async () => {
    const seen: Record<string, unknown> = {}
    for (const locale of ['he', 'en', 'ar'] as const) {
      const { container } = await mount(locale)
      await openNew(container)
      await click(dlg().querySelectorAll('section')[1].querySelector('button'))
      await type(dlg().querySelectorAll('select')[1], 'status')
      seen[locale] = values(dlg())
      const subject = dlg().querySelectorAll('section')[2].querySelector('input')!
      await act(async () => void fireEvent.focus(subject))
      await click(dlg().querySelectorAll('section')[2].querySelector('.flex-wrap button'))
      expect((subject as HTMLInputElement).value, locale).toBe('{{שם הליד}}')
      cleanup()
    }
    expect(seen.en).toEqual(seen.he)
    expect(seen.ar).toEqual(seen.he)
  })

  test('a refusal is shown in the interface language; the toggle and the row menu have translated names; Escape closes the menu', async () => {
    const { container } = await mount('en')
    const toggle = container.querySelector('aside button[aria-pressed="true"]')!
    expect(toggle.getAttribute('aria-label')).toBe('Pause · מענה ראשון לליד חדש')
    const menuButton = container.querySelector('aside button[aria-haspopup="menu"]')!
    expect(menuButton.getAttribute('aria-label')).toBe('Actions · מענה ראשון לליד חדש')
    await click(menuButton)
    expect(document.querySelector('[role="menu"]')!.textContent).toBe('EditActivity logDuplicateDelete')
    await act(async () => void fireEvent.keyDown(document, { key: 'Escape' }))
    expect(document.querySelector('[role="menu"]')).toBeNull()
    await openNew(container)
    Object.assign(automationsEnv, { results: { createAutomation: { ok: false, reason: 'cta_url_invalid' } } })
    const footer = dlg().querySelector('.gap-5 > .gap-2:last-child')!
    await click(footer.querySelector('button'))
    await wait()
    expect(footer.querySelector('[role="alert"]')!.textContent).toBe('The button link must start with https://')
    expect(dlg().getAttribute('aria-label')).toBe('New automation')
  })

  test('the expired toggle prompts for Pro in the interface language and calls nothing', async () => {
    Object.assign(automationsEnv, { hasAccess: false })
    H.prefs.userLocale = 'ar'
    const { EXPIRED } = await import('./automationsHarness')
    const { container } = render(await automationsShell('ar', await automationsPage('automations'), EXPIRED))
    await click(container.querySelector('aside button[aria-pressed]'))
    const calls = JSON.parse(JSON.stringify(automationsEnv.calls)) as unknown[][]
    expect(calls.filter((c) => c[0] !== 'proToast')).toEqual([])
    expect(calls[0]).toEqual(['proToast', { title: 'تشغيل الأتمتة متاح مع Pro', body: 'سيعيد تجديد الاشتراك تشغيل الأتمتة.', source: 'automations_action' }])
  })
})

describe('no screen of this package can submit a template to Meta', () => {
  test('none of its modules import a WhatsApp template submission path', () => {
    const files = [
      ...fs.readdirSync('components/settings/automations').map((f) => `components/settings/automations/${f}`),
      ...fs.readdirSync('components/settings/connections').map((f) => `components/settings/connections/${f}`),
      ...['TemplatesSettings.tsx', 'TemplateCard.tsx', 'TemplateInstallDialog.tsx', 'TemplateArt.tsx', 'InlineCreator.tsx', 'firstPartyCreators.ts', 'copy.ts', 'useCardMenu.ts'].map((f) => `components/settings/templates/${f}`),
      ...['QuoteComposer.tsx', 'QuoteComposerRow.tsx', 'QuoteComposerTotals.tsx'].map((f) => `components/quotes/${f}`),
      'components/settings/integrations/WebsiteConnection.tsx',
      'lib/automations/catalogI18n.ts',
      'lib/automations/templateI18n.ts',
    ]
    expect(files.length).toBeGreaterThan(30)
    for (const f of files) {
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8')
      expect(src, f).not.toMatch(/actions\/whatsapp\/templates|createWhatsappTemplate|submitTemplate|CreateTemplateModal/)
    }
  })
})
