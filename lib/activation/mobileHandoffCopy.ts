/**
 * Copy for the mobile handoff screen — the single thing SocialCRM says on a
 * phone.
 *
 * Tone contract (care-charter.md §4, Laws 4–8): calm and confident. This screen
 * never apologises, never says "not supported", never implies the user did
 * something wrong, and never frames the desktop requirement as a limitation.
 * SocialCRM is a desktop workspace by design and a mobile app is being built;
 * both of those are statements about the product, not about the person holding
 * the phone.
 *
 * Terminology is bound by ux-guidelines.md §6: `לידים` only — never `לקוח`,
 * never `סוכן`. No emoji anywhere (CLAUDE.md §12).
 */

/** Where the user is being sent. Displayed verbatim and copied to the clipboard. */
export const DESKTOP_URL = 'https://getsocialcrm.com'

/** The bare host, shown as selectable text under the CTA. */
export const DESKTOP_URL_LABEL = 'getsocialcrm.com'

export const MOBILE_HANDOFF_COPY = {
  heading: 'SocialCRM עובד במיטבו במחשב.',
  body: 'המערכת מותאמת למסך גדול, כדי לנהל לידים, שיחות ו-AI במקום אחד.',

  /**
   * The CTA names the action it actually performs. "המשך במחשב" would be a
   * label with no behaviour behind it on a phone — precisely the vague button
   * ux-guidelines.md §3 forbids. The only real action available here is getting
   * this link onto the other device.
   */
  copyLabel: 'העתק קישור לכניסה מהמחשב',
  copiedLabel: 'הקישור הועתק',
  copyFailedLabel: 'לא הצלחנו להעתיק. אפשר לסמן את הכתובת ולהעתיק ידנית.',

  /** Native share sheet. Rendered only where navigator.share exists. */
  shareLabel: 'שיתוף הקישור',
  shareTitle: 'SocialCRM',
  shareText: 'הכניסה למערכת SocialCRM',

  /** A quiet statement of fact, not a marketing banner (care-charter.md §10). */
  soonLabel: 'אפליקציה לנייד — בפיתוח',
} as const
