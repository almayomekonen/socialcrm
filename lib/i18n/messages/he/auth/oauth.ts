/**
 * The MCP OAuth consent screen (`/oauth/consent`, Phase F4) — chrome only; the
 * authorization, eligibility and decision logic are untouched. Hebrew copied
 * verbatim from `components/oauth/*`, `app/oauth/consent/page.tsx`,
 * `SCOPE_LABELS_HE` and `CONSENT_EXPIRED` (pinned in preLoginCopyPin.test.ts).
 * `{client}` is the validated client name from the signed pending request.
 */
export const oauth = {
  title: 'חיבור אפליקציה ל-SocialCRM',
  heading: 'חיבור {client} ל-SocialCRM',
  signedInAs: 'מחובר בתור',
  can: '{client} יוכל:',
  scope: {
    leads: 'צפייה בלידים שלך, במעקבים ובסיכום היומי',
    conversations: 'צפייה בסיכומי שיחות WhatsApp עם הלידים שלך, ובהודעות עצמן לפי בקשה',
  },
  notGranted: '{client} לא יקבל מספרי טלפון או כתובות אימייל, לא יוכל לשנות נתונים ולא ישלח הודעות WhatsApp.',
  connecting: 'מחבר את {client}…',
  cancelling: 'מבטל…',
  approve: 'אשר חיבור ל-{client}',
  back: 'חזרה ל-SocialCRM',
  billing: 'לניהול המנוי',
  message: {
    unavailable: 'לא ניתן לחבר את {client} לחשבון הזה כרגע.',
    needsAccess: 'כדי לחבר את {client} צריך מנוי פעיל או תקופת ניסיון פעילה.',
    notAllowlisted: 'החיבור ל-{client} עדיין לא זמין בחשבון שלך.',
    expired: 'בקשת החיבור פגה או כבר טופלה. חזור לאפליקציה שממנה התחלת ונסה שוב.',
  },
}

/** Root-layout chrome shown on every route (signed in or not). */
export const root = {
  chunkReloading: 'עדכון חדש נטען, מרענן...',
}
