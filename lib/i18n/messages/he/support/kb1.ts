/**
 * The support knowledge base, part 1 of 2 (i18n Phase F5): product copy we
 * authored, keyed by article (slug in camelCase). Hebrew copied verbatim from
 * `GUIDE_ARTICLES` (lib/support/knowledgeBase.ts, pinned in supportCopyPin.test.ts).
 * `sN` = the Nth section, `pN` = its Nth paragraph.
 */
export const kb1 = {
  connectWhatsapp: {
    title: 'חיבור WhatsApp למערכת',
    summary: 'איך לחבר מספר WhatsApp עסקי כדי שהודעות מלקוחות ייכנסו לשיחות.',
    s1: {
      heading: 'לפני שמתחילים',
      p1: 'צריך מספר WhatsApp עסקי שאינו מחובר כרגע לאפליקציית WhatsApp Business רגילה.',
      p2: 'החיבור נעשה פעם אחת, ומשם ההודעות נכנסות אוטומטית.',
    },
    s2: {
      heading: 'שלבי החיבור',
      p1: 'נכנסים להגדרות ואז לאינטגרציות.',
      p2: 'לוחצים על חיבור WhatsApp ומשלימים את ההרשמה בחלון שנפתח.',
      p3: 'בסיום מופיע סטטוס "מקבל אירועים" בכרטיס החיבור.',
    },
  },
  whatsappNotReceiving: {
    title: 'הודעות WhatsApp לא נכנסות',
    summary: 'מה לבדוק כשהחיבור קיים אבל הודעות חדשות לא מגיעות לשיחות.',
    s1: {
      heading: 'בדיקה ראשונה',
      p1: 'פותחים הגדרות ואז אינטגרציות ומסתכלים על הסטטוס בכרטיס WhatsApp.',
      p2: 'אם כתוב "החיבור נותק" צריך לחבר מחדש — ההרשאה פגה.',
    },
    s2: {
      heading: 'אם הסטטוס תקין',
      p1: 'שולחים הודעת בדיקה מטלפון אחר ובודקים אם היא מופיעה בשיחות תוך דקה.',
    },
  },
  connectFacebookInstagram: {
    title: 'חיבור Facebook ו-Instagram',
    summary: 'איך לחבר עמוד וטפסי לידים כדי שלידים ייכנסו למערכת אוטומטית.',
    s1: {
      heading: 'מה מתחבר',
      p1: 'החיבור מאפשר לקבל לידים מטפסי הלידים של Facebook ו-Instagram ישירות לרשימת הלידים.',
    },
    s2: {
      heading: 'שלבי החיבור',
      p1: 'נכנסים להגדרות ואז לאינטגרציות ולוחצים על חיבור Facebook.',
      p2: 'מאשרים את ההרשאות ובוחרים את העמוד שממנו מגיעים הלידים.',
    },
  },
  importLeadsExcel: {
    title: 'ייבוא לידים מקובץ Excel',
    summary: 'איך להעלות רשימת לידים קיימת כדי להתחיל לעבוד מיד.',
    s1: {
      heading: 'הכנת הקובץ',
      p1: 'הקובץ צריך לכלול לפחות שם וטלפון בכל שורה.',
      p2: 'עמודות נוספות כמו אימייל ומקור הליד ייובאו אם הן קיימות.',
    },
    s2: {
      heading: 'העלאה',
      p1: 'בעמוד הלידים בוחרים "העלה לידים" ומצרפים את הקובץ.',
    },
  },
  leadStatuses: {
    title: 'סטטוסים של לידים',
    summary: 'מה המשמעות של כל סטטוס ומתי לעדכן אותו.',
    s1: {
      heading: 'למה זה חשוב',
      p1: 'הסטטוס הוא מה שמאפשר לדעת למי צריך לחזור היום ומה כבר טופל.',
    },
    s2: {
      heading: 'מתי לעדכן',
      p1: 'מיד אחרי שיחה או הודעה — עדכון לוקח שניות וחוסך בלבול מאוחר יותר.',
    },
  },
} as const
