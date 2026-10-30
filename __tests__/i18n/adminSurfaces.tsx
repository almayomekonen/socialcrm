import type { Surface } from './surfaces'
import type { Allowance } from './leakScan'
import { ADMIN_CUSTOMER_DATA, ADMIN_USER, CHANNEL, QUOTE_OVERVIEWS } from './adminEnv'
import { EXPIRED, adminPage, adminShell, withAdminEnv, type AdminPage } from './adminHarness'

/**
 * Leak-gate registrations for the admin settings pages (Phase E5a, desktop):
 * the (admin_settings) refusal, users + invitations, teams, the campaign
 * editor, task templates (+ one template), quote templates and the
 * auto-response chrome. Spread into SURFACES (surfaces.tsx); rendering relies on
 * the mocks in leakGate.test.tsx. Dialogs, popovers, validation and toasts are
 * opened and scanned in adminLocales*.test.tsx.
 *
 * Allowed: fixture DATA rendered verbatim (names, team names, campaign texts,
 * template titles / steps / notes, quote template names, the business
 * description) and — on auto-response only — the Smart Agent's own
 * configuration fields and test chat (`ai-config`), which stay Hebrew by owner
 * order inside declared Hebrew regions.
 */
function data(...texts: string[]): Allowance[] {
  return texts.map((text) => {
    if (!ADMIN_CUSTOMER_DATA.includes(text)) throw new Error(`not declared as customer data: ${text}`)
    return { text, reason: 'customer-data' as const }
  })
}

const page = (name: AdminPage, overrides: Parameters<typeof withAdminEnv>[0] = {}, ent?: typeof EXPIRED) => async (locale: Parameters<Surface['render']>[0]) =>
  adminShell(locale, await withAdminEnv(overrides, () => adminPage(name)), ent)

/** The Smart Agent's own fields and its test chat (AI configuration — not localized by owner order). */
export const AI_CONFIG: Allowance[] = [
  'ספרו לסוכן על העסק ומה תרצו שיעשה',
  'כתבו מה העסק מציע, מידע שחשוב ללקוחות לדעת ואיך תרצו שהסוכן יעזור. הסוכן ישתמש במידע כדי לענות ולנהל שיחה בשם העסק.',
  'אנחנו מוסך בחולון, פתוחים א׳–ה׳ 8:00–17:00. עושים טיפולים ותיקונים. ברר מה הבעיה ברכב, דגם ושנתון, ואסוף פרטים כדי שנחזור ללקוח לתיאום.',
  'הטקסט הזה לא נשלח ללקוח',
  'בדקו את הסוכן שלכם',
  'שיחת בדיקה שלא נשלחת לאף אחד. אפשר לכתוב כמו לקוח ולראות מה הסוכן עונה.',
].map((text) => ({ text, reason: 'ai-config' as const }))

const PEOPLE = ['דנה כהן', 'משה לוי', 'רונית אברהם']

export const ADMIN_SURFACES: Surface[] = [
  { name: 'admin settings — refused for a non-admin', route: '/settings/edit_users', render: page('editUsers', { user: { ...ADMIN_USER, role: 'AGNT' } }), allowed: [] },
  { name: 'admin — users + invitations', route: '/settings/edit_users', render: page('editUsers'), allowed: data(...PEOPLE, 'יוסי', 'מזרחי', 'שרה', 'גולן') },
  { name: 'admin — users, no invitations', route: '/settings/edit_users', render: page('editUsers', { invitations: [] }), allowed: data(...PEOPLE) },
  { name: 'admin — teams', route: '/settings/edit_teams', render: page('editTeams'), allowed: data('צוות צפון', 'צוות דרום', ...PEOPLE) },
  { name: 'admin — teams, none yet', route: '/settings/edit_teams', render: page('editTeams', { allTeams: [] }), allowed: [] },
  { name: 'admin — campaigns', route: '/settings/edit_promotions', render: page('editPromotions'), allowed: data('תחרות הסתיו', 'מי שסוגר הכי הרבה עסקאות זוכה בסופ"ש') },
  { name: 'admin — campaigns, none yet', route: '/settings/edit_promotions', render: page('editPromotions', { promos: [] }), allowed: [] },
  { name: 'admin — task templates', route: '/settings/edit_tmplts', render: page('editTmplts'), allowed: data('קליטת ליד חדש') },
  { name: 'admin — task templates, none yet', route: '/settings/edit_tmplts', render: page('editTmplts', { taskTmplts: [] }), allowed: [] },
  {
    name: 'admin — a task template (steps, notes, files)',
    route: '/settings/edit_tmplts/4',
    render: page('tmpltDetail'),
    allowed: data('קליטת ליד חדש', 'שיחת היכרות', 'הצעת מחיר', 'לברר צורך', 'מה הליד מחפש', 'לבדוק מול משה', 'דנה כהן'),
  },
  { name: 'admin — quote templates (active + archive)', route: '/settings/quote-templates', render: page('quoteTemplates'), allowed: data('בניית אתר תדמית', 'ניהול קמפיין') },
  { name: 'admin — quote templates, none yet', route: '/settings/quote-templates', render: page('quoteTemplates', { quoteOverviews: [], quoteDocuments: {} }), allowed: [] },
  {
    name: 'admin — quote templates, subscription expired',
    route: '/settings/quote-templates',
    render: page('quoteTemplates', { hasAccess: false, quoteOverviews: QUOTE_OVERVIEWS.slice(0, 1) }, EXPIRED),
    allowed: data('בניית אתר תדמית'),
  },
  { name: 'admin — auto-response, smart reply', route: '/settings/auto-response', render: page('autoResponse'), allowed: [...data('אנחנו מוסך בחולון, פתוחים א׳–ה׳.'), ...AI_CONFIG] },
  {
    name: 'admin — auto-response, fixed message, questionnaire answering (Builder)',
    route: '/settings/auto-response',
    render: page('autoResponse', { channel: { ...CHANNEL, replyMode: 'fixed', responder: 'questionnaire' }, builder: true }),
    allowed: [],
  },
  {
    name: 'admin — auto-response off, questionnaire set up by staff, expired',
    route: '/settings/auto-response',
    render: page('autoResponse', { master: false, channel: { ...CHANNEL, responder: 'questionnaire' }, hasAccess: false }, EXPIRED),
    allowed: [],
  },
]
