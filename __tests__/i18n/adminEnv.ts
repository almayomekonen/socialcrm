import { NOW } from './leadsFixtures'

/**
 * Fixed data + mutable state behind the ADMIN SETTINGS mocks (Phase E5a):
 * the (admin_settings) layout, /settings/edit_users, edit_teams,
 * edit_promotions, edit_tmplts (+ a template), quote-templates and
 * auto-response. Used by the Hebrew baseline, the leak gate, the locale and
 * behaviour tests.
 *
 * Names, e-mails, team names, campaign titles / descriptions / prizes, task
 * template titles / steps / notes, quote template names / lines and the
 * auto-response texts are DATA (Hebrew on purpose) — they must reach the screen
 * untouched by any localization.
 *
 * The `vi.mock` calls live in each test file (hoisted per file); their
 * factories read `adminEnv` / record into `adminEnv.calls`, see `adminMocks.ts`.
 */
export { NOW }

const HOUR = 3_600_000
const DAY = 24 * HOUR
const at = (ms: number) => new Date(ms).toISOString()

export const ADMIN_USER = { id: 7, name: 'דנה כהן', role: 'ADMIN', agencyId: 103 }

export const ALL_USERS = [
  { id: 7, name: 'דנה כהן', firstName: 'דנה', lastName: 'כהן', role: 'ADMIN', email: 'dana@example.test', phone: '050-1234567', suspended: false, gavePerm: null, gotPerm: null, updatedAt: at(NOW - DAY), createdAt: at(NOW - 90 * DAY) },
  { id: 8, name: 'משה לוי', firstName: 'משה', lastName: 'לוי', role: 'AGNT', email: 'moshe@example.test', phone: '052-7654321', suspended: false, gavePerm: [{ id: 7, name: 'דנה כהן' }], gotPerm: [], updatedAt: at(NOW - 2 * DAY), createdAt: at(NOW - 60 * DAY) },
  { id: 9, name: 'רונית אברהם', firstName: 'רונית', lastName: 'אברהם', role: 'OFFICE', email: 'ronit@example.test', phone: null, suspended: true, gavePerm: null, gotPerm: [{ id: 8, name: 'משה לוי' }], updatedAt: at(NOW - 3 * DAY), createdAt: at(NOW - 30 * DAY) },
]

export const INVITATIONS = [
  { id: 1, firstName: 'יוסי', lastName: 'מזרחי', email: 'yossi@example.test', role: 'AGNT', phone: '054-1112222', status: 'pending', createdAt: at(NOW - DAY), expiresAt: at(NOW + 6 * DAY) },
  { id: 2, firstName: 'שרה', lastName: 'גולן', email: 'sara@example.test', role: 'MNGR', phone: null, status: 'pending', createdAt: at(NOW - 10 * DAY), expiresAt: at(NOW - 3 * DAY) },
]

export const TEAMS = [{ id: 3, name: 'צוות צפון', userIds: [8], mngrIds: [7], officeIds: [9], updatedAt: at(NOW - DAY) }]
export const ALL_TEAMS = [
  { id: 3, name: 'צוות צפון', mngrs: [{ id: 7, name: 'דנה כהן' }], users: [{ id: 8, name: 'משה לוי' }], offices: [{ id: 9, name: 'רונית אברהם' }] },
  { id: 4, name: 'צוות דרום', mngrs: [], users: [], offices: [] },
]
export const TEAM_USERS = [
  { id: 7, name: 'דנה כהן', role: 'ADMIN' },
  { id: 10, name: 'אבי מנהל', role: 'MNGR' },
  { id: 8, name: 'משה לוי', role: 'AGNT' },
  { id: 9, name: 'רונית אברהם', role: 'OFFICE' },
]

export const PROMOS = [
  {
    id: 1,
    title: 'תחרות הסתיו',
    desc: 'מי שסוגר הכי הרבה עסקאות זוכה בסופ"ש',
    start: '2026-10-01',
    end: '2026-10-31',
    img: null,
    files: [],
    grpIds: [3],
    userIds: [8],
    isPromoGrp: false,
    goals: {
      target: { שירותים: [5000, 10000], אחר: [1000, 2000] },
      prize: ['ארוחה זוגית', 'סופ"ש בצימר'],
      conditions: [{ branch: 'שירותים', prdcts: ['בניית אתר'], prdctTypes: [], companies: [] }, { branch: 'אחר' }],
    },
  },
]

