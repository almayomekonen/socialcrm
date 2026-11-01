// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { act, cleanup, render } from '@testing-library/react'
import { findHebrewLeaks } from './leakScan'
import { AUTOMATIONS_CUSTOMER_DATA, NOW, resetAutomationsEnv } from './automationsEnv'

/**
 * The automations screens (Phase E5b) in en / ar: every registered page state
 * (the leak-gate surfaces) declares its language, shows no Hebrew outside data,
 * and declares nothing Hebrew; Hebrew declares nothing; tab titles; a language
 * switch within one session; hydration he / en / ar. Dialogs: automationsLocalesDialogs.
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
vi.mock('@/db/automations/pilotMetrics', async () => (await import('./automationsMocks')).pilotMetricsDbModule())
vi.mock('@/db/automations/connectionUsage', async () => (await import('./automationsMocks')).connectionUsageDbModule())
vi.mock('@/db/automations/connectionDelivery', async () => (await import('./automationsMocks')).connectionDeliveryDbModule())
vi.mock('@/db/automations/sourceLabels', async () => (await import('./automationsMocks')).sourceLabelsDbModule())
vi.mock('@/lib/automations/connectors/registry', async () => (await import('./automationsMocks')).connectorsRegistryModule())
vi.mock('@/actions/automations/manage', async () => (await import('./automationsMocks')).manageActionsModule())
vi.mock('@/actions/automations/activity', async () => (await import('./automationsMocks')).activityActionsModule())
vi.mock('@/actions/automations/connections', async () => (await import('./automationsMocks')).connectionsActionsModule())
vi.mock('@/actions/automations/templates', async () => (await import('./automationsMocks')).templatesActionsModule())
const { AUTOMATIONS_SURFACES } = await import('./automationsSurfaces')
const { automationsPage, automationsShell, withAutomationsEnv } = await import('./automationsHarness')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DIR = { en: 'ltr', ar: 'rtl' } as const
const textOf = (el: Element) => (el.textContent ?? '').replace(/[‎‏]/g, '').replace(/\s+/g, ' ')
const has = (text: string, ...parts: string[]) => parts.forEach((p) => expect(text, p).toContain(p))
const DATA = AUTOMATIONS_CUSTOMER_DATA.map((text) => ({ text, reason: 'customer-data' as const }))

const savedEnv = { ...process.env }
beforeAll(() => {
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
  resetAutomationsEnv()
})

/** What each surface must say in English (a sample per screen). */
const EN: Record<string, string[]> = {
  'automations — library + control centre (observation, identity problem, every row state)': [
    'Automation library', 'Install one capability', 'New automation', 'All', 'Leads', 'Meetings', 'Team',
    'Observation mode.', "Email sending isn't set up yet.", 'Needs attention', '12 inquiries', 'My automations', '2 active', '1 drafts',
    '4 sent · 2 would have been sent this week', 'Updated 3 h ago', 'The connection is not active', 'Draft', '2 days ago',
    'Recommendation', '21 leads are still waiting for a reply', 'Build one', 'Saved this week', '18 minutes', 'Based on 3 minutes',
    'Follow up on a lost lead', 'Send an email · After a day', 'Install', 'Connect the website',
    'A new lead comes in · only if Lead status is "New" · Send an email: "תודה שפנית אלינו" · Immediately',
  ],
  'automations — live, healthy, two automations': ['Everything is running', '1 active', 'After 2 hours'],
  'automations — none yet': ['No active automation', 'No automation installed yet.', 'New automation'],
  'automations — not on this account': ["This page isn't available on this account."],
  'automations — subscription expired': ['Renewing the subscription brings back running automations'],
  'automation templates — gallery (installed, locked, update offered)': [
    'Automation templates', 'Ready-to-use automations.', 'Leads', 'Website forms', 'Meetings', 'Internal work',
    'Installed', 'Needs a connection', 'Install again', 'One installed', 'Not installed', 'Connect the website', 'A task for the rep on every new lead', 'Now', 'Day 2', 'Day 7',
  ],
  'automation templates — everything connected, expired': ['Renewing the subscription brings back installing automations', 'Install'],
  'automation templates — not on this account': ["This page isn't available on this account."],
  'automations pilot — observation with alerts': [
    'Pilot metrics — internal', 'Observation mode — no emails are actually sent · last 30 days · this business only', 'Skip reasons',
    'Not sent — the lead has no email address', 'mystery_reason', 'A reply-to email address is missing.', 'A spam complaint is a SEV-2 event', 'Oldest pending',
  ],
  'automations pilot — disabled': ["This page isn't available."],
  'integrations — website connectors (rejected, revoked, sources)': [
    'Connect the forms on your website', 'My website', 'Connected', 'Enables automations on: A website form was submitted', 'Disconnected',
    'The connection was disconnected', 'One automation', 'last activity 9 days ago', 'Inquiries rejected', '2 sources', 'last event 5 hours ago', 'Details', 'Disconnect', 'Create a new connection',
  ],
  'integrations — website connectors, none yet': ['Not connected', 'Create a connection'],
}

