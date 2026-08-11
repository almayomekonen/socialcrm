import { GUIDE_CATEGORIES, type SupportCategory } from './vocabulary'

/**
 * The knowledge base is DATA, not pages.
 *
 * Two routes render every article (`/support/guides` and
 * `/support/guides/[slug]`), so adding a guide is appending an object here — no
 * new file, no new route, no build step. `tags` and `relatedIntegration` exist
 * from day one so a later assistant could retrieve over this registry without a
 * migration, and so a public SEO surface could render the same objects with zero
 * content migration.
 *
 * `other` deliberately has no articles: it is where an unclassifiable request
 * lands, and there is nothing to read about "other".
 *
 * The voice is the product's own — short, plain, and never technical. Every
 * article answers "what do I do", not "how does it work".
 */

export type GuideSection = { heading: string; body: string[] }

export type GuideArticle = {
  slug: string
  category: Exclude<SupportCategory, 'other'>
  title: string
  summary: string
  tags: string[]
  /** The integration this article is about, when there is one. Used by Phase 4. */
  relatedIntegration: string | null
  sections: GuideSection[]
}

export const GUIDE_ARTICLES: GuideArticle[] = [
  {
    slug: 'connect-whatsapp',
    category: 'whatsapp',
    title: 'חיבור WhatsApp למערכת',
    summary: 'איך לחבר מספר WhatsApp עסקי כדי שהודעות מלקוחות ייכנסו לשיחות.',
    tags: ['whatsapp', 'וואטסאפ', 'חיבור', 'הודעות'],
    relatedIntegration: 'whatsapp',
    sections: [
      {
        heading: 'לפני שמתחילים',
        body: [
          'צריך מספר WhatsApp עסקי שאינו מחובר כרגע לאפליקציית WhatsApp Business רגילה.',
          'החיבור נעשה פעם אחת, ומשם ההודעות נכנסות אוטומטית.',
        ],
      },
      {
        heading: 'שלבי החיבור',
        body: [
          'נכנסים להגדרות ואז לאינטגרציות.',
          'לוחצים על חיבור WhatsApp ומשלימים את ההרשמה בחלון שנפתח.',
          'בסיום מופיע סטטוס "מקבל אירועים" בכרטיס החיבור.',
        ],
      },
    ],
  },
  {
    slug: 'whatsapp-not-receiving',
    category: 'whatsapp',
    title: 'הודעות WhatsApp לא נכנסות',
    summary: 'מה לבדוק כשהחיבור קיים אבל הודעות חדשות לא מגיעות לשיחות.',
    tags: ['whatsapp', 'וואטסאפ', 'תקלה', 'הודעות', 'לא מגיע'],
    relatedIntegration: 'whatsapp',
    sections: [
      {
        heading: 'בדיקה ראשונה',
        body: [
          'פותחים הגדרות ואז אינטגרציות ומסתכלים על הסטטוס בכרטיס WhatsApp.',
          'אם כתוב "החיבור נותק" צריך לחבר מחדש — ההרשאה פגה.',
        ],
      },
      {
        heading: 'אם הסטטוס תקין',
        body: ['שולחים הודעת בדיקה מטלפון אחר ובודקים אם היא מופיעה בשיחות תוך דקה.'],
      },
    ],
  },
  {
    slug: 'connect-facebook-instagram',
    category: 'meta',
    title: 'חיבור Facebook ו-Instagram',
    summary: 'איך לחבר עמוד וטפסי לידים כדי שלידים ייכנסו למערכת אוטומטית.',
    tags: ['facebook', 'instagram', 'פייסבוק', 'אינסטגרם', 'לידים', 'טפסים'],
    relatedIntegration: 'facebook',
    sections: [
      {
        heading: 'מה מתחבר',
        body: ['החיבור מאפשר לקבל לידים מטפסי הלידים של Facebook ו-Instagram ישירות לרשימת הלידים.'],
      },
      {
        heading: 'שלבי החיבור',
        body: [
          'נכנסים להגדרות ואז לאינטגרציות ולוחצים על חיבור Facebook.',
          'מאשרים את ההרשאות ובוחרים את העמוד שממנו מגיעים הלידים.',
        ],
      },
    ],
  },
  {
    slug: 'import-leads-excel',
    category: 'leads',
    title: 'ייבוא לידים מקובץ Excel',
    summary: 'איך להעלות רשימת לידים קיימת כדי להתחיל לעבוד מיד.',
    tags: ['לידים', 'ייבוא', 'excel', 'אקסל', 'העלאה'],
    relatedIntegration: null,
    sections: [
      {
        heading: 'הכנת הקובץ',
        body: [
          'הקובץ צריך לכלול לפחות שם וטלפון בכל שורה.',
          'עמודות נוספות כמו אימייל ומקור הליד ייובאו אם הן קיימות.',
        ],
      },
      { heading: 'העלאה', body: ['בעמוד הלידים בוחרים "העלה לידים" ומצרפים את הקובץ.'] },
    ],
  },
  {
    slug: 'lead-statuses',
    category: 'leads',
    title: 'סטטוסים של לידים',
    summary: 'מה המשמעות של כל סטטוס ומתי לעדכן אותו.',
    tags: ['לידים', 'סטטוס', 'מעקב'],
    relatedIntegration: null,
    sections: [
      {
        heading: 'למה זה חשוב',
        body: ['הסטטוס הוא מה שמאפשר לדעת למי צריך לחזור היום ומה כבר טופל.'],
      },
      {
        heading: 'מתי לעדכן',
        body: ['מיד אחרי שיחה או הודעה — עדכון לוקח שניות וחוסך בלבול מאוחר יותר.'],
      },
    ],
  },
  {
    slug: 'automations-overview',
    category: 'automations',
    title: 'איך עובדות אוטומציות',
    summary: 'מה אוטומציה עושה, מתי היא רצה, ואיך לבדוק שהיא פעלה.',
    tags: ['אוטומציה', 'אוטומציות', 'הודעות', 'מייל'],
    relatedIntegration: null,
    sections: [
      {
        heading: 'העיקרון',
        body: ['אוטומציה מחכה לאירוע — למשל ליד חדש — ומבצעת פעולה אחת, כמו שליחת הודעה.'],
      },
      { heading: 'בדיקה', body: ['בהגדרות ואז אוטומציות אפשר לראות מתי כל אוטומציה רצה לאחרונה.'] },
    ],
  },
  {
    slug: 'ai-assistant',
    category: 'ai',
    title: 'העוזר החכם',
    summary: 'מה העוזר החכם יודע לעשות ומה הוא לא עושה.',
    tags: ['ai', 'עוזר', 'חכם', 'סיכום'],
    relatedIntegration: null,
    sections: [
      {
        heading: 'מה הוא עושה',
        body: ['מסכם שיחות, מציע צעד הבא, ועוזר לנסח הודעה — תמיד על בסיס הנתונים שבמערכת.'],
      },
      {
        heading: 'מה הוא לא עושה',
        body: ['הוא לא שולח הודעות ללקוחות בלי שתאשרו, ולא ממציא נתונים שאינם במערכת.'],
      },
    ],
  },
  {
    slug: 'subscription-and-billing',
    category: 'billing',
    title: 'מנוי ותשלום',
    summary: 'איך לראות את המנוי, לשדרג, ולעדכן אמצעי תשלום.',
    tags: ['מנוי', 'תשלום', 'חיוב', 'שדרוג', 'pro'],
    relatedIntegration: null,
    sections: [
      { heading: 'איפה זה נמצא', body: ['בהגדרות ואז מנוי ותשלום מופיעים מצב המנוי וההיסטוריה.'] },
      { heading: 'שדרוג', body: ['השדרוג נכנס לתוקף מיד והנתונים הקיימים נשמרים כפי שהם.'] },
    ],
  },
  {
    slug: 'invite-team-members',
    category: 'account',
    title: 'הוספת נציגים לצוות',
    summary: 'איך להזמין נציג חדש ומה הוא יראה.',
    tags: ['נציג', 'צוות', 'הזמנה', 'משתמשים', 'הרשאות'],
    relatedIntegration: null,
    sections: [
      { heading: 'הזמנה', body: ['בהגדרות ואז משתמשים מזינים שם ואימייל ושולחים הזמנה.'] },
      { heading: 'מה הנציג רואה', body: ['נציג רואה את הלידים שהוקצו לו; מנהל רואה את כל הלידים.'] },
    ],
  },
  {
    slug: 'website-form-connection',
    category: 'integrations',
    title: 'חיבור טופס מהאתר',
    summary: 'איך לחבר טופס יצירת קשר באתר כך שפניות ייכנסו כלידים.',
    tags: ['אתר', 'טופס', 'wordpress', 'לידים', 'חיבור'],
    relatedIntegration: 'contact_form_7',
    sections: [
      {
        heading: 'מה צריך',
        body: ['בהגדרות ואז אינטגרציות יוצרים חיבור לאתר ומקבלים כתובת וקוד סודי.'],
      },
      {
        heading: 'אם פניות נדחות',
        body: [
          'אם מופיע "פניות נדחות", הקוד הסודי באתר כנראה השתנה — יוצרים חיבור חדש ומעדכנים אותו באתר.',
        ],
      },
    ],
  },
]

export function articlesByCategory(category: SupportCategory): GuideArticle[] {
  return GUIDE_ARTICLES.filter((a) => a.category === category)
}

export function articleBySlug(slug: string): GuideArticle | null {
  // find(), never a keyed object lookup: a map would answer for '__proto__'
  // and 'constructor'.
  return GUIDE_ARTICLES.find((a) => a.slug === slug) ?? null
}

/**
 * Substring match over title, summary and tags.
 *
 * Deliberately not fuzzy and not ranked — a customer typing "whatsapp" wants the
 * WhatsApp articles, and a scoring algorithm here would be invention with
 * nothing real to tune it against. Tags carry both Hebrew and English spellings
 * so either finds the same article.
 */
export function searchArticles(query: string): GuideArticle[] {
  const q = (query ?? '').trim().toLowerCase()
  if (q.length === 0) return [...GUIDE_ARTICLES]
  return GUIDE_ARTICLES.filter((a) => {
    const haystack = [a.title, a.summary, ...a.tags].join(' ').toLowerCase()
    return haystack.includes(q)
  })
}

export const GUIDE_CATEGORY_ORDER = GUIDE_CATEGORIES
