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
      'לא. אינסטגרם לא מאפשר למערכות חיצוניות לקרוא את תוכן ההודעות, ולכן פנייה בהודעה ישירה מוסיפים ידנית בעשר שניות: שם, טלפון ומקור אינסטגרם. לידים ממודעות אינסטגרם, לעומת זאת, נכנסים אוטומטית.',
  },
  {
    id: 'faq-3',
    question: 'איך עובד החיבור לוואטסאפ?',
    answer:
      'מחברים את הוואטסאפ העסקי, והשיחות נכנסות למערכת ומתחברות לליד עם מקור, סטטוס ובעלים. עונים ישירות מהמערכת, ורואים מתי ההודעה נמסרה ומתי נקראה. לפנייה חוזרת אפשר לשלוח תבנית מאושרת.',
  },
  {
    id: 'faq-4',
    question: 'מה ה-AI במערכת עושה בפועל?',
    answer:
      'על כל ליד יש תקציר קצר, שתי נקודות מפתח ופעולה מומלצת עם הסיבה שלה, מבוססים על ההיסטוריה שנשמרה על הליד. אפשר לבקש טיוטה להודעת מעקב, לשאול מה הצעד הבא או לשאול שאלה על הליד. ה-AI לא שולח הודעות בעצמו. שכבת ה-AI נפתחת בתוכנית Pro.',
  },
  {
    id: 'faq-5',
    question: 'כמה זה עולה?',
    answer:
      'המערכת חינמית עד 50 לידים, ללא כרטיס אשראי. תוכנית Pro מסירה את מגבלת הלידים ופותחת את שכבת ה-AI, במחיר אחד לכל סביבת העבודה — בלי תוספת לכל נציג.',
  },
];
