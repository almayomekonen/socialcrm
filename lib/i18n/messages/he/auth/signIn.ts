/**
 * Sign-in and registration (Phase F4): `/auth`, `/auth/register`, the magic-link
 * form, the social buttons, the registration form. Hebrew copied byte-for-byte
 * from `app/(auth)/**`, `components/auth/*` and `components/agencies/AddAgencyForm.tsx`.
 * `server.*` are the EXACT sentences `actions/auth.ts` / `actions/agencies.ts`
 * return (they carry no code); the forms word them by exact match
 * (`lib/auth/authMessages.ts`), anything else is shown as received.
 */
export const signIn = {
  title: 'התחברות | SocialCRM — מערכת ניהול לידים',
  heading: 'ברוך שובך',
  subtitle: 'ברוך שובך, הזן את הפרטים שלך כדי להמשיך',
  worksWith: 'עובד עם וואטסאפ, אינסטגרם ופייסבוק',
  noAccount: 'אין לך חשבון?',
  join: 'הצטרף עכשיו',
  imageAlt: 'ניהול לידים לעסקים קטנים',
}

export const magic = {
  email: 'אימייל',
  remember: 'זכור אותי',
  resend: 'שלח קישור שוב',
  submit: 'התחל בחינם',
  submitting: 'טוען...',
  sent: 'לינק לאימות נשלח למייל',
  linkInvalid: 'הקישור אינו תקין או שפג תוקפו',
  network: 'אירעה שגיאה ברשת, נסה שוב',
}

/** The slow / timed-out toasts every form shows while a request is in flight. */
export const wait = {
  slow: 'הפעולה לוקחת יותר זמן מהרגיל...',
  timeout: 'לוקח זמן רב מהרגיל, נסה שוב',
}

export const social = {
  signedInAs: 'כניסה בשם {name}',
  google: 'כניסה באמצעות Google',
  facebook: 'כניסה באמצעות Facebook',
  failed: 'ההתחברות נכשלה, נסה שוב',
}

export const register = {
  title: 'הרשמה',
  heading: 'ברוך הבא',
  subtitle: 'הצטרף עכשיו והתחל לנהל את הלידים שלך בכמה צעדים',
  businessName: 'שם העסק',
  firstName: 'שם פרטי',
  lastName: 'שם משפחה',
  terms: 'אני מסכים לתנאי השימוש',
  termsLink: 'תנאי השימוש',
  submit: 'צור חשבון',
  haveAccount: 'כבר יש לך חשבון?',
  signIn: 'התחבר',
}

export const server = {
  suspended: 'המשתמש מושהה',
  facebookNoEmail: 'פייסבוק לא החזיר אימייל. אפשר להתחבר עם גוגל או עם מייל.',
  facebookTaken: 'חשבון פייסבוק זה כבר מחובר למערכת. התחבר באמצעות Facebook.',
  facebookUnavailable: 'התחברות עם Facebook אינה זמינה לחשבון זה',
  sendFailed: 'שליחת קישור ההתחברות נכשלה. נסה שוב בעוד רגע.',
  emailInvalid: 'כתובת האימייל לא תקינה. בדקו שהיא כתובה במלואה, למשל name@gmail.com',
  emailTaken: 'כתובת האימייל הזו כבר רשומה במערכת',
  generic: 'אירעה שגיאה, נסה שוב',
}
