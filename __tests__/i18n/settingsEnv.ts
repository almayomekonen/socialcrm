import { NOW } from './leadsFixtures'

/**
 * Fixed data + mutable state behind the USER SETTINGS mocks (Phase E4):
 * /settings/self_edit, update_user_details, update_security, update_default,
 * whatsapp_reminders, update_agency, update_payment and integrations.
 * Used by the Hebrew baseline, the leak gate, the locale and behaviour tests.
 *
 * Names, e-mails, phone numbers, filter names, Page names, template titles and
 * bodies, saved replies, greeting / menu text, the issuer's identity and the
 * Meta / Google error text are DATA (Hebrew / English on purpose) — they must
 * reach the screen untouched by any localization.
 *
 * The `vi.mock` calls live in each test file (hoisted per file); their
 * factories read `setEnv` / record into `setEnv.calls`, see `settingsMocks.ts`.
 */
export { NOW }

const HOUR = 3_600_000
const DAY = 24 * HOUR
const at = (ms: number) => new Date(ms).toISOString()

export const SET_USER = {
  id: 7,
  name: 'דנה כהן',
  role: 'ADMIN',
  agencyId: 103,
  picture: null as string | null,
  savedFilters: [{ name: 'לידים חמים מהשבוע' }, { name: 'פייסבוק בלבד' }] as { name: string }[],
}

export const FULL_USER = {
  idNum: '123456782',
  firstName: 'דנה',
  lastName: 'כהן',
  email: 'dana@example.test',
  phone: '050-1234567',
  fax: '',
  officePhone: '03-5551234',
  tifulEmail: 'office@example.test',
  logoutMinutes: 20,
}

export const USERS = [
  { id: 7, name: 'דנה כהן' },
  { id: 8, name: 'משה לוי' },
  { id: 9, name: 'רונית אברהם' },
]
export const EXT_USERS = [{ id: 31, name: 'יעל שמש', firstName: 'יעל', lastName: 'שמש' }]
export const GAVE_PERM = [{ id: 8, name: 'משה לוי' }]

export const DEFAULT_SETTINGS = {
  isRiskUpdated: true,
  monthsLidimSheloHufku: 3,
  isMahalotKashotUpdated: false,
  monthsUpdated: 2,
  isBituachHaimMutzarHaser: true,
}

export const LOGIN_ACTIVITY = [
  {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
    ip: '84.229.10.5',
    at: new Date(NOW - 2 * HOUR),
  },
]

export const ISSUER = {
  name: 'דנה כהן ייעוץ',
  businessType: 'authorized',
  taxId: '514123456',
  address: 'הרצל 10\nחיפה 3303010',
  phone: '04-1234567',
  email: 'billing@example.test',
  img: null,
  country: 'IL',
  defaultCurrency: 'ILS',
  locale: 'he',
  docNumberFormat: 'YYYY-NNNN',
  bankDetails: {},
}

export const FB_PAGE = { page_id: 'p1', page_name: 'סטודיו דנה', page_access_token: 'sealed', granted_scopes: [], user_id: 7 }
export const HEALTHY = { tokenValid: true, permissionsOk: true, subscribed: true, needsReconnect: false }
export const PENDING_PAGES = [
  { id: 'p1', name: 'סטודיו דנה' },
  { id: 'p2', name: 'Dana Studio EN' },
]
export const PENDING_PHONES = [{ id: 'ph1', displayPhone: '+972 50-123-4567', verifiedName: 'סטודיו דנה' }]

export const TEMPLATES = [
  { id: 1, displayTitle: 'תזכורת פגישה', status: 'approved', bodyText: 'היי {{שם הליד}}, מזכירים את הפגישה מחר.', variables: [], failureText: null, archived: false, createdAt: at(NOW - 5 * DAY), category: 'UTILITY' },
  { id: 2, displayTitle: 'מבצע חגים', status: 'pending', bodyText: 'מבצע מיוחד לחגים!', variables: [], failureText: null, archived: false, createdAt: at(NOW - DAY), category: 'MARKETING' },
  {
    id: 3,
    displayTitle: 'הצעה אחרונה',
    status: 'rejected',
    bodyText: 'קנו עכשיו!!!',
    variables: [],
    failureText: 'ההודעה לא אושרה — התוכן נוגד את מדיניות וואטסאפ. כדאי לנסח מחדש בלי תוכן שיווקי אגרסיבי.',
    archived: false,
    createdAt: at(NOW - 2 * DAY),
    category: 'MARKETING',
  },
]

export const MESSENGER = {
  visible: true,
  pageId: 'p1',
  profile: { greeting: 'שלום! איך אפשר לעזור?', getStartedPayload: 'GET_STARTED', menuItems: [{ type: 'postback', title: 'הצעת מחיר', payload: 'הצעת מחיר' }], composerInputDisabled: false },
  readFailed: false,
  savedReplies: [
    {
      id: 5,
      title: 'שעות פעילות',
      body: 'אנחנו פתוחים א׳-ה׳ 9:00-17:00',
      quickReplies: [{ title: 'לקבוע שיחה', payload: 'לקבוע שיחה' }],
      buttons: [{ type: 'web_url', title: 'לאתר', url: 'https://example.test' }],
      attachmentUrl: 'https://example.test/price.pdf',
      attachmentType: 'file',
    },
  ],
}

