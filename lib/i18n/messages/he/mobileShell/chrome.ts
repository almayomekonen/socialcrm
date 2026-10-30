/**
 * The phone shell's own chrome (Phase F1): tab bar, header, the "עוד" page.
 * Hebrew copied verbatim from `MobileTabBar`, `MobileHeader`,
 * `MobileWorkspaceShell`, `MobileMoreView` and `moreDestinations.ts` (the
 * registries keep their Hebrew; `mobileShellCopyPin.test.ts` pins them equal).
 * Reused instead of restated: the tab labels (`shell.nav.*`,
 * `shell.notifications.label`), the More row titles (`settingsNav.*`,
 * `shell.workspace.agent*`), "התנתקות" (`shell.nav.logout`).
 */
export const tabs = {
  more: 'עוד',
  /** A badged tab's accessible name (the badge itself is aria-hidden). The count is passed as its digits. */
  badged: { other: '{tab}, {count} חדשות' },
}

export const header = {
  back: 'חזרה',
  /** The header of a lead's screen: the kind of record (the page shows the name). */
  lead: 'ליד',
}

export const more = {
  section: {
    profile: 'פרופיל',
    workspace: 'סביבת העבודה',
    business: 'העסק',
    system: 'מערכת',
    account: 'חשבון',
  },
  subtitle: {
    profile: 'שם, תמונה והעדפות',
    repDetails: 'פרטי הקשר שלך',
    integrations: 'וואטסאפ, פייסבוק ואינסטגרם',
    teams: 'חלוקת הנציגים לצוותים',
    users: 'נציגים והזמנות',
    business: 'שם, לוגו ופרטי קשר',
    billing: 'תוכנית, חשבוניות ותשלומים',
    autoResponse: 'מענה אוטומטי בוואטסאפ',
    questionnaire: 'מצב השאלון ובדיקה',
    security: 'היסטוריית כניסות והתנתקות',
    system: 'ברירות מחדל',
    support: 'פתיחת פנייה ומעקב',
  },
  desktop: {
    title: 'במחשב',
    body: 'חשבוניות, דוחות ואוטומציות זמינים בגרסת המחשב.',
  },
  /** Beside the signed-in user's name and e-mail. */
  signedIn: 'מחובר',
}
