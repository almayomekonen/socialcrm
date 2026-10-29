/**
 * Banners above the leads table and the lead-quota paywall. Hebrew copied
 * verbatim (Phase C). Intake copy is keyed by the ingest REJECTION code.
 */
export const banners = {
  metaDisconnected: 'חשבון ה‑Meta מנותק. לידים חדשים לא ייכנסו עד שתחבר אותו מחדש.',
  reconnect: 'חבר מחדש',
  overQuota: { other: 'יש לך {count} לידים חדשים שמחכים שדרג כדי לראות אותם' },
  upgradeNow: 'שדרג עכשיו',
  syncProblem: 'בעיית חיבור. מנסים שוב',
  retry: 'נסה שוב',
} as const

/** `lib/automations/connectors/intakeErrors.ts`, by `IngestRejection` code. */
export const intake = {
  invalid_signature: {
    title: 'יש בעיה בחיבור לטופס באתר',
    explanation: 'התקבל ניסיון לשלוח ליד מהטופס באתר שלך, אבל החיבור לא אומת ולכן הליד לא נכנס למערכת.',
    short: 'פניות מהטופס מגיעות אבל לא נכנסות למערכת.',
  },
  unreadable_payload: {
    title: 'יש בעיה בחיבור לטופס באתר',
    explanation: 'התקבלה פנייה מהטופס באתר שלך במבנה שלא הצלחנו לקרוא, ולכן הליד לא נכנס למערכת.',
    short: 'פניות מהטופס מגיעות במבנה שאינו נקרא.',
  },
} as const

export const quota = {
  title: 'מכסת הלידים',
  bulk: 'הקובץ מכיל {attempted} לידים, נותרו רק {remaining} במכסה החינמית.',
  single: 'כבר ניהלת {limit} לידים כאן.',
  bulkHint: 'שדרג לייבא את כולם ולהמשיך ללא הגבלה.',
  singleHint: 'אל תעצור עכשיו המשך ללא הגבלה.',
  plan: 'Pro · ₪{price} לחודש',
  unlimited: 'לידים ללא הגבלה',
  later: 'מאוחר יותר',
} as const
