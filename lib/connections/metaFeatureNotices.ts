import type { ConnectionNotice } from '@/lib/connections/messages'

/**
 * Facebook notices for the per-feature Meta permissions (comment replies,
 * Messenger) and the expired Page selection. Spread into FACEBOOK_NOTICES in
 * messages.ts, so every existing `facebookNotice(code)` caller resolves them;
 * kept in their own file because messages.ts is past the size limit
 * (architecture-rules §1). Same shape, tone and approval rules as messages.ts.
 */
export const META_FEATURE_NOTICES: Record<string, ConnectionNotice> = {
  // Replying to comments from SocialCRM needs `pages_manage_engagement`, which
  // is requested only when the user asks for this feature. 'attention', not
  // 'error': comments keep arriving; only replying from here is unavailable.
  comment_replies_permission: {
    tone: 'attention',
    title: 'כדי להשיב לתגובות מכאן צריך לאשר הרשאה',
    explanation:
      'התגובות ממשיכות להגיע כרגיל. כדי לפרסם תשובה בשם הדף ישירות מ-SocialCRM, פייסבוק דורש אישור לניהול תגובות בדף.',
    nextStep: 'לאשר את ההרשאה במסך של פייסבוק. החיבור והלידים הקיימים לא ייפגעו.',
    action: 'אשר הרשאה להשבה לתגובות',
  },
  comment_replies_declined: {
    tone: 'attention',
    title: 'ההרשאה להשבה לתגובות לא אושרה',
    explanation: 'במסך האישור של פייסבוק ההרשאה לניהול תגובות לא סומנה, ולכן אי אפשר לפרסם תשובה מכאן.',
    reasons: ['ההרשאה לא סומנה במסך האישור של Facebook'],
    nextStep: 'אפשר לנסות שוב ולסמן את ההרשאה. בינתיים אפשר להשיב ישירות בפייסבוק.',
    action: 'לנסות שוב',
  },
  // Messenger needs `pages_messaging`, requested only when the user opens Messenger.
  messenger_permission: {
    tone: 'attention',
    title: 'כדי לקבל ולשלוח הודעות Messenger צריך לאשר הרשאה',
    explanation:
      'הדף מחובר והלידים ממשיכים להגיע כרגיל. כדי שהודעות Messenger מהדף יופיעו כאן ושתוכל להשיב להן, פייסבוק דורש אישור לניהול הודעות הדף.',
    nextStep: 'לאשר את ההרשאה במסך של פייסבוק. החיבור והלידים הקיימים לא ייפגעו.',
    action: 'אשר הרשאה ל-Messenger',
  },
  // The grant is recorded, but Meta is not sending this Page's messages to
  // SocialCRM (not subscribed to Messenger events, and re-subscribing failed).
  // Reconnecting refreshes the token and re-subscribes the Page. Says nothing
  // about leads: this state is also reached when leadgen could not be restored.
  messenger_not_subscribed: {
    tone: 'attention',
    title: 'הודעות Messenger עדיין לא מגיעות לכאן',
    explanation: 'פייסבוק עדיין לא שולחת ל-SocialCRM את הודעות ה-Messenger של הדף, ולכן הודעות חדשות לא יופיעו כאן.',
    nextStep: 'לחבר מחדש את הדף בפייסבוק. החיבור והלידים הקיימים לא ייפגעו.',
    action: 'חבר מחדש את הדף ל-Messenger',
  },
  messenger_declined: {
    tone: 'attention',
    title: 'ההרשאה ל-Messenger לא אושרה',
    explanation: 'במסך האישור של פייסבוק ההרשאה לניהול הודעות לא סומנה, ולכן הודעות Messenger לא יגיעו לכאן.',
    reasons: ['ההרשאה לא סומנה במסך האישור של Facebook'],
    nextStep: 'אפשר לנסות שוב ולסמן את ההרשאה.',
    action: 'לנסות שוב',
  },
  // The Page list from the Facebook approval screen is kept for 10 minutes,
  // server-side only. After that the selection cannot be completed safely.
  selection_expired: {
    tone: 'attention',
    title: 'בחירת הדף פגה',
    explanation: 'רשימת הדפים שהתקבלה מפייסבוק נשמרת לזמן קצר בלבד, והזמן עבר. לא נשמר שינוי.',
    reasons: ['עברו יותר מ-10 דקות מאישור פייסבוק'],
    nextStep: 'להתחבר שוב לפייסבוק ולבחור את הדף.',
    action: 'להתחבר שוב',
  },
}
