// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import { NOW, automationsEnv, resetAutomationsEnv } from './automationsEnv'
import { EXPIRED, automationsPage, automationsShell, websiteSection, type AutomationPage } from './automationsHarness'

/**
 * HEBREW BASELINE for the automations screens (Phase E5b) — server HTML of
 * every page-level state of /settings/automations, /settings/automation-templates,
 * /settings/automations-pilot and the website connectors section of Settings →
 * Integrations. Recorded BEFORE Phase E5b on unmodified product code.
 * (Interactions: automationsHebrewBaselineInteractions / …Gallery.)
 *
 * Real server pages inside the real (admin_settings) layout, I/O mocked, no
 * i18n provider. Normalized: `<!-- -->` separators and `useId` values only.
 */

vi.mock('next/navigation', async () => (await import('./automationsMocks')).navigationModule())
vi.mock('@/db/auth', async () => (await import('./automationsMocks')).authModule())
vi.mock('@/lib/requireUser', async () => (await import('./automationsMocks')).requireUserModule())
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: null, agencyLocale: null }) }))
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
vi.mock('@/actions/automations/sendTest', async () => (await import('./automationsMocks')).sendTestModule())
vi.mock('@/actions/automations/connections', async () => (await import('./automationsMocks')).connectionsActionsModule())
vi.mock('@/actions/automations/firstPartyOptions', async () => (await import('./automationsMocks')).firstPartyOptionsModule())
vi.mock('@/actions/automations/previewMessage', async () => (await import('./automationsMocks')).previewMessageModule())
vi.mock('@/actions/automations/previewEmail', async () => (await import('./automationsMocks')).previewEmailModule())
vi.mock('@/actions/automations/templates', async () => (await import('./automationsMocks')).templatesActionsModule())
vi.mock('@/actions/quotes/templates', async () => (await import('./automationsMocks')).quoteActionsModule())

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const renderToString = (node: ReactNode) => normalizeIds(renderRaw(<>{node}</>).replaceAll('<!-- -->', ''))
const set = (overrides: Partial<typeof automationsEnv>) => Object.assign(automationsEnv, overrides)
const html = async (name: AutomationPage, ent?: typeof EXPIRED) => renderToString(await automationsShell(null, await automationsPage(name), ent))

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetAutomationsEnv()
})

describe('Hebrew baseline — automations screens (server HTML)', () => {
  test('automations: observation + identity problem, live and healthy, no automations, everything installed, not allowlisted, expired', async () => {
    const out: Record<string, string> = {}
    out.base = await html('automations')
    set({ sendMode: 'live', from: 'auto@mail.example.test', replyTo: 'dana@example.test', recentLead: null })
    out.live = await html('automations')
    set({ definitions: [], counts: {}, sendMode: 'log' })
    out.empty = await html('automations')
    set({
      definitions: (await import('./automationsEnv')).DEFINITIONS.slice(0, 2),
      capabilities: ['whatsapp_connected', 'website_connected'],
      installs: (await import('@/lib/automations/templates/registry')).listTemplates().map((t, i) => ({ templateKey: t.key, templateVersion: t.version, automationId: 40 + i })),
    })
    out.allInstalled = await html('automations')
    set({ allowlisted: false })
    out.notAllowlisted = await html('automations')
    set({ allowlisted: true, hasAccess: false, capabilities: ['whatsapp_connected'], installs: [] })
    out.expired = await html('automations', EXPIRED)
    expect(out).toMatchSnapshot()
  })

  test('automation-templates: gallery (installed, locked, update offered), all connected, not allowlisted, expired', async () => {
    const out: Record<string, string> = {}
    set({ installs: [{ templateKey: 'welcome_sequence', templateVersion: 1, automationId: 21 }, { templateKey: 'internal_task_on_new_lead', templateVersion: 0, automationId: 22 }, { templateKey: 'internal_task_on_new_lead', templateVersion: 0, automationId: 23 }] })
    out.base = await html('templates')
    set({ capabilities: ['whatsapp_connected', 'website_connected'], installs: [] })
    out.connected = await html('templates')
    set({ allowlisted: false })
    out.notAllowlisted = await html('templates')
    set({ allowlisted: true, hasAccess: false })
    out.expired = await html('templates', EXPIRED)
    expect(out).toMatchSnapshot()
  })

  test('automations-pilot: observation with alerts, live and quiet, disabled, not allowlisted', async () => {
    const out: Record<string, string> = {}
    out.base = await html('pilot')
    set({
      sendMode: 'live',
      pilot: {
        windowDays: 30,
        observation: { wouldSend: 0, sent: 12, skipped: 0, failed: 0 },
        skipReasons: [],
        identityFailures: [],
        delivery: { sent: 12, delivered: 12, bounced: 0, failed: 0 },
        bounces: 0,
        blockedAddresses: 0,
        suppressions: { total: 0, unsubscribe: 0, complaint: 0 },
        queue: { pending: 0, processing: 0, dead: 0, oldestPendingAt: null },
      },
    })
    out.quiet = await html('pilot')
    set({ pilotEnabled: false })
    out.disabled = await html('pilot')
    set({ pilotEnabled: true, allowlisted: false })
    out.notAllowlisted = await html('pilot')
    expect(out).toMatchSnapshot()
  })

  test('website connectors on Integrations: connections, none, hidden for a non-admin', async () => {
    const out: Record<string, string> = {}
    out.base = renderToString(await automationsShell(null, await websiteSection()))
    set({ connections: [], usage: {}, delivery: {} })
    out.none = renderToString(await automationsShell(null, await websiteSection()))
    set({ user: { ...automationsEnv.user, role: 'AGNT' } })
    out.hidden = renderToString(await automationsShell(null, await websiteSection()))
    expect(out).toMatchSnapshot()
  })
})
