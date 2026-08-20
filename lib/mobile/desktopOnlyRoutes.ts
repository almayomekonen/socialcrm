import type { IconNames } from '@/lib/Icon'

/**
 * The sections that have NO phone presentation yet — declared in one place.
 *
 * THE PROBLEM THIS SOLVES. The mobile workspace swaps the whole shell at the
 * layout, but each route decides its own presentation at its own page. A route
 * that never grew a mobile branch inherits only half of that decision: the phone
 * gets `MobileWorkspaceShell` (correct) wrapped around the desktop table
 * (forbidden) — the exact "Phone request → Mobile shell → Desktop route" tree
 * architecture-rules.md §9 rules out. Seven sections were in that state.
 *
 * WHAT THIS FILE IS NOT. It is not a "coming soon" list, not a roadmap, and not
 * a set of disabled buttons. Each entry produces a real screen with a real
 * action (see `MobileDesktopOnly`). A section leaves this file the moment it
 * gains a phone presentation — deleting its entry is the whole migration.
 *
 * THE COMPLETENESS GUARANTEE lives in `__tests__/a11y/mobileRouteCoverage.test.ts`,
 * which walks `app/(app)` and fails if a top-level route is neither mobile-branched
 * nor listed here. That is what stops the next new route from silently
 * reintroducing the defect this file exists to close.
 *
 * PURE DATA: no JSX and no client hooks, so it imports cleanly from server and
 * client alike — the same rule `moreDestinations.ts` follows.
 *
 * COPY CONTRACT. Every body opens with the same sentence, verbatim, because the
 * user's first question is always the same one: is this broken? It is not, and
 * the answer has to be the first thing read. Then what the section does, so the
 * capability is understood to exist rather than to be missing. Never an apology,
 * never "not supported", never a limitation framed as the user's problem
 * (care-charter.md Laws 4–8, 13). Terminology is bound by ux-guidelines.md §6:
 * `לידים` and `נציג`; never `לקוח`, never `סוכן`. No emoji (CLAUDE.md §12).
 */

/** The lead sentence, shared by every entry and asserted by the a11y suite. */
export const DESKTOP_ONLY_LEAD = 'המסך הזה זמין כרגע מהמחשב.'

export type DesktopOnlySection =
  | 'tasks'
  | 'calendar'
  | 'deals'
  | 'clients'
  | 'sum_sales'
  | 'files'
  | 'promotion'
  // The lead-detail TABS. `summary` is absent on purpose — it is the real mobile
  // lead screen (`LeadDetailMobile`) and must stay reachable.
  | 'lead_tasks'
  | 'lead_files'
  | 'lead_billing'
  // Settings surfaces that are genuinely desktop tools.
  | 'ai_inspector'

export type DesktopOnlyEntry = {
  /** The desktop nav's own icon, so the section is recognisable across devices. */
  icon: IconNames
  /** The section's name. Reused from the desktop nav wherever terminology allows. */
  title: string
  body: string
}

