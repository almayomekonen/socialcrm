import { TRIAL_OFFER_FAQ_ANSWER } from '@/lib/pricing';

/**
 * The FAQ entries, in a plain module.
 *
 * `faq-section.tsx` is a Client Component, so a named export from it reaches a
 * Server Component as a client-reference proxy rather than the array itself —
 * `/faq` crashed building its FAQPage schema from it. Keeping the data here
 * lets the section render it and the page emit structured data from the SAME
 * source, with no second copy to drift.
 */
export const FAQ_ITEMS = [
  {
    id: 'faq-1',
    question: 'איך הלידים מפייסבוק ומאינסטגרם נכנסים למערכת?',
    answer:
      'מחברים את הדף העסקי בפייסבוק, וכל ליד שממלא טופס Lead Ad נכנס למערכת אוטומטית תוך שניות, עם מקור וסטטוס. לידים ממודעות אינסטגרם מגיעים באותה דרך.',
  },
  {
    id: 'faq-2',
    question: 'האם פניות בהודעה ישירה באינסטגרם נכנסות אוטומטית?',
    answer:
      'לא. אינסטגרם לא מאפשר למערכות חיצוניות לקרוא את תוכן ההודעות, ולכן פנייה מהודעה ישירה מוסיפים ידנית בתוך כעשר שניות: שם, טלפון ומקור אינסטגרם. לידים ממודעות אינסטגרם, לעומת זאת, נכנסים אוטומטית.',
  },
  {
    id: 'faq-3',
    question: 'איך עובד החיבור לוואטסאפ?',
    answer:
      'מחברים את הוואטסאפ העסקי, והשיחות נכנסות למערכת ומתחברות לליד עם מקור, סטטוס ונציג. עונים ישירות מהמערכת, ורואים מתי ההודעה נמסרה ומתי נקראה. לפנייה חוזרת אפשר לשלוח תבנית מאושרת.',
  },
  {
    id: 'faq-4',
    question: 'מה ה-AI במערכת עושה בפועל?',
    answer:
      'על כל ליד יש תקציר קצר, שתי נקודות מפתח ופעולה מומלצת עם הסיבה שלה, על סמך ההיסטוריה שנשמרה על הליד. אפשר לבקש טיוטה להודעת מעקב, לשאול מה הצעד הבא או לשאול כל שאלה על הליד. הטיוטות לא נשלחות מעצמן: הודעה יוצאת רק כשלוחצים על שליחה. המענה האוטומטי בוואטסאפ הוא תכונה נפרדת. שכבת ה-AI זמינה בתוכנית Pro.',
  },
  {
    id: 'faq-5',
    question: 'כמה זה עולה?',
    answer:
      TRIAL_OFFER_FAQ_ANSWER,
  },
];

/**
 * `/faq` only: the homepage questions plus the operational ones a buyer asks
 * before signing up. Each answer describes behaviour every account has today
 * (no feature behind an agency allowlist), traced to:
 *   import        actions/clients.ts (importClients), lib/leads/importMapping.ts
 *   export        lib/table/export, components/clients/clientsTable.tsx
 *   statuses      lib/i18n/messages/he/leads/table.ts
 *   today list    lib/leads/dueWorklist.ts (SLA 2h / 24h / 72h), lib/product/capabilities.ts
 *   visibility    db/filter.ts, db/clients.ts, types/roles.ts, actions/invitations.ts
 *   24h window    actions/whatsapp/sendWhatsappReply.ts
 *   auto-reply    lib/inbox/autoresponse/eligibility.ts, responseMethod.ts
 *   lead fields   app/api/webhooks/facebook/route.ts
 *   calendar      actions/calendar/create.ts, lib/integrations/google/calendarClient.ts
 *   login         components/auth/Login.tsx, LoginMagicLink.tsx
 *   deletion      app/(he)/(marketing)/data-deletion/page.tsx
 */
