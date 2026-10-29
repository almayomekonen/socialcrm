/**
 * The shared expired-subscription state (`SubscriptionExpiredState`), its own
 * chrome only. Hebrew copied verbatim. A caller's `feature` line is the
 * caller's text, never a key here.
 */
export const entitlement = {
  title: 'המנוי שלך הסתיים',
  bodyNeverStarted: 'הפעלת המנוי פותחת את היכולות המתקדמות. כל הלידים והשיחות שלכם שמורים ונשארים זמינים.',
  bodyLapsed: 'כל הלידים, השיחות וההיסטוריה שלכם שמורים ונשארים זמינים. חידוש המנוי מחזיר את היכולות המתקדמות מיד.',
  lapsedOn: 'תוקף המנוי הסתיים בתאריך {date}',
  renew: 'חידוש מנוי',
} as const