export const DESKTOP_ONLY_SECTIONS: Record<DesktopOnlySection, DesktopOnlyEntry> = {
  tasks: {
    icon: 'list-check',
    title: 'משימות',
    body: `${DESKTOP_ONLY_LEAD} שם רואים את כל המשימות, מסננים לפי נציג ומסמנים מה כבר בוצע.`,
  },
  calendar: {
    icon: 'calendar',
    title: 'פגישות',
    body: `${DESKTOP_ONLY_LEAD} שם מחברים את יומן Google ורואים את כל הפגישות הקרובות.`,
  },
  deals: {
    icon: 'dollar-sign',
    title: 'עסקאות',
    body: `${DESKTOP_ONLY_LEAD} שם מנהלים את העסקאות ורואים את הסכומים וההתקדמות מולם.`,
  },
  clients: {
    // The desktop nav labels this 'לקוחות'. The mobile copy does not: there is
    // one entity in this system and it is the ליד (CLAUDE.md Entity Constraint,
    // ux-guidelines.md §6). A closed ליד is described by its status, not renamed.
    icon: 'user-check',
    title: 'לידים שסגרו עסקה',
    body: `${DESKTOP_ONLY_LEAD} שם רואים את כל הלידים שכבר סגרו עסקה ואת מלוא הפרטים שלהם.`,
  },
  sum_sales: {
    icon: 'chart-pie',
    title: 'ביצועים',
    body: `${DESKTOP_ONLY_LEAD} שם רואים את סיכומי המכירות, היעדים והביצועים של כל נציג.`,
  },
  files: {
    icon: 'folders',
    title: 'קבצים',
    body: `${DESKTOP_ONLY_LEAD} שם רואים את כל הקבצים שצורפו ללידים ולמשימות.`,
  },
  promotion: {
    icon: 'trophy',
    title: 'קמפיינים',
    body: `${DESKTOP_ONLY_LEAD} שם רואים את תחרויות המכירה, היעדים וההתקדמות שלך מולם.`,
  },

  /**
   * The lead-detail tabs behind סיכום ליד. On a phone the four-tab `ClientNav`
   * is not rendered at all, so these are reachable only by typing the URL — but
   * "only reachable by URL" is not "unreachable", and until now each one served
   * a desktop table inside the phone shell.
   *
   * Titled with "הליד" so the screen says WHICH record's tab this is; the phone
   * has no tab strip to supply that context.
   */
  lead_tasks: {
    icon: 'list-check',
    title: 'משימות הליד',
    body: `${DESKTOP_ONLY_LEAD} שם רואים את כל המשימות שנפתחו לליד הזה ומוסיפים משימה חדשה.`,
  },
  lead_files: {
    icon: 'folders',
    title: 'קבצי הליד',
    body: `${DESKTOP_ONLY_LEAD} שם רואים את הקבצים שצורפו לליד הזה ומצרפים קבצים מ-Google Drive.`,
  },
  lead_billing: {
    icon: 'credit-card',
    title: 'חיוב הליד',
    body: `${DESKTOP_ONLY_LEAD} שם מפיקים הצעות מחיר וחשבוניות לליד הזה ועוקבים אחרי הסטטוס שלהן.`,
  },

  /**
   * A diagnostic console for AI decisions — ADMIN plus a feature flag, and two
   * wide tables of run records. It is a tool for inspecting the system, not for
   * running the business, so it is the one Settings destination that earns a
   * handoff rather than a mobile screen.
   *
   * It is also REMOVED from the mobile "עוד" menu (see `moreDestinations.ts`), so
   * this handoff is only ever reached by typing the URL. Nobody discovers it by
   * tapping.
   */
  ai_inspector: {
    icon: 'brain',
    title: 'AI Inspector',
    body: `${DESKTOP_ONLY_LEAD} שם רואים את היסטוריית ההחלטות של ה-AI ואת הנתונים שעליהם הן התבססו.`,
  },
}

/**
 * The route prefixes each section owns, for the coverage test.
 *
 * `/clients` is the reason this is a map rather than a derived string: the
 * SECTION is desktop-only, but `/clients/[clientId]/summary` is a fully built
 * mobile lead-detail screen. A prefix match would hand off the one route on this
 * list that must never be handed off, so the exact-vs-prefix distinction is
 * recorded here rather than re-derived at each call site.
 */
export const DESKTOP_ONLY_ROUTES: Record<DesktopOnlySection, { path: string; exact: boolean }> = {
  tasks: { path: '/tasks', exact: false },
  calendar: { path: '/calendar', exact: false },
  deals: { path: '/deals', exact: false },
  clients: { path: '/clients', exact: true },
  sum_sales: { path: '/sum_sales', exact: false },
  files: { path: '/files', exact: false },
  promotion: { path: '/promotion', exact: false },

  // Nested under the lead. Prefix matches, so `billing/new` and
  // `billing/[invoiceId]` are covered by the `billing` entry.
  lead_tasks: { path: '/clients/[clientId]/tasks', exact: false },
  lead_files: { path: '/clients/[clientId]/files', exact: false },
  lead_billing: { path: '/clients/[clientId]/billing', exact: false },

  ai_inspector: { path: '/settings/ai-inspector', exact: false },
}

/**
 * SETTINGS SUB-ROUTES THAT STILL SERVE THEIR DESKTOP PAGE TO A PHONE.
 *
 * A BACKLOG, NOT AN ENDORSEMENT. Every entry here is the defect this file was
 * created to close — `MobileWorkspaceShell` wrapped around a desktop settings
 * form — surviving because `mobileRouteCoverage` only ever walked TOP-LEVEL
 * segments. `/settings` is declared mobile-ready (the עוד hub and SettingsChrome
 * dropping the nav column are real), and that one declaration was silently
 * covering all twenty-one routes beneath it.
 *
 * They are listed rather than fixed because each needs its own product decision
 * — a phone screen, or a handoff — and that is a larger piece of work than the
 * route that prompted this list. What the list buys today is that a NEW settings
 * route cannot join them silently: it will be undeclared, and the coverage test
 * will fail on the commit that adds it.
 *
 * Most of these are reachable from the mobile עוד hub and do reflow onto a phone,
 * which is why they are tolerable rather than broken. That is not the same as
 * designed, and none of them should be cited as precedent.
 *
 * An entry leaves this list the moment its route gains a phone presentation
 * (move it to MOBILE_READY_ROUTES) or an explicit handoff (DESKTOP_ONLY_*).
 */
