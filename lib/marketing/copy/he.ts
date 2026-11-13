import { FAQ_ITEMS } from '@/components/lumen/sections/faqItems'
import { PRICING, TRIAL_CTA_LABEL } from '@/lib/pricing'
import { TRIAL_LENGTH_DAYS } from '@/lib/trial'
import type { HomeCopy } from './types'

/**
 * The live Hebrew copy of the homepage sections, moved out of the components
 * word for word. These sections also render on /pricing, /faq, /channels and the
 * legal pages, so a change here changes those pages too.
 */
export const HE: HomeCopy = {
  nav: {
    dir: 'rtl',
    logoHref: '/',
    product: {
      label: 'המוצר',
      subitems: [
        { label: 'כל הלידים במקום אחד', href: '/#features-carousel', description: 'פייסבוק, אינסטגרם ווואטסאפ נכנסים לרשימה אחת' },
        { label: 'שיחות שמחוברות לליד', href: '/#features-grid', description: 'עונים מהמערכת ורואים מתי ההודעה נמסרה ונקראה' },
        { label: 'AI שמכיר כל ליד', href: '/#features-showcase', description: 'תקציר, נקודות מפתח והצעד הבא' },
      ],
    },
    links: [
      { label: 'ערוצים', href: '/channels' },
      { label: 'מחירים', href: '/pricing' },
      { label: 'שאלות נפוצות', href: '/faq' },
    ],
    login: { label: 'כניסה', href: '/auth' },
    trial: { label: TRIAL_CTA_LABEL, href: '/auth' },
  },
  hero: {
    titleLine1: 'מערכת CRM לעסקים קטנים:',
    titleLine2: ' כל הלידים במקום אחד, בלי לפספס אף פנייה',
    subtitle: 'אתם כבר לא צריכים לזכור מי מחכה לתשובה. פותחים בבוקר ורואים בדיוק למי לחזור היום.',
    cta: TRIAL_CTA_LABEL,
    imageAlt: 'רשימת הלידים במערכת ה-CRM של SocialCRM, עם מקור, סטטוס ונציג לכל ליד',
  },
  logos: {
    lead: 'הלידים שלכם מגיעים מכל מקום: וואטסאפ, פייסבוק ואינסטגרם. SocialCRM היא מערכת CRM בעברית שמחברת את כולם לרשימה אחת מסודרת.',
    websiteLabel: 'טפסים באתר',
    websiteUrl: '/',
    websiteDir: 'rtl',
  },
  featuresCarousel: {
    dir: 'rtl',
    titleLead: 'מהרגע שהליד נכנס',
    titleTail: 'ועד שהוא נסגר',
    subtitle: 'ארבעה דברים שקורים אוטומטית בכל ליד, בלי שתצטרכו לזכור אותם.',
    items: [
      { title: 'כל הלידים נוחתים ברשימה אחת', description: 'לידים מפייסבוק, מאינסטגרם ומוואטסאפ נכנסים יחד, כל אחד עם מקור וסטטוס.' },
      { title: 'השיחה והליד הם אותו דבר', description: 'עונים מהמערכת ורואים מתי ההודעה נמסרה ומתי נקראה.' },
      { title: 'שום מעקב לא נופל בין הכיסאות', description: 'ליד שממתין מעל 24 שעות חוזר מעצמו לרשימה של היום.' },
      { title: 'AI שמכיר את כל ההיסטוריה', description: 'לכל ליד: תקציר קצר, שתי נקודות מפתח והצעד הבא המומלץ.' },
    ],
  },
  featuresGrid: {
    title: 'מערכת ניהול לידים שמתאימה לדרך שבה אתם באמת עובדים',
    subtitle:
      'משייכים נציג, מעדכנים סטטוס ועוקבים אחרי כל פנייה. SocialCRM מכניסה סדר לתהליך המכירה שלכם ועוזרת לענות מהר יותר, בלי טפסים מיותרים, בלי הגדרות מסובכות ובלי להאט אתכם.',
    items: [
      {
        imageAlt: 'הגדרות המענה האוטומטי בוואטסאפ במערכת SocialCRM',
        title: 'מענה אוטומטי בוואטסאפ',
        description: 'ליד שכותב בוואטסאפ מקבל תשובה תוך שניות, גם כשאתם לא מול המסך, ואת השיחה ממשיכים מתוך המערכת.',
      },
      {
        imageAlt: 'רשימת הודעות וואטסאפ מוכנות לשליחה במערכת SocialCRM',
        title: 'הודעות וואטסאפ מוכנות',
        description: 'תבניות הודעה מאושרות מראש, מוכנות לשליחה. שם הליד והפרטים שלו מתמלאים אוטומטית, בלי להקליד מחדש.',
      },
      {
        imageAlt: 'יומן הפגישות של SocialCRM בתצוגה שבועית',
        title: 'יומן פגישות מובנה',
        description: 'כל פגישה שקבעתם עם ליד מופיעה ביומן אחד, בתצוגת יום, שבוע או חודש, ומסתנכרנת אוטומטית עם יומן Google שלכם.',
      },
      {
        imageAlt: 'השוואת עסקאות לפי קטגוריה במערכת SocialCRM',
        title: 'השוואת עסקאות',
        description: 'רואים איך העסקאות מתחלקות בין שירותים, מוצרים, קורסים ומנויים, וכמה עמלה נכנסה מכל קטגוריה.',
      },
      {
        imageAlt: 'פרטי העסק של SocialCRM מופיעים בכל הערוצים והמסמכים',
        title: 'כל פרטי העסק במקום אחד',
        description: 'פרטי העסק שלכם נשמרים פעם אחת ומופיעים בוואטסאפ, בחשבוניות, בתשלומים ובמיילים ללקוחות, בלי למלא אותם שוב.',
      },
      {
        imageAlt: 'רצף מעקב אוטומטי אחרי ליד במערכת SocialCRM',
        title: 'אוטומציות מעקב',
        description: 'רצף מעקב אוטומטי לליד: מיד, אחרי יומיים ואחרי שבוע, עד שהוא חוזר אליכם.',
      },
    ],
  },
  featuresShowcase: {
    title: 'לא צריך להאמין לנו. תראו איך זה עובד.',
    subtitle: 'כך נראים הרשימה, השיחות, הסטטוסים וה-AI בעבודה היומיומית.',
    items: [
      {
        title: 'כל הלידים מכל הערוצים נוחתים ברשימה אחת',
        description:
          'לידים ממודעות פייסבוק ואינסטגרם נכנסים אוטומטית, ושיחות וואטסאפ מתחברות לליד. לכל פנייה יש מקור, סטטוס, נציג ותאריך לחזור אליה, כך ששום פנייה לא נשארת בלי מענה.',
      },
      {
        title: 'השיחה והליד הם אותו דבר',
        description:
          'עונים ישירות מהמערכת ורואים מתי ההודעה נמסרה ומתי נקראה. כל הודעה נשמרת על הליד, גם כשנציג מתחלף, ולפנייה חוזרת שולחים תבנית מאושרת.',
      },
      {
        title: 'כל ליד יודע איפה הוא עומד',
        description:
          'חדש, בטיפול, מעוניין, סגור — ואבוד כשזה נגמר. אלה הסטטוסים שהמערכת עובדת איתם בפועל, בלי שלבים מומצאים ובלי טבלה שצריך לתחזק ביד.',
      },
      {
        title: 'פותחים ליד, וכבר יודעים בדיוק מה לעשות הלאה',
        description:
          'ה-AI קורא את ההיסטוריה של הליד, מסכם איפה הוא עומד ומציע את הצעד הבא, על סמך המידע שנשמר על הליד. טיוטה נשלחת רק כשלוחצים על שליחה. זמין בתוכנית Pro.',
      },
    ],
  },
  faq: {
    title: 'שאלות נפוצות',
    items: FAQ_ITEMS,
    cardTitle: 'יש עוד שאלה?',
    cardBodyBeforeDays: 'יש שאלה שלא מופיעה כאן? כתבו לנו ונחזור אליכם. אפשר גם להתחיל מיד: ',
    cardBodyAfterDays: ' ימי ניסיון במערכת המלאה, ללא חיוב בתקופת הניסיון.',
    cardCta: 'דברו איתנו',
    cardCtaHref: '/auth',
  },
  pricing: {
    titleLine1: 'נסו את המערכת המלאה שבוע שלם, ',
    titleLine2: 'והחליטו לפני החיוב הראשון.',
    subtitleAfterDays: ' ימים עם כל מה שיש במערכת, כולל ה-AI המלא. כדי להתחיל שומרים כרטיס אשראי, והוא לא מחויב בתקופת הניסיון.',
    recommended: 'התוכנית המומלצת',
    talkToUs: 'דברו איתנו',
    dir: 'rtl',
    logoHref: '/',
    plans: {
      individual: {
        title: `${TRIAL_LENGTH_DAYS} ימי ניסיון`,
        subtitle: 'המערכת המלאה',
        description: 'נדרש כרטיס אשראי · ללא חיוב בתקופת הניסיון',
        priceSuffix: '/לחודש',
        features: [
          `כל מה שיש ב-Pro, ${TRIAL_LENGTH_DAYS} ימים`,
          'לידים ללא הגבלה',
          'חיבור לפייסבוק, אינסטגרם ווואטסאפ',
          'סטטוסים, נציגים ותאריכי מעקב',
          'ייבוא מאקסל, ייצוא לאקסל ו-PDF',
          'תקציר חכם ופעולה מומלצת',
          'טיוטות להודעות מעקב',
          'שאלות חופשיות על הליד',
        ],
        ctaText: `בתום ${TRIAL_LENGTH_DAYS} הימים ${PRICING.currency}${PRICING.monthly} לחודש · אפשר לבטל לפני החיוב הראשון`,
        ctaButton: TRIAL_CTA_LABEL,
      },
      team: {
        title: 'Pro',
        subtitle: 'כשהלידים מתחילים להצטבר',
        description: 'לעסק או לצוות מכירות',
        priceSuffix: '/לחודש',
        features: [
          'לידים ללא הגבלה',
          'תקציר חכם על כל ליד',
          'פעולה מומלצת עם הסיבה שלה',
          'טיוטות להודעות מעקב',
          'שאלות חופשיות על הליד',
          'שיוך לידים לנציגים',
          'חלוקת עמלות על עסקה משותפת',
          'מחיר אחד לסביבת העבודה',
        ],
        ctaText: 'בלי תוספת לכל נציג · חיוב חודשי עד לביטול',
        ctaButton: 'שדרגו ל-Pro',
      },
    },
  },
  footer: {
    dir: 'rtl',
    logoHref: '/',
    sections: [
      {
        title: 'המוצר',
        links: [
          { name: 'ניהול לידים', href: '/' },
          { name: 'מחירים', href: '/pricing' },
          { name: 'שאלות נפוצות', href: '/faq' },
          { name: 'CRM לעומת אקסל', href: '/crm-vs-excel' },
          { name: 'English', href: '/en', hrefLang: 'en' },
        ],
      },
      {
        title: 'ערוצים',
        links: [
          { name: 'כל הערוצים', href: '/channels' },
          { name: 'CRM לוואטסאפ', href: '/crm-for-whatsapp-business' },
          { name: 'לידים מאינסטגרם', href: '/instagram-leads-crm' },
        ],
      },
      {
        title: 'מידע',
        links: [
          { name: 'תנאי שימוש', href: '/terms' },
          { name: 'מדיניות פרטיות', href: '/privacy' },
          { name: 'מחיקת נתונים', href: '/data-deletion' },
        ],
      },
    ],
    social: { facebook: 'פייסבוק', instagram: 'אינסטגרם', email: 'אימייל' },
    phoneLabel: 'טלפון:',
    copyright: '© SocialCRM. כל הזכויות שמורות.',
    copyrightHref: '/',
    privacy: 'מדיניות פרטיות',
    terms: 'תנאי שימוש',
  },
}