export const FAQ_PAGE_ITEMS = [
  ...FAQ_ITEMS,
  {
    id: 'faq-6',
    question: 'איזה קובץ אפשר לייבא, ומה הוא צריך לכלול?',
    answer:
      'קובץ Excel או CSV (xlsx, xls או csv). המערכת קוראת את הגיליון הראשון ומזהה כותרות נפוצות בעברית ובאנגלית, כמו "שם", "טלפון", "נייד" ו"מייל". לכל ליד צריך שם וטלפון, ועמודות שהמערכת לא מכירה פשוט לא נקראות.',
  },
  {
    id: 'faq-7',
    question: 'מה קורה לליד שכבר קיים במערכת כשמייבאים קובץ?',
    answer:
      'הוא לא נוצר פעמיים. ליד עם מספר טלפון שכבר קיים בסביבת העבודה מדולג, וגם שורות כפולות בתוך אותו קובץ נספרות פעם אחת. כל ליד חדש מהקובץ נכנס בסטטוס "חדש".',
  },
  {
    id: 'faq-8',
    question: 'אפשר להוציא את הלידים מהמערכת?',
    answer:
      'כן. מטבלת הלידים מייצאים לאקסל או ל-PDF בכל רגע, כולל הסינון שבחרתם. הנתונים שלכם, ואפשר לקחת אותם איתכם.',
  },
  {
    id: 'faq-9',
    question: 'אילו סטטוסים יש לליד?',
    answer:
      'חמישה: חדש, בטיפול, מעוניין, סגור ואבוד. ליד שנסגר נשאר ליד עם סטטוס "סגור", כך שאין רשימה נפרדת של לקוחות שצריך לתחזק.',
  },
  {
    id: 'faq-10',
    question: 'איך המערכת יודעת למי לחזור היום?',
    answer:
      'אם קבעתם לליד תאריך מעקב, הוא חוזר לרשימת היום כשהתאריך מגיע. אם לא, הוא חוזר לבד אחרי פרק זמן קבוע בסטטוס: ליד חדש אחרי שעתיים, ליד בטיפול אחרי 24 שעות וליד מעוניין אחרי 72 שעות. המערכת מזכירה לכם, היא לא שולחת הודעה ללקוח מעצמה.',
  },
  {
    id: 'faq-11',
    question: 'מי בצוות רואה אילו לידים?',
    answer:
      'נציג רואה את הלידים שמשויכים אליו, מנהל צוות רואה את הלידים של הצוות שלו, ומנהל סביבת העבודה רואה את כולם ומחלק לידים בין הנציגים. נציגים חדשים מצטרפים בהזמנה במייל, עם תפקיד שהמנהל בוחר.',
  },
  {
    id: 'faq-12',
    question: 'אפשר לענות ללקוח בוואטסאפ מתוך המערכת בכל זמן?',
    answer:
      'הודעה חופשית אפשר לשלוח בתוך 24 שעות מההודעה האחרונה של הלקוח. זה כלל של Meta שחל על כל חיבור רשמי לוואטסאפ, לא מגבלה של SocialCRM. כל הודעה שנשלחת נשמרת על הליד, ורואים מתי היא נמסרה ומתי נקראה.',
  },
  {
    id: 'faq-13',
    question: 'יש מענה אוטומטי בוואטסאפ?',
    answer:
      'כן. מגדירים בהגדרות הודעה קבועה שנשלחת אוטומטית לליד שפונה בפעם הראשונה. המענה נשלח פעם אחת בלבד, ולא נשלח אם מישהו מהצוות כבר ענה בעצמו.',
  },
  {
    id: 'faq-14',
    question: 'אילו פרטים נשמרים מטופס לידים בפייסבוק או באינסטגרם?',
    answer:
      'שם, טלפון ומייל, כל התשובות שהליד מילא בטופס, והדף והמודעה שמהם הוא הגיע. כך רואים מאיזה קמפיין הליד הגיע בלי לפתוח את מנהל המודעות.',
  },
  {
    id: 'faq-15',
    question: 'המערכת מתחברת ליומן Google?',
    answer:
      'כן. אחרי שמחברים את יומן Google, פגישה שקובעים עם ליד במערכת נוספת ליומן שלכם, ושינוי או ביטול שלה מתעדכנים גם שם.',
  },
  {
    id: 'faq-16',
    question: 'איך נכנסים למערכת?',
    answer:
      'עם חשבון Google, או עם קישור כניסה חד־פעמי שנשלח למייל. אין סיסמה לזכור.',
  },
  {
    id: 'faq-17',
    question: 'איך מוחקים את הנתונים שלי?',
    answer:
      'שולחים בקשה במייל עם הנושא "בקשת מחיקת נתונים", והיא מטופלת בתוך 7 ימי עסקים. הפרטים המלאים נמצאים בעמוד מחיקת הנתונים.',
  },
];
