import { buildPageMetadata } from '@/lib/seo/metadata'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildFAQSchema, type FAQItem } from '@/components/seo/FAQ'
import {
  Hero,
  Problem,
  ProductProof,
  Copilot,
  Channels,
  OperationalControl,
  PricingPreview,
  Faq,
  FinalCta,
} from '@/components/marketing/sections'

export const metadata = buildPageMetadata({
  path: '/crm',
  title: 'מערכת ניהול לידים לעסקים קטנים | SocialCRM',
  description:
    'SocialCRM מרכזת את כל הלידים מפייסבוק, מאינסטגרם ומוואטסאפ במקום אחד. לכל ליד יש שיחה מחוברת, סטטוס ובעלים, ובתוכנית Pro גם AI שמכיר את ההיסטוריה וממליץ על הצעד הבא. מתחילים בחינם.',
  ogDescription:
    'כל הלידים מפייסבוק, מאינסטגרם ומוואטסאפ במקום אחד, עם שיחה, סטטוס ומעקב לכל ליד. שום פנייה לא נופלת.',
  canonical: 'https://getsocialcrm.com/',
})

/**
 * The FAQ, defined ONCE.
 *
 * This page used to carry two lists: an eight-item `faqItems` feeding the
 * `FAQPage` JSON-LD, and a separate twelve-item literal inlined into the
 * renderer. They had drifted — the markup told Google the page answered a
 * question the page did not actually render. Structured data that misrepresents
 * the page is a Google structured-data violation, and neither half looked wrong
 * on its own, which is why it survived.
 *
 * Both the rendered accordion and the JSON-LD are derived from this array, so
 * they cannot disagree. The guardrail suite asserts that parity.
 *
 * Every answer is checked against shipped behaviour, not against
 * `marketing-knowledge/features.md`, which is three months stale.
 */
const faqItems: FAQItem[] = [
  {
    question: 'מה זה ניהול לידים?',
    answer:
      'ניהול לידים הוא תהליך של איסוף, ארגון ומעקב אחר פניות של לקוחות פוטנציאליים. המטרה היא לוודא שכל ליד מטופל בזמן ולא נשכח, עד לסגירת עסקה או להחלטה שהוא לא רלוונטי.',
  },
  {
    question: 'מה זה CRM לעסק קטן?',
    answer:
      'CRM לעסק קטן היא תוכנה שמאגדת את כל הלידים ואנשי הקשר במקום אחד, ומאפשרת לעדכן סטטוס, לשייך נציג ולעקוב אחר ההתקדמות. בניגוד למערכות ארגוניות, היא לא דורשת הטמעה, הכשרה או הגדרת תהליכים לפני שמתחילים לעבוד.',
  },
  {
    question: 'איך הלידים מפייסבוק ומאינסטגרם נכנסים למערכת?',
    answer:
      'מחברים את הדף העסקי בפייסבוק, וכל ליד שממלא טופס Lead Ad נכנס למערכת אוטומטית תוך שניות, עם מקור וסטטוס. לידים ממודעות אינסטגרם מגיעים באותה דרך.',
  },
  {
    question: 'האם פניות בהודעה ישירה באינסטגרם נכנסות אוטומטית?',
    answer:
      'לא. אינסטגרם לא מאפשר למערכות חיצוניות לקרוא את תוכן ההודעות, ולכן פנייה בהודעה ישירה מוסיפים ידנית בעשר שניות: שם, טלפון ומקור אינסטגרם. לידים ממודעות אינסטגרם, לעומת זאת, נכנסים אוטומטית.',
  },
  {
    question: 'איך עובד החיבור לוואטסאפ?',
    answer:
      'מחברים את הוואטסאפ העסקי, והשיחות נכנסות למערכת ומתחברות לליד עם מקור, סטטוס ובעלים. עונים ישירות מהמערכת, ורואים מתי ההודעה נמסרה ומתי נקראה. לפנייה חוזרת אפשר לשלוח תבנית מאושרת.',
  },
  {
    question: 'אילו סטטוסים יש לליד?',
    answer:
      'חדש, בטיפול, מעוניין, סגור ואבוד. אלה הסטטוסים שהמערכת עובדת איתם בפועל. ליד שנסגר נשאר ליד — אין ישות נפרדת של לקוח ואין רשימה שנייה לתחזק.',
  },
  {
    question: 'מה ההבדל בין ניהול לידים באקסל לבין מערכת CRM?',
    answer:
      'אקסל מצוין לאחסון, אבל הוא לא מנהל תהליך מכירה. מערכת CRM מחברת את מקורות הלידים, שומרת את השיחה וההיסטוריה על כל ליד, מחזירה לידים לרשימת היום כשמגיע תאריך המעקב, ומחלקת עבודה בין נציגים.',
  },
  {
    question: 'האם ניתן לייבא לידים קיימים מאקסל?',
    answer:
      'כן. מעלים קובץ אקסל קיים והלידים מאורגנים במערכת. אפשר גם לייצא בחזרה לאקסל או ל-PDF בכל רגע, כך שאין נעילה על הנתונים.',
  },
  {
    question: 'מה ה-AI במערכת עושה בפועל?',
    answer:
      'על כל ליד יש תקציר קצר, שתי נקודות מפתח ופעולה מומלצת עם הסיבה שלה, מבוססים על ההיסטוריה שנשמרה על הליד. אפשר לבקש טיוטה להודעת מעקב, לשאול מה הצעד הבא או לשאול שאלה על הליד. ה-AI לא שולח הודעות בעצמו — כל הודעה נשלחת רק בלחיצה שלך. שכבת ה-AI נפתחת בתוכנית Pro.',
  },
  {
    question: 'האם SocialCRM מתאים לעסק של אדם אחד?',
    answer:
      'כן. המערכת מתוכננת קודם כל לבעל עסק יחיד שמנהל את הלידים בעצמו. אפשר להוסיף נציגים בהמשך, לשייך להם לידים ולחלק עמלות על עסקה משותפת, בלי לשנות תוכנית.',
  },
  {
    question: 'כמה זה עולה?',
    answer:
      'המערכת חינמית עד 50 לידים, ללא כרטיס אשראי. תוכנית Pro מסירה את מגבלת הלידים ופותחת את שכבת ה-AI, במחיר אחד לכל סביבת העבודה — בלי תוספת לכל נציג.',
  },
]

const pageSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  '@id': 'https://getsocialcrm.com/#software',
  name: 'SocialCRM',
  alternateName: 'SocialCRM, מערכת ניהול לידים לעסקים קטנים',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  url: 'https://getsocialcrm.com/crm',
  inLanguage: 'he',
  description:
    'SocialCRM מרכזת את כל הלידים מפייסבוק, מאינסטגרם ומוואטסאפ במקום אחד. לכל ליד יש שיחה מחוברת, סטטוס ובעלים, ובתוכנית Pro גם AI שמכיר את ההיסטוריה וממליץ על הצעד הבא. מתחילים בחינם.',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'ILS',
    availability: 'https://schema.org/InStock',
  },
  featureList: [
    'ניהול לידים ממדיה חברתית',
    'חיבור אוטומטי לפייסבוק ואינסטגרם',
    'ייבוא לידים מאקסל',
    'מעקב אחר מכירות',
    'ניהול נציגים וצוותים',
  ],
  publisher: { '@id': 'https://getsocialcrm.com/#organization' },
}

const howToSchema = {
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name: 'איך מתחילים לנהל לידים לעסק קטן',
  description: 'מדריך שלב-אחר-שלב להתחלת ניהול לידים יעיל לעסקים קטנים',
  inLanguage: 'he',
  step: [
    { '@type': 'HowToStep', position: 1, name: 'אוספים את כל הלידים הקיימים', text: 'מייבאים לידים קיימים מאקסל, וואטסאפ ומקורות אחרים למקום אחד.' },
    { '@type': 'HowToStep', position: 2, name: 'מחברים את מקורות הלידים', text: 'מחברים דף פייסבוק ואינסטגרם כך שלידים חדשים יגיעו אוטומטית.' },
    { '@type': 'HowToStep', position: 3, name: 'מגדירים סטטוסים', text: 'קובעים את שלבי המכירה: חדש, בטיפול, הצעת מחיר, סגור, אבוד.' },
    { '@type': 'HowToStep', position: 4, name: 'משייכים לנציגים', text: 'מחלקים לידים בין הנציגים. כל אחד רואה רק את שלו.' },
    { '@type': 'HowToStep', position: 5, name: 'עובדים לפי רשימת עדיפויות', text: 'פותחים את המערכת בכל יום ורואים מיידית מה צריך טיפול דחוף.' },
  ],
}

const faqSchema = buildFAQSchema(faqItems)

export default function CRMPage() {
  return (
    <>
      <JsonLd data={pageSchema} />
      <JsonLd data={howToSchema} />
      <JsonLd data={faqSchema} />

      {/*
        ONE STORY, in one order:
        arrive → the problem → the product doing the work → the layer that reads
        it → where leads come from → what stops things falling → what it costs →
        what people ask → the ask.

        Each beat picks its ground by the editorial rule in
        `lib/css/marketing.css`: light for narrative and SEO copy, dark for
        product moments. The page alternates light → light → dark → dark →
        light → dark → light → light → dark, so the product chapters read as
        chapters rather than as alternating stripes.

        There is no testimonial section and no logo cloud. There are no verified
        customers to quote, and `marketing-knowledge/winning-angles.md` lists
        fabricated proof under "angles we do NOT run". Product proof replaces it.
      */}
      <Hero />
      <Problem />
      <ProductProof />
      <Copilot />
      <Channels />
      <OperationalControl />
      <PricingPreview />
      <Faq items={faqItems} lead='שאלות נפוצות על ניהול לידים ועל המערכת' />
      <FinalCta />
    </>
  )
}
