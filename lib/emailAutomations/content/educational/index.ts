import type { ContentItem } from '../types'
import { TESTIMONIALS } from '../../testimonials'

// The educational journey — an ordered sequence. Array order IS delivery order.
// A user's position is derived from how many of these were actually delivered
// (see resolveNextEducational); elapsed time never advances or skips it.
//
// Every item: gender-neutral Hebrew (infinitives / impersonal), teaches one
// thing, no hype, one clear CTA. Grounded only in capabilities the product has.
// Phase 2 extends this list to 60+; adding an email = appending one item here.

export const EDUCATIONAL: ContentItem[] = [
  {
    key: 'edu_one_place',
    category: 'lifecycle',
    topic: 'best_practice',
    schedule: { kind: 'step', step: 1 },
    priority: 'low',
    subject: 'כל הלידים שלך במקום אחד',
    preview: 'למה כדאי שכל ליד יגיע לאותו מקום',
    headline: 'כל ליד במקום אחד, בלי ליפול בין הכיסאות',
    blocks: [
      {
        type: 'paragraph',
        text: 'לידים מגיעים מכל מקום — פייסבוק, וואטסאפ, טלפון, המלצות. כשכל אחד נשמר במקום אחר, קל לשכוח מישהו.',
      },
      {
        type: 'paragraph',
        text: 'הרעיון הפשוט מאחורי המערכת: כל ליד, מכל מקור, נכנס לאותה רשימה מסודרת. משם רואים בבירור מי חדש, מי בטיפול, ומי מחכה לחזרה.',
      },
      { type: 'tip', label: 'למה זה חשוב', text: 'כשכל הלידים באותו מקום, אף פנייה לא נשכחת — וזה ההבדל בין ליד שנסגר לליד שנעלם.' },
    ],
    cta: { label: 'למעבר ללידים', route: '/leads' },
  },
  {
    key: 'edu_all_in_one_quote',
    category: 'lifecycle',
    topic: 'testimonial',
    schedule: { kind: 'step', step: 2 },
    priority: 'low',
    subject: 'מה משתמשים מספרים אחרי שהכול במקום אחד',
    preview: 'רגע קטן של סדר, מתוך הכאוס',
    headline: 'כשהכול מתאגד למקום אחד',
    blocks: [
      {
        type: 'paragraph',
        text: 'אחת התחושות שחוזרות שוב ושוב מהמשתמשים היא ההקלה של לראות את כל הלידים יחד, במקום מפוזרים בין צ׳אטים, פתקים ואקסלים.',
      },
      { type: 'testimonial', quote: TESTIMONIALS.all_in_one.quote, source: TESTIMONIALS.all_in_one.source },
      { type: 'paragraph', text: 'זה בדיוק מה שהמערכת נועדה לתת — מקום אחד שמחזיק את כל התמונה.' },
    ],
    cta: { label: 'למעבר ללידים', route: '/leads' },
  },
  {
    key: 'edu_status_followup',
    category: 'lifecycle',
    topic: 'best_practice',
    schedule: { kind: 'step', step: 3 },
    priority: 'low',
    subject: 'איך לדעת בכל רגע למי לחזור',
    preview: 'הסטטוס של כל ליד עושה את כל ההבדל',
    headline: 'הסטטוס הוא המפה שלך',
    blocks: [
      { type: 'paragraph', text: 'לכל ליד יש סטטוס: חדש, בטיפול, נסגר. עדכון קצר של הסטטוס אחרי כל שיחה שומר על תמונה ברורה.' },
      {
        type: 'paragraph',
        text: 'ברגע שהסטטוסים מעודכנים, אפשר לסנן את הרשימה ולראות מיד מי עדיין מחכה למענה — בלי לנחש ובלי לזכור בעל פה.',
      },
      { type: 'tip', label: 'הרגל קטן', text: 'אחרי כל שיחה, כדאי לעדכן את הסטטוס תוך כמה שניות. זה חוסך שעות של חיפוש בהמשך.' },
    ],
    cta: { label: 'למעבר ללידים', route: '/leads' },
  },
  {
    key: 'edu_whatsapp_inbox',
    category: 'lifecycle',
    topic: 'feature',
    schedule: { kind: 'step', step: 4 },
    priority: 'low',
    subject: 'כל שיחות הוואטסאפ במקום אחד',
    preview: 'השיחות עם הלידים, מרוכזות לצד הפרטים',
    headline: 'השיחות עם הלידים, בלי לצאת מהמערכת',
    blocks: [
      {
        type: 'feature',
        title: 'תיבת השיחות',
        text: 'כשוואטסאפ מחובר, כל שיחה עם ליד מופיעה בתיבה שבמערכת, לצד פרטי הליד וההיסטוריה שלו.',
      },
      {
        type: 'paragraph',
        text: 'במקום לחפש בין עשרות צ׳אטים פתוחים בטלפון, רואים במבט אחד מי כתב, מי מחכה לתשובה, ומה נאמר עד עכשיו.',
      },
    ],
    cta: { label: 'למעבר לתיבה', route: '/inbox' },
  },
  {
    key: 'edu_amazing_quote',
    category: 'lifecycle',
    topic: 'testimonial',
    schedule: { kind: 'step', step: 5 },
    priority: 'low',
    subject: 'רגע קטן של נחת מהמשתמשים',
    preview: 'מה קורה כשמערכת פשוט עובדת',
    headline: 'כשמערכת פשוט עובדת',
    blocks: [
      { type: 'paragraph', text: 'לפעמים זה פשוט הידיעה שכל ליד נמצא, מסודר, ומחכה במקום הנכון.' },
      { type: 'testimonial', quote: TESTIMONIALS.amazing_system.quote, source: TESTIMONIALS.amazing_system.source },
      { type: 'paragraph', text: 'אפשר לפתוח את המערכת עכשיו ולראות בדיוק מה מחכה לטיפול היום.' },
    ],
    cta: { label: 'למעבר ללוח', route: '/dashboard' },
  },
  {
    key: 'edu_tasks_reminders',
    category: 'lifecycle',
    topic: 'feature',
    schedule: { kind: 'step', step: 6 },
    priority: 'low',
    subject: 'תזכורת שלא נותנת לאף ליד ליפול',
    preview: 'מעקב אחרי לידים בלי לזכור הכול בראש',
    headline: 'שאף מעקב לא ייפול בין הכיסאות',
    blocks: [
      {
        type: 'feature',
        title: 'משימות ותזכורות',
        text: 'אפשר להוסיף לכל ליד משימת מעקב — למשל לחזור אליו מחר — והמערכת תזכיר בזמן.',
      },
      {
        type: 'paragraph',
        text: 'ככה לא צריך להחזיק בראש מי צריך שיחה חוזרת ומתי. המערכת שומרת עבורך את רשימת הדברים לעשות היום.',
      },
    ],
    cta: { label: 'למעבר למשימות', route: '/tasks' },
  },
  {
    key: 'edu_import_excel',
    category: 'lifecycle',
    topic: 'feature',
    schedule: { kind: 'step', step: 7 },
    priority: 'low',
    subject: 'יש לך אקסל עם לידים? אפשר לייבא הכול',
    preview: 'כל הרשימה הישנה נכנסת למערכת בבת אחת',
    headline: 'הלידים הישנים לא צריכים להישאר באקסל',
    blocks: [
      { type: 'paragraph', text: 'אם יש רשימת לידים באקסל, אפשר לייבא אותה למערכת בבת אחת — בלי להקליד כל שורה מחדש.' },
      {
        type: 'paragraph',
        text: 'תוך דקות כל הלידים מופיעים ברשימה מסודרת, עם שם, מקור וסטטוס, ואפשר להתחיל לעבוד עליהם.',
      },
      { type: 'tip', label: 'טיפ', text: 'שווה לייבא גם רשימות ישנות — לפעמים ליד שנשכח לפני חודשים הוא בדיוק העסקה הבאה.' },
    ],
    cta: { label: 'לייבוא לידים', route: '/leads' },
  },
  {
    key: 'edu_dashboard_today',
    category: 'lifecycle',
    topic: 'productivity_tip',
    schedule: { kind: 'step', step: 8 },
    priority: 'low',
    subject: 'למי כדאי לחזור היום',
    preview: 'לפתוח את המערכת ולדעת מיד במה להתחיל',
    headline: 'להתחיל את היום בלי לנחש',
    blocks: [
      { type: 'paragraph', text: 'במקום לפתוח את הבוקר עם תחושה של עומס, אפשר לפתוח את הלוח ולראות מיד מה דורש תשומת לב.' },
      {
        type: 'paragraph',
        text: 'הלוח מרכז את מה שחשוב עכשיו — לידים חדשים ומעקבים שממתינים — כך שהפעולה הראשונה של היום ברורה.',
      },
      { type: 'tip', label: 'הרגל מנצח', text: 'כמה דקות בלוח בתחילת היום שוות יותר משעה של חיפוש אחר כך.' },
    ],
    cta: { label: 'למעבר ללוח', route: '/dashboard' },
  },
  {
    key: 'edu_assign_rep',
    category: 'lifecycle',
    topic: 'feature',
    schedule: { kind: 'step', step: 9 },
    priority: 'low',
    subject: 'לשייך ליד לנציג הנכון',
    preview: 'ברור לכל ליד מי אחראי עליו',
    headline: 'לכל ליד יש מי שאחראי עליו',
    blocks: [
      {
        type: 'feature',
        title: 'שיוך נציג',
        text: 'אפשר לשייך כל ליד לנציג. ככה ברור מי מטפל במי, ואף ליד לא נשאר בלי בעלים.',
      },
      {
        type: 'paragraph',
        text: 'כשעובדים בכמה ידיים, שיוך ברור מונע כפילויות ומוודא שכל פנייה מקבלת מענה מאדם אחד.',
      },
    ],
    cta: { label: 'למעבר ללידים', route: '/leads' },
  },
  {
    key: 'edu_genius_quote',
    category: 'lifecycle',
    topic: 'testimonial',
    schedule: { kind: 'step', step: 10 },
    priority: 'low',
    subject: 'עוד משפט אחד ממשתמש מרוצה',
    preview: 'לפעמים כלי פשוט עושה הבדל גדול',
    headline: 'כלי פשוט, הבדל גדול',
    blocks: [
      {
        type: 'paragraph',
        text: 'לאורך הימים האחרונים ראינו יחד איך כל ליד מתאגד למקום אחד, איך הסטטוס עוזר לדעת למי לחזור, ואיך מעקב אחד שלא נופל יכול להיות העסקה הבאה.',
      },
      { type: 'testimonial', quote: TESTIMONIALS.genius.quote, source: TESTIMONIALS.genius.source },
      { type: 'paragraph', text: 'מכאן זה כבר שלך. אפשר להיכנס ולראות מי מחכה לטיפול היום.' },
    ],
    cta: { label: 'למעבר ללידים', route: '/leads' },
  },
]

// All educational keys, in order — used for progression + cooldown look-back.
export const EDUCATIONAL_KEYS: string[] = EDUCATIONAL.map((i) => i.key)