export const SETTINGS_MOBILE_BACKLOG: Record<string, string> = {
  '/settings/self_edit': 'פרופיל אישי — desktop form, linked from עוד',
  '/settings/update_user_details': 'פרטי נציג — desktop form, linked from עוד',
  '/settings/edit_teams': 'צוותים — desktop form, linked from עוד',
  '/settings/edit_users': 'משתמשים — desktop form, linked from עוד',
  '/settings/update_agency': 'פרטי העסק — desktop form, linked from עוד',
  '/settings/update_payment': 'מנוי ותשלום — desktop form, linked from עוד',
  '/settings/update_security': 'אבטחה — desktop form, linked from עוד',
  '/settings/update_default': 'הגדרות מערכת — desktop form, linked from עוד',
  '/settings/connections': 'חיבורים — desktop surface, not linked from עוד',
  '/settings/calendar': 'יומן — desktop surface, not linked from עוד',
  '/settings/facebook': 'פייסבוק — desktop surface, reached from integrations',
  '/settings/automations': 'אוטומציות — desktop builder, not linked from עוד',
  '/settings/automations-pilot': 'אוטומציות (פיילוט) — desktop builder',
  '/settings/automation-templates': 'תבניות אוטומציה — desktop builder',
  '/settings/quote-templates': 'תבניות הצעות מחיר — desktop builder',
  '/settings/edit_tmplts': 'תבניות משימות — desktop builder',
  '/settings/edit_promotions': 'קמפיינים — desktop surface',
}

/**
 * The lead-detail tabs, keyed by their directory under
 * `app/(app)/clients/[clientId]/`. `summary` is the ONLY one absent, and the
 * coverage test asserts exactly that — so a new tab added there cannot quietly
 * become the next desktop table inside the phone shell.
 */
export const LEAD_TAB_SECTIONS: Record<string, DesktopOnlySection> = {
  tasks: 'lead_tasks',
  files: 'lead_files',
  billing: 'lead_billing',
}

/** The lead-detail tab that IS a real phone screen. */
export const MOBILE_READY_LEAD_TAB = 'summary'

/**
 * The other half of the ledger: top-level routes that DO serve a phone, and the
 * reason each one is a decision rather than an oversight.
 *
 * Every top-level route under `app/(app)` must appear in exactly one of these
 * two lists. The coverage test enforces that, which is what turns "we forgot to
 * think about /whatever on mobile" from a silent production defect into a failing
 * test on the commit that adds the route.
 */
export const MOBILE_READY_ROUTES: Record<string, string> = {
  '/dashboard': 'היום — MobileToday / MobileTodayEmpty, branched in components/home/DashboardPage.tsx',
  '/leads': 'לידים — LeadListMobile, branched in app/(app)/leads/page.tsx',
  '/inbox': 'שיחות — MobileInboxRoute, branched in app/(app)/inbox/page.tsx',
  // Precisely the summary tab, not the whole subtree: its sibling tabs
  // (tasks / files / billing) are desktop-only and listed above.
  '/clients/[clientId]/summary': 'ליד — LeadDetailMobile, branched in the summary page; the /clients LIST is desktop-only',
  '/m': 'עוד — the mobile settings hub. Phone-only by server gate; desktop is redirected away',
  '/settings': 'Reached directly from עוד. SettingsChrome drops the desktop nav column on a phone',
  '/settings/integrations':
    'אינטגרציות — IntegrationsMobile (status cards + Ready Messages), branched in the integrations page',
  /**
   * The master switch, not the settings form. `AutoResponseMobile` shows whether
   * automatic WhatsApp replies are running and lets an admin stop them; the
   * seven-field desktop form is deliberately NOT reproduced, and the screen says
   * so. Listed here rather than as a handoff because there IS a phone screen —
   * a kill switch is exactly the thing you need without a computer.
   */
  '/settings/auto-response':
    'מענה אוטומטי — AutoResponseMobile (status + read-only message + master kill switch), branched in the auto-response page',
  /**
   * NOT a desktop handoff, deliberately — the §5 question, answered by reading
   * the code rather than by assuming.
   *
   * The notification center is already a mobile presentation: a single vertical
   * list of full-width `NotificationRow` buttons (one tap target per row, no
   * nested controls), above it two `flex-wrap` chip groups that reflow to one
   * column, inside a `p-3 sm:p-4` container. There is no table, no grid, no
   * column set and no horizontal overflow — it degrades to a phone unchanged.
   *
   * It is also a Mobile Tab Bar destination, so replacing a working list with
   * "this is on the computer" would REMOVE a working mobile screen and leave a
   * tab that goes nowhere. §7 forbids exactly that regression.
   */
  '/notifications': 'התראות — already a usable mobile list (stacked rows + wrapping filter chips); a tab bar destination',
}