describe('automations screens in en / ar', () => {
  for (const surface of AUTOMATIONS_SURFACES) {
    test(surface.name, async () => {
      for (const locale of ['en', 'ar'] as const) {
        H.prefs.userLocale = locale
        const { container } = render(await surface.render(locale))
        const declared = container.querySelector(`[lang="${locale}"]`)
        expect([declared?.getAttribute('lang'), declared?.getAttribute('dir')], `${locale} ${surface.name}`).toEqual([locale, DIR[locale]])
        expect(findHebrewLeaks(container, [...surface.allowed, ...DATA], new Set()), `${locale} ${surface.name}`).toEqual([])
        expect(container.querySelector('[lang="he"]'), `${locale} ${surface.name}: nothing is declared Hebrew`).toBeNull()
        // The event picker's groups (optgroup labels are read aloud and shown): none in Hebrew.
        for (const g of container.querySelectorAll('optgroup')) expect(g.getAttribute('label')).not.toMatch(/[֐-׿]/)
        if (locale === 'en') has(textOf(container), ...(EN[surface.name] ?? []))
        cleanup()
      }
      H.prefs.userLocale = 'he'
      const { container } = render(await surface.render('he'))
      expect(container.querySelector('[lang]'), `he ${surface.name}: Hebrew declares nothing`).toBeNull()
    })
  }

  test('Arabic samples', async () => {
    H.prefs.userLocale = 'ar'
    const ws = render(await automationsShell('ar', await withAutomationsEnv({}, () => automationsPage('automations'))))
    has(textOf(ws.container), 'مكتبة الأتمتة', 'أتمتة جديدة', 'وضع المراقبة.', 'يتطلب معالجة', 'عمليات الأتمتة الخاصة بي', 'فورًا', 'بعد يوم')
    cleanup()
    const gallery = render(await automationsShell('ar', await withAutomationsEnv({}, () => automationsPage('templates'))))
    has(textOf(gallery.container), 'قوالب الأتمتة', 'نماذج الموقع', 'العمل الداخلي', 'ربط الموقع', 'اليوم 2')
  })

  test('the template cell arrow points forward in each direction (mirrored only in LTR)', async () => {
    const arrows: Record<string, string | null> = {}
    for (const locale of ['he', 'en', 'ar'] as const) {
      H.prefs.userLocale = locale
      const v = render(await automationsShell(locale, await withAutomationsEnv({}, () => automationsPage('automations'))))
      arrows[locale] = v.container.querySelector('section button[aria-label] path[d="M15 6l-6 6 6 6"]')!.closest('svg')!.getAttribute('class')
      cleanup()
    }
    expect(arrows).toEqual({ he: null, en: '-scale-x-100', ar: null })
  })
})

describe('tab titles, language switch, hydration', () => {
  test('the automations, templates and pilot titles follow the interface language', async () => {
    const pages = await Promise.all([
      import('@/app/(he)/(app)/settings/(admin_settings)/automations/page'),
      import('@/app/(he)/(app)/settings/(admin_settings)/automation-templates/page'),
      import('@/app/(he)/(app)/settings/(admin_settings)/automations-pilot/page'),
    ])
    for (const [locale, ...titles] of [
      ['he', 'אוטומציות', 'תבניות אוטומציה', 'מדדי פיילוט'],
      ['en', 'Automations', 'Automation templates', 'Pilot metrics'],
      ['ar', 'الأتمتة', 'قوالب الأتمتة', 'مقاييس التجربة'],
    ] as const) {
      H.prefs.userLocale = locale
      for (const [i, p] of pages.entries()) expect((await p.generateMetadata()).title, locale).toBe(titles[i])
    }
  })

  test('a page re-renders in the new language within one session', async () => {
    H.prefs.userLocale = 'en'
    const node = await withAutomationsEnv({}, () => automationsPage('automations'))
    const v = render(await automationsShell('en', node))
    has(textOf(v.container), 'Automation library', 'My automations')
    v.rerender(await automationsShell('ar', node))
    has(textOf(v.container), 'مكتبة الأتمتة', 'عمليات الأتمتة الخاصة بي')
    v.rerender(await automationsShell('he', node))
    has(textOf(v.container), 'ספריית האוטומציות', 'האוטומציות שלי')
  })

  for (const locale of ['he', 'en', 'ar'] as const) {
    for (const name of ['automations', 'templates', 'pilot'] as const) {
      test(`hydration ${locale} · ${name}`, async () => {
        H.prefs.userLocale = locale
        const node = await automationsShell(locale, await withAutomationsEnv({}, () => automationsPage(name)))
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
