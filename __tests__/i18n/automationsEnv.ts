import { NOW } from './leadsFixtures'
import { ADMIN_USER } from './adminEnv'

/**
 * Fixed data + mutable state behind the AUTOMATIONS mocks (Phase E5b):
 * /settings/automations (the library, the control centre, the sheet, the run
 * log), /settings/automation-templates (the gallery, the install dialog, the
 * quote composer), /settings/automations-pilot and the website connectors on
 * Settings → Integrations. Used by the Hebrew baseline, the leak gate, the
 * locale and behaviour tests.
 *
 * Automation names, subjects, bodies, task titles, the lead / connection /
 * source / ready-message / quote names and the business name are DATA (Hebrew
 * on purpose) — they must reach the screen untouched by any localization.
 *
 * The `vi.mock` calls live in each test file; their factories read
 * `automationsEnv` / record into `automationsEnv.calls` (`automationsMocks.ts`).
 */
export { NOW }

const HOUR = 3_600_000
const DAY = 24 * HOUR
const at = (ms: number) => new Date(ms).toISOString()

const email = (subject: string, body: string, timing: unknown) => ({ schemaVersion: 1, subject, body, timing })

export const DEFINITIONS = [
  {
    id: 11,
    agencyId: 103,
    name: 'מענה ראשון לליד חדש',
    recipeKey: null,
    status: 'active',
    trigger: 'lead_created',
    action: 'send_email',
    content: { ...email('תודה שפנית אלינו', 'שלום {{שם הליד}},\nנחזור אליך היום.', { kind: 'preset', preset: 'immediate' }), ctaLabel: 'לקביעת שיחה', ctaUrl: 'https://example.test/call' },
    createdByUserId: 7,
    conditions: [{ field: 'status', operator: 'is', value: 'new' }],
    actions: [{ actionKey: 'email.send', parameters: {} }],
    connectionId: null,
    sourceIds: [],
    updatedAt: at(NOW - 3 * HOUR),
  },
  {
    id: 12,
    agencyId: 103,
    name: 'משימה על ליד מעוניין',
    recipeKey: null,
    status: 'paused',
    trigger: 'status_changed',
    action: 'create_task',
    content: { ...email('', '', { kind: 'custom', value: 2, unit: 'hours' }), title: 'להתקשר אל {{שם הליד}}' },
    createdByUserId: 7,
    conditions: [{ field: 'newStatus', operator: 'is', value: 'interested' }],
    actions: [{ actionKey: 'task.create', parameters: { title: 'להתקשר אל {{שם הליד}}' } }],
    connectionId: null,
    sourceIds: [],
    updatedAt: at(NOW - 2 * DAY),
  },
  {
    id: 13,
    agencyId: 103,
    name: 'תזכורת פגישה בוואטסאפ',
    recipeKey: null,
    status: 'draft',
    trigger: 'appointment_booked',
    action: 'send_whatsapp',
    content: { ...email('', '', { kind: 'before_anchor', anchorField: 'startsAt', value: 1, unit: 'days' }), templateId: 5, templateBindings: { 1: 'leadFirstName' } },
    createdByUserId: 7,
    conditions: [],
    actions: [{ actionKey: 'whatsapp.send', parameters: { templateId: 5 } }],
    connectionId: null,
    sourceIds: [],
    updatedAt: null,
  },
  {
    id: 14,
    agencyId: 103,
    name: 'מעקב טופס מהאתר',
    recipeKey: null,
    status: 'active',
    trigger: 'form_submitted',
    action: 'send_email',
    content: email('קיבלנו את הפנייה', 'שלום {{שם הליד}}, קיבלנו את הטופס.', { kind: 'custom', value: 1, unit: 'days' }),
    createdByUserId: 7,
    conditions: [],
    actions: [{ actionKey: 'email.send', parameters: {} }],
    connectionId: 'contact_form_7:3',
    sourceIds: [],
    updatedAt: at(NOW - 8 * DAY),
  },
]

export const COUNTS = {
  11: { sent: 4, wouldSend: 2, skipped: 1, failed: 0 },
  12: { sent: 0, wouldSend: 0, skipped: 0, failed: 0 },
  14: { sent: 0, wouldSend: 0, skipped: 0, failed: 2 },
}

/** The bound website connection (revoked → its automation needs attention) and the WhatsApp one. */
export const CONNECTIONS = [
  { id: 'contact_form_7:3', integrationKey: 'contact_form_7', agencyId: 103, displayName: 'האתר של דנה', health: 'revoked' },
  { id: 'contact_form_7:4', integrationKey: 'contact_form_7', agencyId: 103, displayName: 'אתר הקורסים', health: 'ok' },
]
export const SOURCES: Record<string, unknown[]> = {
  'contact_form_7:3': [],
  'contact_form_7:4': [
    { id: 'f1', connectionId: 'contact_form_7:4', label: 'טופס צור קשר', subscription: 'subscribed', health: 'ok' },
    { id: 'f2', connectionId: 'contact_form_7:4', label: 'הרשמה לסדנה', subscription: 'pending', health: 'degraded' },
  ],
}
export const USAGE = {
  'contact_form_7:3': { automations: 1, lastActivityAt: at(NOW - 9 * DAY) },
  'contact_form_7:4': { automations: 0, lastActivityAt: null },
}
export const DELIVERY = {
  'contact_form_7:4': { eventCount: 57, consecutiveRejections: 1, lastRejectedAt: at(NOW - HOUR), lastEventAt: at(NOW - 5 * HOUR), lastRejectionReason: 'invalid_signature' },
}

