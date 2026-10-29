/**
 * The Facebook notices of `lib/connections/{messages,metaFeatureNotices}.ts`
 * (`FACEBOOK_NOTICES`) that `/inbox/messenger` and `/inbox/comments` can show,
 * plus the permission prompt's own lines and the in-app-browser warning of
 * its button. Settings keeps reading the constants; a test pins both copies to
 * the same Hebrew. Keys are the notice codes.
 */
export const metaNotice = {
  prompt: {
    authorize: 'אשר הרשאה',
    adminOnly: 'מנהל החשבון צריך לאשר את ההרשאה בפייסבוק.',
    redirecting: 'מעביר לפייסבוק...',
  },
  messenger_permission: {
    title: 'כדי לקבל ולשלוח הודעות Messenger צריך לאשר הרשאה',
    explanation:
      'הדף מחובר והלידים ממשיכים להגיע כרגיל. כדי שהודעות Messenger מהדף יופיעו כאן ושתוכל להשיב להן, פייסבוק דורש אישור לניהול הודעות הדף.',
    nextStep: 'לאשר את ההרשאה במסך של פייסבוק. החיבור והלידים הקיימים לא ייפגעו.',
    action: 'אשר הרשאה ל-Messenger',
  },
  messenger_declined: {
    title: 'ההרשאה ל-Messenger לא אושרה',
    explanation: 'במסך האישור של פייסבוק ההרשאה לניהול הודעות לא סומנה, ולכן הודעות Messenger לא יגיעו לכאן.',
    reason1: 'ההרשאה לא סומנה במסך האישור של Facebook',
    nextStep: 'אפשר לנסות שוב ולסמן את ההרשאה.',
    action: 'לנסות שוב',
  },
  messenger_not_subscribed: {
    title: 'הודעות Messenger עדיין לא מגיעות לכאן',
    explanation: 'פייסבוק עדיין לא שולחת ל-SocialCRM את הודעות ה-Messenger של הדף, ולכן הודעות חדשות לא יופיעו כאן.',
    nextStep: 'לחבר מחדש את הדף בפייסבוק. החיבור והלידים הקיימים לא ייפגעו.',
    action: 'חבר מחדש את הדף ל-Messenger',
  },
  expired: {
    title: 'החיבור לפייסבוק פג',
    explanation: 'לידים חדשים אינם נכנסים כרגע. כל המידע הקיים במערכת נשמר במלואו.',
    reason1: 'חלפו כ-60 יום מהחיבור',
    reason2: 'הסיסמה בפייסבוק שונתה',
    nextStep: 'חידוש החיבור אורך פחות מדקה ואינו משפיע על נתונים קיימים.',
    action: 'לחבר מחדש',
  },
  comment_replies_permission: {
    title: 'כדי להשיב לתגובות מכאן צריך לאשר הרשאה',
    explanation:
      'התגובות ממשיכות להגיע כרגיל. כדי לפרסם תשובה בשם הדף ישירות מ-SocialCRM, פייסבוק דורש אישור לניהול תגובות בדף.',
    nextStep: 'לאשר את ההרשאה במסך של פייסבוק. החיבור והלידים הקיימים לא ייפגעו.',
    action: 'אשר הרשאה להשבה לתגובות',
  },
  comment_replies_declined: {
    title: 'ההרשאה להשבה לתגובות לא אושרה',
    explanation: 'במסך האישור של פייסבוק ההרשאה לניהול תגובות לא סומנה, ולכן אי אפשר לפרסם תשובה מכאן.',
    reason1: 'ההרשאה לא סומנה במסך האישור של Facebook',
    nextStep: 'אפשר לנסות שוב ולסמן את ההרשאה. בינתיים אפשר להשיב ישירות בפייסבוק.',
    action: 'לנסות שוב',
  },
  in_app_browser: {
    title: 'כדאי לפתוח את האתר בדפדפן',
    explanation: 'בתוך אינסטגרם, חלון ההתחברות של Meta לא תמיד נפתח או חוזר למערכת.',
    nextStep: 'לפתוח את getsocialcrm.com ב-Safari או ב-Chrome, להתחבר ולנסות שוב.',
    action: 'לנסות בכל זאת',
  },
}
