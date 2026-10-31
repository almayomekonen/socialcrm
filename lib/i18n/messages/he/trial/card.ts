/**
 * The card return page (`/billing/success`, `CardSetupVerifier`) and the card
 * holder refusals (i18n Phase F5) — display only; polling, the verification
 * flow and every redirect are unchanged. Hebrew copied verbatim from
 * `components/billing/CardSetupVerifier.tsx`, `app/billing/success/page.tsx`
 * and `lib/payments/cardTrial/cardHolder.ts` (pinned in trialCopyPin.test.ts).
 * `{amount}` is `CARD_TRIAL_AMOUNT` (₪), `{date}` the numeric billing date.
 */
export const verifier = {
  pageTitle: 'הכרטיס נשמר',
  headline: {
    card_trial: 'תקופת הניסיון הופעלה',
    card_update: 'הכרטיס עודכן',
    reactivate: 'המנוי חודש',
  },
  sandbox: 'בדיקת סליקה בסביבת Sandbox — לא בוצעה עסקה אמיתית ולא נשמר כרטיס אמיתי.',
  chargeOn: 'הכרטיס נשמר. החיוב הראשון, ₪{amount}, יתבצע ב־{date}. אפשר לבטל לפני כן בעמוד המנוי.',
  chargeOff: 'הכרטיס נשמר. תקופת הניסיון מסתיימת ב־{date}; חיוב אוטומטי אינו פעיל כרגע, ולכן לא ייגבה תשלום במועד הזה.',
  saved: 'הפרטים נשמרו. אפשר להמשיך לעבוד.',
  enter: 'כניסה למערכת',
  failedTitle: 'לא הצלחנו לאמת את הכרטיס',
  failedBody: 'לא בוצע חיוב. אפשר לנסות שוב עם אותו כרטיס או עם כרטיס אחר.',
  toBilling: 'לעמוד המנוי',
  timedOutTitle: 'האישור עדיין בבדיקה',
  timedOutCallback: 'קיבלנו את פרטי הכרטיס ואנחנו מאמתים אותם מול Grow. עדיין לא בוצע חיוב.',
  timedOutNoCallback: 'טרם קיבלנו אישור מחברת הסליקה. עדיין לא בוצע חיוב.',
  timedOutNote: 'אין צורך להמתין כאן — נעדכן במייל ברגע שהאימות יסתיים, והסטטוס מופיע תמיד בעמוד המנוי.',
  back: 'חזרה למערכת',
  verifyingTitle: 'רק רגע, מאמתים מול חברת הסליקה',
  verifyingBody:
    'הכרטיס נשמר בצד של Grow ואנחנו מאשרים אותו. לא מבוצע חיוב עבור המנוי בשלב הזה; תיתכן הקפאה זמנית של ₪1 לאימות; לפי Grow היא משתחררת בתוך עד 10 ימים.',
}

/** `validateCardHolder`'s two refusals, by field (the action returns the Hebrew sentence with its field). */
export const holder = {
  fullName: 'יש להזין שם פרטי ושם משפחה, באותיות בלבד',
  phone: 'יש להזין מספר נייד ישראלי תקין, לדוגמה 0501234567',
}