export const ACTIVITY_ROWS = [
  { id: 1, leadId: 51, leadName: 'רועי ברק', kind: 'sent', mode: 'live', skipReason: null, subject: 'תודה שפנית אלינו', deliveryState: 'delivered', occurredAt: at(NOW - HOUR) },
  { id: 2, leadId: 52, leadName: null, kind: 'would_send', mode: 'log', skipReason: null, subject: 'תודה שפנית אלינו', deliveryState: null, occurredAt: at(NOW - 2 * HOUR) },
  { id: 3, leadId: 53, leadName: 'מיכל שגב', kind: 'skipped', mode: 'log', skipReason: 'no_email', subject: null, deliveryState: null, occurredAt: at(NOW - 3 * HOUR) },
  { id: 4, leadId: 54, leadName: 'מיכל שגב', kind: 'skipped', mode: 'log', skipReason: 'quiet_hours', subject: null, deliveryState: null, occurredAt: at(NOW - 4 * HOUR) },
  { id: 5, leadId: 55, leadName: 'אורי נוי', kind: 'failed', mode: 'live', skipReason: null, subject: 'תודה שפנית אלינו', deliveryState: 'failed', occurredAt: at(NOW - DAY) },
  { id: 6, leadId: 56, leadName: 'אורי נוי', kind: 'sent', mode: 'live', skipReason: null, subject: 'תודה שפנית אלינו', deliveryState: 'bounced', occurredAt: at(NOW - 2 * DAY) },
]

export const PILOT = {
  windowDays: 30,
  observation: { wouldSend: 31, sent: 4, skipped: 9, failed: 1 },
  skipReasons: [{ reason: 'no_email', count: 5 }, { reason: 'quiet_hours', count: 3 }, { reason: 'mystery_reason', count: 1 }],
  identityFailures: [{ problem: 'no_reply_to', count: 2 }],
  delivery: { sent: 4, delivered: 3, bounced: 1, failed: 1 },
  bounces: 1,
  blockedAddresses: 2,
  suppressions: { total: 3, unsubscribe: 2, complaint: 1 },
  queue: { pending: 6, processing: 1, dead: 1, oldestPendingAt: at(NOW - HOUR) },
}

/** The ready-made messages, the quote templates, the composer's data. */
export const WA_TEMPLATES = [{ id: '5', label: 'תזכורת לפגישה' }, { id: '6', label: 'הודעת פתיחה' }]
export const QUOTE_OPTIONS = [{ id: '1', label: 'בניית אתר תדמית' }]
export const COMPOSER = { templates: [{ id: 1, name: 'בניית אתר תדמית' }], taxRatePercent: 18, businessName: 'סטודיו דנה' }

/** Every value above that a screen shows verbatim (the leak gate's customer-data allowances come from here). */
export const AUTOMATIONS_CUSTOMER_DATA: string[] = [
  'מענה ראשון לליד חדש',
  'משימה על ליד מעוניין',
  'תזכורת פגישה בוואטסאפ',
  'מעקב טופס מהאתר',
  'תודה שפנית אלינו',
  'קיבלנו את הפנייה',
  'להתקשר אל {{שם הליד}}',
  'רועי',
  'רועי ברק',
  'מיכל שגב',
  'אורי נוי',
  'האתר של דנה',
  'אתר הקורסים',
  'טופס צור קשר',
  'הרשמה לסדנה',
  'תזכורת לפגישה',
  'הודעת פתיחה',
  'בניית אתר תדמית',
  'סטודיו דנה',
]

export const AUTOMATIONS_DEFAULTS = {
  user: ADMIN_USER as typeof ADMIN_USER & Record<string, unknown>,
  allowlisted: true,
  pilotEnabled: true,
  sendMode: 'log' as 'log' | 'live',
  from: '',
  replyTo: null as string | null,
  agencyName: 'סטודיו דנה' as string | null,
  recentLead: 'רועי' as string | null,
  definitions: DEFINITIONS as Record<string, unknown>[],
  counts: COUNTS as Record<number, unknown>,
  todayRuns: 3,
  connections: CONNECTIONS as Record<string, unknown>[],
  capabilities: ['whatsapp_connected'] as string[],
  installs: [{ templateKey: 'welcome_sequence', templateVersion: 1, automationId: 21 }] as Record<string, unknown>[],
  sources: SOURCES,
  usage: USAGE as Record<string, unknown>,
  delivery: DELIVERY as Record<string, unknown>,
  pilot: PILOT as Record<string, unknown>,
  activity: ACTIVITY_ROWS as Record<string, unknown>[],
  hasAccess: true,
  mobile: false,
}

/** `active`: an automations page is being built (the leak gate's shared mocks then answer from these fixtures). */
type Env = typeof AUTOMATIONS_DEFAULTS & { results: Record<string, unknown>; calls: unknown[][]; active: boolean; undo?: () => void }

export const automationsEnv: Env = { ...structuredClone(AUTOMATIONS_DEFAULTS), results: {}, calls: [], active: false }

export function resetAutomationsEnv() {
  Object.assign(automationsEnv, structuredClone(AUTOMATIONS_DEFAULTS), { results: {}, calls: [], active: false, undo: undefined })
}
