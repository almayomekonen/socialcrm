/**
 * The next step for each error Meta documents for WhatsApp Embedded Signup.
 *
 * Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/errors
 * Each step follows Meta's own "Suggested Solution" for that error.
 *
 * Copy lives beside `messages.ts` the way `metaFeatureNotices.ts` does: this is
 * approved connection wording, not logic. Meta's `error_id` is a per-report
 * support id rather than an error type, so the documented English text is the
 * only key. A localised or new message matches nothing and the caller keeps the
 * general `meta_error` next step.
 *
 * ORDER MATTERS: specific entries come first, because several documented texts
 * also contain "try again later".
 */

const STEPS: { match: string[]; step: string }[] = [
  {
    match: ['guessed too many times', 'requested your code too many times', 'register this number too many times'],
    step: 'Meta הגבילה זמנית את ניסיונות האימות למספר הזה. להמתין כ-12 שעות, או את הזמן ש-Meta ציינה, ולנסות שוב עם אותו מספר.',
  },
  {
    match: ['too new to create a business account'],
    step: 'חשבון הפייסבוק חדש מדי ליצירת חשבון עסקי. להמתין כמה שעות, או להתחבר עם חשבון פייסבוק ותיק ופעיל.',
  },
  {
    match: ['limits on how often you can post', 'no longer allowed to use facebook products', 'payment account is disabled'],
    step: 'Meta הגבילה את חשבון הפייסבוק הזה. להתחבר עם חשבון פייסבוק פעיל אחר, שאין עליו הגבלות.',
  },
  {
    match: ['reached the limit for the number of businesses', 'can only create one business user'],
    step: 'בחלון של Meta לבחור תיק עסקי קיים במקום ליצור חדש, ולנסות שוב.',
  },
  {
    match: ["name you chose for your business isn't valid", 'verified name violates'],
    step: 'לבחור שם שתואם לשם העסק בפועל ועומד בהנחיות של WhatsApp, ולנסות שוב.',
  },
  {
    match: ['name verification already in progress'],
    step: 'אימות שם העסק עדיין בבדיקה ב-Meta. לנסות שוב אחרי שהבדיקה תסתיים.',
  },
  {
    match: ['does not have permission to create whatsapp business accounts'],
    step: 'אין לך הרשאת מנהל בתיק העסקי שנבחר. לבקש הרשאת מנהל, או לבחור תיק עסקי שבו יש לך הרשאה כזו.',
  },
  {
    match: ['limited number whatsapp business accounts'],
    step: 'בחלון של Meta לבחור חשבון WhatsApp עסקי קיים. חשבון נוסף אפשר לפתוח רק אחרי אימות העסק ב-Meta.',
  },
  {
    match: ["that you selected can't be verified"],
    step: 'בחלון של Meta לבחור תיק עסקי אחר, או לבדוק את מצב אימות העסק ב-Meta Business Suite.',
  },
  {
    match: ['phone number has been blocked'],
    step: 'המספר חסום ב-WhatsApp. את הסיבה ואת דרכי הטיפול אפשר לראות ב-WhatsApp Manager.',
  },
  {
    match: ['maximum number of phone numbers'],
    step: 'לתיק העסקי הגיעה מכסת המספרים. להסיר ב-WhatsApp Manager מספר שאינו בשימוש, ולנסות שוב.',
  },
  {
    match: ['already exists in your list of phone numbers'],
    step: 'המספר כבר קיים בחשבון. להתחיל את החיבור מחדש ולבחור אותו מהרשימה.',
  },
  {
    match: ['registered to an existing whatsapp account'],
    step: 'המספר פעיל בחשבון וואטסאפ אחר. אם זה המספר של אפליקציית WhatsApp Business, לבחור בחלון של Meta בחיבור האפליקציה הקיימת. אחרת, לנתק אותו מהחשבון הקיים ולנסות שוב אחרי כ-3 דקות.',
  },
  {
    match: ["doesn't appear to be valid"],
    step: 'לבדוק שהמספר נכון ופעיל ושאינו מספר מענה קולי אוטומטי, ולנסות שוב בעוד 5 דקות.',
  },
  {
    match: ['something has gone wrong', 'error occurred while processing', 'error verifying this phone number', 'try again later'],
    step: 'זו תקלה זמנית אצל Meta. לנסות שוב בעוד כמה דקות.',
  },
]

/** Lower-case with straight apostrophes, so Meta's typography does not break a match. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[‘’ʼ]/g, "'")
}

/** Our next step for a documented Meta error, or null when the text is not one. */
export function metaSignupErrorNextStep(message: string): string | null {
  const text = normalise(message)
  if (!text) return null
  return STEPS.find((entry) => entry.match.some((m) => text.includes(m)))?.step ?? null
}
