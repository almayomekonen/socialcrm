import type { Surface } from './surfaces'
import type { Allowance } from './leakScan'
import { OWNER_WA_CONSENT } from '@/lib/whatsapp/platform/consentText'
import { CARD, MESSENGER, NO_CARD, SETTINGS_CUSTOMER_DATA, SUBSCRIPTION, TRIAL_ROW } from './settingsEnv'
import { EXPIRED, setShell, settingsPage, withSetEnv, type SettingsPage } from './settingsHarness'

/**
 * Leak-gate registrations for the user settings pages (Phase E4, desktop):
 * account pages, billing and integrations. Spread into SURFACES (surfaces.tsx);
 * rendering relies on the mocks in leakGate.test.tsx. Dialogs, toasts, URL
 * error notices and the phone-number picker are opened and scanned in
 * settingsLocales*.test.tsx.
 *
 * Allowed: only fixture DATA rendered verbatim — user / rep names, saved
 * filter names, the issuer's name and address, the Page name, ready-message
 * titles and bodies, the Messenger greeting, menu item and saved reply. The
 * recorded consent / terms sentences stay Hebrew by design and are declared
 * Hebrew regions; they are scanned (and allowed) in the locale tests only.
 */
function data(...texts: string[]): Allowance[] {
  return texts.map((text) => {
    if (!SETTINGS_CUSTOMER_DATA.includes(text)) throw new Error(`not declared as customer data: ${text}`)
    return { text, reason: 'customer-data' as const }
  })
}

const page = (name: SettingsPage, overrides: Parameters<typeof withSetEnv>[0] = {}, ent?: typeof EXPIRED) => async (locale: Parameters<Surface['render']>[0]) =>
  setShell(locale, await withSetEnv(overrides, () => settingsPage(name)), ent)

/** The reminders consent: versioned with each agreement, so it is shown as recorded (Hebrew region). */
const CONSENT: Allowance[] = [{ text: OWNER_WA_CONSENT.text, reason: 'recorded-terms' }]

const TEMPLATE_DATA = ['תזכורת פגישה', 'היי {{שם הליד}}, מזכירים את הפגישה מחר.', 'מבצע חגים', 'מבצע מיוחד לחגים!', 'הצעה אחרונה', 'קנו עכשיו!!!']
const MESSENGER_DATA = ['שלום! איך אפשר לעזור?', 'שעות פעילות', 'אנחנו פתוחים א׳-ה׳ 9:00-17:00']

export const SETTINGS_SURFACES: Surface[] = [
  { name: 'settings — account (admin)', route: '/settings/self_edit', render: page('selfEdit'), allowed: data('יעל שמש') },
  { name: 'settings — account, office role denied', route: '/settings/self_edit', render: page('selfEdit', { user: { id: 7, name: 'דנה כהן', role: 'OFFICE', agencyId: 103, picture: null, savedFilters: [] } }), allowed: [] },
  { name: 'settings — rep details', route: '/settings/update_user_details', render: page('userDetails'), allowed: [] },
  { name: 'settings — security', route: '/settings/update_security', render: page('security'), allowed: [] },
  { name: 'settings — system settings', route: '/settings/update_default', render: page('system'), allowed: [] },
  { name: 'settings — WhatsApp reminders, off', route: '/settings/whatsapp_reminders', render: page('reminders'), allowed: CONSENT },
  {
    name: 'settings — WhatsApp reminders, pending code',
    route: '/settings/whatsapp_reminders',
    render: page('reminders', { reminderRow: { status: 'pending', activationExpiresAt: '2026-10-28T09:10:00.000Z', phoneE164: null } }),
    allowed: CONSENT,
  },
  { name: 'settings — WhatsApp reminders, active', route: '/settings/whatsapp_reminders', render: page('reminders', { reminderRow: { status: 'active', phoneE164: '+972501234572' } }), allowed: [] },
  // The business name is an input value (not scanned); the address is the textarea's text.
  { name: 'settings — business details (issuer, logo)', route: '/settings/update_agency', render: page('agency'), allowed: data('הרצל 10\nחיפה 3303010') },
  { name: 'settings — business details, not an admin', route: '/settings/update_agency', render: page('agency', { user: { id: 7, name: 'דנה כהן', role: 'AGENT', agencyId: 103, picture: null, savedFilters: [] } }), allowed: [] },
  { name: 'billing centre — Pro renewing, usage, history', route: '/settings/update_payment', render: page('payment'), allowed: [] },
  {
    name: 'billing centre — cancelling, card on file',
    route: '/settings/update_payment',
    render: page('payment', { cardView: { ...CARD, cancelAtPeriodEnd: true }, subscription: { ...SUBSCRIPTION, cancelAtPeriodEnd: true, status: 'cancelling' } }),
    allowed: [],
  },
  {
    name: 'billing centre — subscription ended',
    route: '/settings/update_payment',
    render: page('payment', { subscription: { ...SUBSCRIPTION, expiresAt: new Date('2026-10-22T00:00:00Z') }, hasAccess: false }, EXPIRED),
    allowed: [],
  },
  {
    name: 'billing centre — granted Pro, card declined',
    route: '/settings/update_payment',
    render: page('payment', { subscription: { ...SUBSCRIPTION, source: 'grant', manageable: false }, cardView: { ...CARD, payment: 'declined' } }),
    allowed: [],
  },
  {
    name: 'billing centre — trial, card with charge in progress, local mode',
    route: '/settings/update_payment?mode=local',
    render: page('payment', { plan: 'free', subscription: null, usage: null as never, trialRow: TRIAL_ROW, cardView: { ...CARD, payment: 'in_progress' }, searchParams: { mode: 'local' } }),
    allowed: [],
  },
  {
    name: 'billing centre — payments unavailable, no charges',
    route: '/settings/update_payment',
    render: page('payment', { plan: 'free', subscription: null, usage: null as never, cardView: NO_CARD, billingAvailable: false, setupPurpose: 'reactivate', charges: [] }),
    allowed: [],
  },
  { name: 'integrations — everything connected', route: '/settings/integrations', render: page('integrations'), allowed: data('סטודיו דנה', ...TEMPLATE_DATA, ...MESSENGER_DATA) },
  {
    name: 'integrations — Facebook repairing, WhatsApp expired, Messenger read failure',
    route: '/settings/integrations',
    render: page('integrations', { fbHealth: { tokenValid: true, permissionsOk: true, subscribed: false, needsReconnect: false }, waStatus: 'token', messenger: { ...MESSENGER, readFailed: true } }),
    allowed: data('סטודיו דנה', ...TEMPLATE_DATA, 'שעות פעילות', 'אנחנו פתוחים א׳-ה׳ 9:00-17:00'),
  },
  {
    name: 'integrations — nothing connected, ready messages need WhatsApp, no AI',
    route: '/settings/integrations',
    render: page('integrations', { fbPage: null, waConnection: null, waStatus: 'disconnected', messenger: { visible: false }, mcp: false }),
    allowed: [],
  },
  {
    name: 'integrations — WhatsApp not ready, no ready messages, subscription expired',
    route: '/settings/integrations',
    render: page('integrations', { fbHealth: { tokenValid: false, permissionsOk: true, subscribed: true, needsReconnect: true }, waStatus: 'registration_pending', templates: [], templateCounts: {}, hasAccess: false, aiConnections: [] }, EXPIRED),
    allowed: data('סטודיו דנה', ...MESSENGER_DATA),
  },
]
