/**
 * Hebrew — the SOURCE catalog. Every other locale is typed against this shape.
 *
 * Strings that existed before i18n are copied here byte-for-byte from the
 * components they came from; `__tests__/i18n/shell.test.tsx` holds
 * them to it. Changing one here changes what every existing customer reads.
 *
 * Scope (Phase 1): the desktop application shell and the language settings
 * screen. Everything else in the product is still hard-coded Hebrew — see
 * claude/i18n.md for the list.
 */
export const he = {
  shell: {
    skipToContent: 'דלג לתוכן',
    help: 'עזרה',
    nav: {
      label: 'ניווט ראשי',
      openMenu: 'פתיחת תפריט',
      closeMenu: 'סגירת תפריט',
      logout: 'התנתקות',
      loggingOut: 'מתנתק',
      today: 'היום',
      leads: 'לידים',
      clients: 'לקוחות',
      inbox: 'שיחות',
      agent: 'הסוכן שלך',
      deals: 'עסקאות',
      performance: 'ביצועים',
      tasks: 'משימות',
      calendar: 'פגישות',
      settings: 'הגדרות',
      admin: 'ניהול מערכת',
    },
    workspace: {
      leadsTitle: 'לידים',
      leadsSubtitle: 'ניהול ומעקב לידים',
      clientsTitle: 'לקוחות',
      clientsSubtitle: 'ניהול קשרי לקוחות',
      inboxTitle: 'שיחות',
      inboxSubtitle: 'תיבת שיחות',
      agentTitle: 'הסוכן שלך',
      agentSubtitle: 'העוזר החכם של העסק שלך',
      tasksTitle: 'משימות',
      tasksSubtitle: 'המשימות שלך להיום',
      performanceTitle: 'ביצועים',
      performanceSubtitle: 'תובנות ומדדים',
    },
    notifications: {
      label: 'התראות',
      unread: { one: 'התראות, חדשה אחת', other: 'התראות, {count} חדשות' },
      overflow: 'התראות, יותר מ-99 חדשות',
    },
    trialPill: { one: 'PRO · נותר יום', other: 'PRO · נותרו {count} ימים' },
  },
  roles: {
    ADMIN: 'מנהל המערכת',
    GM: 'מנהל המערכת',
    MNGR: 'מנהל צוות',
    AGNT: 'נציג',
    OFFICE: 'תפעול',
    EXT: 'שותף חיצוני',
  },
  settingsNav: {
    profile: 'פרופיל אישי',
    integrations: 'אינטגרציות',
    whatsappReminders: 'תזכורות בוואטסאפ',
    support: 'תמיכה',
    language: 'שפה',
    teams: 'צוותים',
    users: 'משתמשים',
    taskTemplates: 'תבניות משימות',
    autoResponse: 'מענה אוטומטי',
    questionnaire: 'שאלון וואטסאפ',
    automations: 'אוטומציות',
    automationTemplates: 'תבניות אוטומציה',
    business: 'פרטי העסק',
    repDetails: 'פרטי נציג',
    system: 'הגדרות מערכת',
    security: 'אבטחה',
    billing: 'מנוי ותשלום',
  },
  language: {
    pageTitle: 'שפת הממשק',
    intro: 'השפה של התפריטים, הכפתורים וההגדרות. שמות, הודעות ותוכן של לידים לא מתורגמים ונשארים כפי שנכתבו.',
    personalTitle: 'השפה שלי',
    personalHelp: 'חלה רק עליך, בכל מכשיר שאתה מחובר ממנו.',
    personalLabel: 'שפת הממשק שלך',
    useAgencyDefault: 'ברירת המחדל של העסק ({language})',
    effectiveFromUser: 'מוצג כעת: {language}, לפי הבחירה האישית שלך',
    effectiveFromAgency: 'מוצג כעת: {language}, לפי ברירת המחדל של העסק',
    effectiveFromDefault: 'מוצג כעת: {language}, ברירת המחדל של המערכת',
    savePersonal: 'שמור שפה',
    savedPersonal: 'השפה עודכנה',
    agencyTitle: 'שפת ברירת המחדל של העסק',
    agencyHelp:
      'נציגים שלא בחרו שפה אישית יראו את השפה הזו. נציג שבחר שפה אישית ימשיך לראות את השפה שבחר.',
    agencyLabel: 'שפת ברירת המחדל',
    agencyChangePreview: 'אחרי השמירה, נציגים בלי שפה אישית יראו את הממשק ב: {to} (במקום {from}).',
    saveAgency: 'עדכן שפת ברירת מחדל',
    savedAgency: 'שפת ברירת המחדל של העסק עודכנה',
    saveError: 'לא ניתן לשמור את השפה. נסה שוב.',
  },
} as const
