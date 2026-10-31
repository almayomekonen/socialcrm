/**
 * The `/activate` screens (Phase F4): the desktop activation (Facebook Page
 * connection — chrome only, the flow is untouched), the "workspace ready"
 * screen, the phone handoff. Hebrew copied verbatim from
 * `components/activation/**`, `lib/activation/activationCopy.ts` and
 * `lib/activation/mobileHandoffCopy.ts` (those modules stay the Hebrew source;
 * `lib/activation/localizedCopy.ts` words them outside Hebrew). The copy-link
 * labels reuse `mobileShell.desktopOnly.copy.*`.
 */
export const activation = {
  dialog: 'הפעלת SocialCRM',
  video: 'סרטון הסבר על SocialCRM',
  ready: {
    heading: 'סביבת העבודה שלך מוכנה 🎉',
    connected: 'חשבון ה-Meta שלך חובר בהצלחה.',
    moving: 'אנחנו מעבירים אותך למערכת...',
  },
  step: 'שלב 2 מתוך 2',
  done: 'הושלם',
  waiting: { heading: 'עם סיום השלב הזה, כל ליד חדש יגיע לכאן אוטומטית.' },
  start: 'התחל לקבל לידים',
  connecting: 'מתחבר…',
  linking: 'מחבר…',
  trust: { secure: 'חיבור מאובטח דרך Meta', ownLeads: 'הגישה ללידים שלך בלבד', yourData: 'המידע שלך נשאר שלך' },
  finishing: 'מסיים את החיבור…',
  select: { heading: 'איזה דף לחבר?' },
  subscribing: 'מחבר את מקור הלידים שלך…',
  completed: {
    heading: 'סביבת העבודה שלך מוכנה.',
    body: 'מעכשיו, כל ליד חדש יגיע לכאן אוטומטית.',
    instruction: 'המשך במחשב לחוויה המלאה.',
    secondary: 'כבר ליד המחשב? היכנס ל-getsocialcrm.com',
  },
  failed: { heading: 'החיבור לא הושלם.', body: 'אפשר לנסות שוב כדי לקבל לידים אוטומטית.' },
  retry: 'נסה שוב',
}

export const handoff = {
  heading: 'SocialCRM עובד במיטבו במחשב.',
  body: 'המערכת מותאמת למסך גדול, כדי לנהל לידים, שיחות ו-AI במקום אחד.',
  share: 'שיתוף הקישור',
  shareText: 'הכניסה למערכת SocialCRM',
  soon: 'אפליקציה לנייד — בפיתוח',
  support: 'צריך עזרה? דברו איתנו',
}