export const TASK_TMPLTS = [{ id: 4, title: 'קליטת ליד חדש', createdAt: at(NOW - 5 * DAY) }]
export const TASK_TMPLT = {
  id: 4,
  title: 'קליטת ליד חדש',
  tasks: [
    { title: 'שיחת היכרות', isCompleted: false, subTasks: [{ title: 'לברר צורך', desc: 'מה הליד מחפש', isCompleted: false }] },
    { title: 'הצעת מחיר', isCompleted: false, subTasks: [] },
  ],
  notes: [{ userName: 'דנה כהן', content: 'לבדוק מול משה', createdAt: at(NOW - 2 * HOUR) }],
  files: [],
}

const item = (title: string, unitPrice: number, isOptional = false) => ({ title, description: '', quantity: 1, unitPrice, discount: 0, isOptional })
export const QUOTE_OVERVIEWS = [
  { id: 1, name: 'בניית אתר תדמית', title: 'הצעה לבניית אתר', state: 'active', validityDays: 14, itemCount: 2, optionalItemCount: 1, subtotalAmount: 4500, updatedAt: at(NOW - 2 * HOUR) },
  { id: 2, name: 'ניהול קמפיין', title: '', state: 'archived', validityDays: 1, itemCount: 1, optionalItemCount: 0, subtotalAmount: 1200, updatedAt: at(NOW - 3 * DAY) },
]
export const QUOTE_DOCUMENTS = {
  1: { id: 1, name: 'בניית אתר תדמית', title: 'הצעה לבניית אתר', introText: 'שלום, מצורפת ההצעה', termsText: 'תשלום מראש', validityDays: 14, items: [item('עיצוב ובנייה', 4500), item('תחזוקה שנתית', 900, true)] },
  2: { id: 2, name: 'ניהול קמפיין', title: '', introText: '', termsText: '', validityDays: 1, items: [item('ניהול חודשי', 1200)] },
}

export const CHANNEL = {
  enabled: true,
  dailyCap: 200,
  guidance: 'אנחנו מוסך בחולון, פתוחים א׳–ה׳.',
  agentInstructions: null as string | null,
  replyMode: 'ai',
  fixedBody: null as string | null,
  delaySeconds: 0,
  responder: 'ai',
}

/** Every value above that a screen shows verbatim (the leak gate's customer-data allowances come from here). */
export const ADMIN_CUSTOMER_DATA: string[] = [
  'דנה כהן',
  'משה לוי',
  'רונית אברהם',
  'אבי מנהל',
  'יוסי',
  'מזרחי',
  'שרה',
  'גולן',
  'צוות צפון',
  'צוות דרום',
  'דנה כהן, משה לוי',
  'תחרות הסתיו',
  'מי שסוגר הכי הרבה עסקאות זוכה בסופ"ש',
  'קליטת ליד חדש',
  'שיחת היכרות',
  'לברר צורך',
  'מה הליד מחפש',
  'הצעת מחיר',
  'לבדוק מול משה',
  'בניית אתר תדמית',
  'ניהול קמפיין',
  'אנחנו מוסך בחולון, פתוחים א׳–ה׳.',
  // The agency name: the auto-response test chat names the business it simulates.
  'סטודיו דנה',
]

export const ADMIN_DEFAULTS = {
  user: ADMIN_USER as typeof ADMIN_USER & Record<string, unknown>,
  allUsers: ALL_USERS as Record<string, unknown>[],
  invitations: INVITATIONS as Record<string, unknown>[],
  teams: TEAMS as Record<string, unknown>[],
  allTeams: ALL_TEAMS as Record<string, unknown>[],
  teamUsers: TEAM_USERS as Record<string, unknown>[],
  promos: PROMOS as Record<string, unknown>[],
  taskTmplts: TASK_TMPLTS as Record<string, unknown>[],
  taskTmplt: TASK_TMPLT as Record<string, unknown> | null,
  quoteOverviews: QUOTE_OVERVIEWS as Record<string, unknown>[],
  quoteDocuments: QUOTE_DOCUMENTS as Record<number, unknown>,
  master: true,
  channel: CHANNEL as Record<string, unknown> | null,
  agencyName: 'סטודיו דנה' as string | null,
  builder: false,
  mobile: false,
  hasAccess: true,
}

/** `active`: an admin page is being built (the leak gate's shared mocks then answer from these fixtures). */
type Env = typeof ADMIN_DEFAULTS & { results: Record<string, unknown>; calls: unknown[][]; active: boolean }

export const adminEnv: Env = { ...structuredClone(ADMIN_DEFAULTS), results: {}, calls: [], active: false }

export function resetAdminEnv() {
  Object.assign(adminEnv, structuredClone(ADMIN_DEFAULTS), { results: {}, calls: [], active: false })
}
