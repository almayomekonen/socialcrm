/**
 * The trial gate the (app) layout renders (i18n Phase F5): the welcome modal,
 * the expired paywall and its lead toasts, the Pro activation celebration —
 * chrome only. Hebrew copied verbatim from `components/trial/*` (pinned in
 * trialCopyPin.test.ts). Prices stay ₪ (`PRICING`); the recorded consents and
 * disclosure lines (`lib/payments/cardTrial/terms.ts`) never pass here.
 */
export const welcome = {
  title: {
    setup: 'מתחילים עם 7 ימי ניסיון',
    awaiting: 'הכרטיס נשמר, ואנחנו מאמתים אותו',
    unavailable: 'לא ניתן להתחיל כרגע',
    later: 'תקופת הניסיון תיפתח כאן בקרוב',
    start: 'מתחילים עם SocialCRM Pro',
  },
  sub: {
    setup: 'תקופת הניסיון מתחילה רק לאחר אימות הכרטיס. היום לא יבוצע חיוב.',
    awaiting: 'תקופת הניסיון תתחיל מיד לאחר האימות, ולא בוצע חיוב.',
    unavailable: 'מערכת התשלומים אינה זמינה זמנית, ולכן תקופת הניסיון עדיין לא נפתחה. לא בוצע חיוב.',
    later: 'אנחנו משלימים את חיבור התשלומים. החשבון שלכם שמור, לא בוצע חיוב, ואין צורך בשום פעולה.',
    start: 'הצעד הבא: להכניס את הלידים שלכם למערכת.',
  },
  tail: {
    awaiting: 'האימות נמשך בדרך כלל מספר שניות. אפשר לרענן את העמוד.',
    unavailable: 'אפשר לנסות שוב מאוחר יותר, או לפנות אלינו ונטפל בזה.',
    later: 'נעדכן אתכם ברגע שאפשר יהיה להתחיל.',
  },
  submitCard: 'הוספת כרטיס והפעלת הניסיון',
  adminOnly: 'רק מנהל החשבון יכול להפעיל את תקופת הניסיון.',
  start: 'הפעל את ה-Pro שלי',
  starting: 'רק רגע...',
  startNote: '7 ימים ללא עלות · ללא כרטיס אשראי · אפשר לבטל בכל עת',
  error: 'אירעה שגיאה, נסה שוב',
  networkError: 'אירעה שגיאה ברשת, נסה שוב',
}

export const expired = {
  title: 'המערכת שלך מחכה לך',
  titleLeads: 'הלידים שלך מחכים',
  body: 'הלידים והנתונים שלך נשמרו בדיוק כפי שהשארת אותם. כדי להמשיך לעבוד יש לשדרג.',
  reactivation: {
    declined: 'לא הצלחנו לחייב את הכרטיס ששמרת. הלידים והנתונים שלך נשמרו בדיוק כפי שהשארת אותם. כדי להמשיך, יש לאשר אמצעי תשלום.',
    cancelled: 'ביטלת את המשך המנוי. הלידים והנתונים שלך נשמרו בדיוק כפי שהשארת אותם, ואפשר להמשיך בכל רגע.',
    ended: 'הלידים והנתונים שלך נשמרו בדיוק כפי שהשארת אותם. כדי להמשיך, יש לאשר אמצעי תשלום.',
  },
  /** `{count}` is bolded where it appears in the sentence. */
  waiting: { other: '{count} לידים ממתינים לחזרה שלך' },
  perMonth: '/חודש',
  benefits: {
    ai: 'AI ללא הגבלה במצב מהיר ובמצב חכם',
    history: 'היסטוריית AI מלאה לכל ליד',
    drafting: 'ניסוח הודעות, המלצות וצעדים הבאים',
  },
  updateCard: 'עדכון אמצעי תשלום והמשך',
  upgrade: 'שדרג עכשיו',
  note: 'ללא התחייבות · ניתן לבטל בכל רגע · כל הנתונים שלך שמורים',
  /** A lead toast for a lead with no name. */
  leadFallback: 'ליד',
}

export const celebration = {
  title: 'ה־Pro שלך פעיל',
  sub: 'כל היכולות של SocialCRM Pro פתוחות עבורך ל־7 הימים הקרובים.',
  benefits: {
    ai: 'AI מתקדם',
    leads: 'כל הלידים והשיחות',
    tools: 'כל כלי העבודה והאינטגרציות',
  },
  cta: 'התחל לעבוד עם Pro',
}
