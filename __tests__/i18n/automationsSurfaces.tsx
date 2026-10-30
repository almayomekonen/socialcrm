import type { Surface } from './surfaces'
import type { Allowance } from './leakScan'
import { AUTOMATIONS_CUSTOMER_DATA, DEFINITIONS } from './automationsEnv'
import { EXPIRED, automationsPage, automationsShell, websiteSection, withAutomationsEnv, type AutomationPage } from './automationsHarness'
import { withAdminEnv } from './adminHarness'

/**
 * Leak-gate registrations for the automations screens (Phase E5b, desktop):
 * /settings/automations (library + control centre), /settings/automation-templates,
 * /settings/automations-pilot and the website connectors on Settings →
 * Integrations. Spread into SURFACES (surfaces.tsx); rendering relies on the
 * mocks in leakGate.test.tsx (switching factories: leakGateAutomationsMocks.ts).
 * The sheet, the run log, the install dialog, the composer and the connection
 * dialogs are opened and scanned in automationsLocales*.test.tsx.
 *
 * Allowed: fixture DATA rendered verbatim — automation names, their subjects
 * (inside the row's assistive sentence), connection and source names.
 */
function data(...texts: string[]): Allowance[] {
  return texts.map((text) => {
    if (!AUTOMATIONS_CUSTOMER_DATA.includes(text)) throw new Error(`not declared as customer data: ${text}`)
    return { text, reason: 'customer-data' as const }
  })
}

/** The (admin_settings) layout reads the session through the admin fixtures; the page through the automations ones. */
const page = (name: AutomationPage, overrides: Parameters<typeof withAutomationsEnv>[0] = {}, ent?: typeof EXPIRED) => async (locale: Parameters<Surface['render']>[0]) =>
  automationsShell(locale, await withAdminEnv({}, () => withAutomationsEnv(overrides, () => automationsPage(name))), ent)

const website = (overrides: Parameters<typeof withAutomationsEnv>[0] = {}) => async (locale: Parameters<Surface['render']>[0]) =>
  automationsShell(locale, await withAutomationsEnv(overrides, () => websiteSection(locale)))

const NAMES = ['מענה ראשון לליד חדש', 'משימה על ליד מעוניין', 'תזכורת פגישה בוואטסאפ', 'מעקב טופס מהאתר']
const SUBJECTS = ['תודה שפנית אלינו', 'קיבלנו את הפנייה']

export const AUTOMATIONS_SURFACES: Surface[] = [
  {
    name: 'automations — library + control centre (observation, identity problem, every row state)',
    route: '/settings/automations',
    render: page('automations'),
    allowed: data(...NAMES, ...SUBJECTS),
  },
  {
    name: 'automations — live, healthy, two automations',
    route: '/settings/automations',
    render: page('automations', { sendMode: 'live', from: 'auto@mail.example.test', replyTo: 'dana@example.test', definitions: DEFINITIONS.slice(0, 2) }),
    allowed: data(NAMES[0], NAMES[1], SUBJECTS[0]),
  },
  { name: 'automations — none yet', route: '/settings/automations', render: page('automations', { definitions: [], counts: {} }), allowed: [] },
  { name: 'automations — not on this account', route: '/settings/automations', render: page('automations', { allowlisted: false }), allowed: [] },
  {
    name: 'automations — subscription expired',
    route: '/settings/automations',
    render: page('automations', { hasAccess: false, definitions: DEFINITIONS.slice(0, 1) }, EXPIRED),
    allowed: data(NAMES[0], SUBJECTS[0]),
  },
  {
    name: 'automation templates — gallery (installed, locked, update offered)',
    route: '/settings/automation-templates',
    render: page('templates', { installs: [{ templateKey: 'welcome_sequence', templateVersion: 1, automationId: 21 }, { templateKey: 'internal_task_on_new_lead', templateVersion: 0, automationId: 22 }] }),
    allowed: [],
  },
  { name: 'automation templates — everything connected, expired', route: '/settings/automation-templates', render: page('templates', { capabilities: ['whatsapp_connected', 'website_connected'], hasAccess: false }, EXPIRED), allowed: [] },
  { name: 'automation templates — not on this account', route: '/settings/automation-templates', render: page('templates', { allowlisted: false }), allowed: [] },
  { name: 'automations pilot — observation with alerts', route: '/settings/automations-pilot', render: page('pilot'), allowed: [] },
  { name: 'automations pilot — disabled', route: '/settings/automations-pilot', render: page('pilot', { pilotEnabled: false }), allowed: [] },
  { name: 'integrations — website connectors (rejected, revoked, sources)', route: '/settings/integrations', render: website(), allowed: data('האתר של דנה', 'אתר הקורסים') },
  { name: 'integrations — website connectors, none yet', route: '/settings/integrations', render: website({ connections: [], usage: {}, delivery: {} }), allowed: [] },
]