export const AI_CONNECTIONS = [
  { grantId: 11, clientLabel: 'Claude', scopeLabels: ['צפייה בלידים שלך, במעקבים ובסיכום היומי'], connectedOn: '1.10.2026', lastUsedOn: '27.10.2026' },
  { grantId: 12, clientLabel: 'Cursor', scopeLabels: ['צפייה בלידים שלך, במעקבים ובסיכום היומי', 'צפייה בסיכומי שיחות WhatsApp עם הלידים שלך, ובהודעות עצמן לפי בקשה'], connectedOn: '20.10.2026', lastUsedOn: null },
]

export const SUBSCRIPTION = {
  plan: 'pro',
  expiresAt: new Date(NOW + 12 * DAY),
  cancelAtPeriodEnd: false,
  status: 'active',
  billingPeriod: 'monthly',
  manageable: true,
  source: 'subscription',
}
export const USAGE = { leads: { used: 1240, limit: null }, ai: { used: 37, limit: null }, automations: { used: 2, limit: null, created: 3 } }
export const NO_CARD = { hasActiveCard: false, setup: 'none', payment: 'none', card: null, cancelAtPeriodEnd: false, firstChargeAt: null, cardBilled: false }
export const CARD = { hasActiveCard: true, setup: 'confirmed', payment: 'scheduled', card: { suffix: '4242', brand: 'Visa' }, cancelAtPeriodEnd: false, firstChargeAt: new Date(NOW + 4 * DAY), cardBilled: true }
export const TRIAL_ROW = { plan: 'free', trialExempt: false, trialStartedAt: new Date(NOW - 3 * DAY), trialEndsAt: new Date(NOW + 4 * DAY), planReason: null, expiresAt: null }
export const CHARGES = [{ id: 1, transactionId: 'GROW-88231', createdAt: new Date(NOW - 20 * DAY) }]

/** Every value above that a screen shows verbatim (the leak gate's customer-data allowances come from here). */
export const SETTINGS_CUSTOMER_DATA: string[] = [
  'דנה כהן',
  'ד',
  'משה לוי',
  'רונית אברהם',
  'יעל שמש',
  'לידים חמים מהשבוע',
  'פייסבוק בלבד',
  'דנה כהן ייעוץ',
  'הרצל 10\nחיפה 3303010',
  'סטודיו דנה',
  'תזכורת פגישה',
  'מבצע חגים',
  'הצעה אחרונה',
  'היי {{שם הליד}}, מזכירים את הפגישה מחר.',
  'מבצע מיוחד לחגים!',
  'קנו עכשיו!!!',
  'שלום! איך אפשר לעזור?',
  'הצעת מחיר',
  'שעות פעילות',
  'אנחנו פתוחים א׳-ה׳ 9:00-17:00',
  'לקבוע שיחה',
  'לאתר',
]

export const SET_DEFAULTS = {
  user: SET_USER as typeof SET_USER & Record<string, unknown>,
  fullUser: FULL_USER,
  users: USERS,
  extUsers: EXT_USERS,
  gavePerm: GAVE_PERM,
  defaults: DEFAULT_SETTINGS,
  loginActivity: LOGIN_ACTIVITY as typeof LOGIN_ACTIVITY,
  mobile: false,
  facebookUserAuth: false,
  facebookLinked: false,
  remindersAudience: true,
  hasAccess: true,
  reminderRow: null as null | Record<string, unknown>,
  issuer: ISSUER as typeof ISSUER | null,
  // integrations
  fbPage: FB_PAGE as typeof FB_PAGE | null,
  fbHealth: HEALTHY as Record<string, boolean> | null,
  pendingPages: null as typeof PENDING_PAGES | null,
  commentsEnabled: false,
  waConnection: { phone_number_id: 'ph1', access_token: 'sealed' } as Record<string, string> | null,
  waReady: true,
  waStatus: 'operational',
  pendingPhones: null as typeof PENDING_PHONES | null,
  templatesEnabled: true,
  templates: TEMPLATES as Record<string, unknown>[],
  templateCounts: { approved: 1, pending: 1, rejected: 1 } as Record<string, number>,
  messenger: MESSENGER as Record<string, unknown>,
  calendar: { google_email: 'dana@gmail.test', sync_status: 'ok', last_error: null } as Record<string, unknown> | null,
  mcp: true,
  aiConnections: AI_CONNECTIONS,
  // payment
  plan: 'pro',
  subscription: SUBSCRIPTION as Record<string, unknown> | null,
  usage: USAGE as Record<string, unknown>,
  cardView: NO_CARD as Record<string, unknown>,
  trialRow: null as Record<string, unknown> | null,
  charges: CHARGES as Record<string, unknown>[],
  setupPurpose: null as string | null,
  billingAvailable: true,
}

type Env = typeof SET_DEFAULTS & { results: Record<string, unknown>; calls: unknown[][]; searchParams: Record<string, string> }

export const setEnv: Env = { ...structuredClone(SET_DEFAULTS), results: {}, calls: [], searchParams: {} }

export function resetSetEnv() {
  Object.assign(setEnv, structuredClone(SET_DEFAULTS), { results: {}, calls: [], searchParams: {} })
}
