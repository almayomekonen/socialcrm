import { buildPageMetadata } from '@/lib/seo/metadata'
import { TRIAL_OFFER_FAQ_ANSWER } from '@/lib/pricing'
import { TRIAL_LENGTH_DAYS } from '@/lib/trial'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildFAQSchema, type FAQItem } from '@/components/seo/FAQ'

import { ThemeProvider } from '@/components/lumen/theme-provider'
import Navbar from '@/components/lumen/layout/navbar'
import Footer from '@/components/lumen/layout/footer'
import Hero from '@/components/lumen/sections/hero'
import Logos from '@/components/lumen/sections/logos'
import FeaturesCarousel from '@/components/lumen/sections/features-carousel'
import FeaturesGrid from '@/components/lumen/sections/features-grid'
import FeaturesShowcase from '@/components/lumen/sections/features-showcase'
import FAQSection from '@/components/lumen/sections/faq-section'
import Pricing from '@/components/lumen/sections/pricing'

export const metadata = buildPageMetadata({
  path: '/',
  title: 'מערכת ניהול לידים לעסקים קטנים | SocialCRM',
  description:
    `SocialCRM מרכזת את כל הלידים מפייסבוק, מאינסטגרם ומוואטסאפ במקום אחד. לכל ליד יש שיחה מחוברת, סטטוס ונציג, ובתוכנית Pro גם AI שמכיר את ההיסטוריה וממליץ על הצעד הבא. ${TRIAL_LENGTH_DAYS} ימי ניסיון במערכת המלאה.`,
  ogDescription:
    'כל הלידים מפייסבוק, מאינסטגרם ומוואטסאפ במקום אחד, עם שיחה, סטטוס ומעקב לכל ליד, כדי ששום פנייה לא תיפול בין הכיסאות.',
})

const faqItems: FAQItem[] = [
  {
    question: 'מה זה ניהול לידים?',
    answer:
      'ניהול לידים הוא תהליך של איסוף, ארגון ומעקב אחר פניות של לקוחות פוטנציאליים. המטרה היא לוודא שכל ליד מטופל בזמן ולא נשכח, עד שהוא נסגר או עד שמחליטים שהוא כבר לא רלוונטי.',
  },
  {
    question: 'מה זה CRM לעסק קטן?',
    answer:
      'CRM לעסק קטן היא תוכנה שמאגדת את כל הלידים ואנשי הקשר במקום אחד, ומאפשרת לעדכן סטטוס, לשייך נציג ולעקוב אחרי ההתקדמות. בניגוד למערכות ארגוניות, היא לא דורשת הטמעה, הכשרה או הגדרת תהליכים לפני שמתחילים לעבוד.',
  },
  {
    question: 'איך הלידים מפייסבוק ומאינסטגרם נכנסים למערכת?',
    answer:
      'מחברים את הדף העסקי בפייסבוק, וכל ליד שממלא טופס Lead Ad נכנס למערכת אוטומטית תוך שניות, עם מקור וסטטוס. לידים ממודעות אינסטגרם מגיעים באותה דרך.',
  },
  {
    question: 'האם פניות בהודעה ישירה באינסטגרם נכנסות אוטומטית?',
    answer:
      'לא. אינסטגרם לא מאפשר למערכות חיצוניות לקרוא את תוכן ההודעות, ולכן פנייה מהודעה ישירה מוסיפים ידנית בתוך כעשר שניות: שם, טלפון ומקור אינסטגרם. לידים ממודעות אינסטגרם, לעומת זאת, נכנסים אוטומטית.',
  },
  {
    question: 'איך עובד החיבור לוואטסאפ?',
    answer:
      'מחברים את הוואטסאפ העסקי, והשיחות נכנסות למערכת ומתחברות לליד עם מקור, סטטוס ונציג. עונים ישירות מהמערכת, ורואים מתי ההודעה נמסרה ומתי נקראה. לפנייה חוזרת אפשר לשלוח תבנית מאושרת.',
  },
  {
    question: 'אילו סטטוסים יש לליד?',
    answer:
      'חדש, בטיפול, מעוניין, סגור ואבוד. אלה הסטטוסים שהמערכת עובדת איתם בפועל. ליד שנסגר נשאר ליד, כך שאין רשימה נפרדת של לקוחות שצריך לתחזק.',
  },
  {
    question: 'מה ההבדל בין ניהול לידים באקסל לבין מערכת CRM?',
    answer:
      'אקסל מצוין לשמירת נתונים, אבל הוא לא מנהל תהליך מכירה. מערכת CRM מחברת את מקורות הלידים, שומרת את השיחה וההיסטוריה על כל ליד, מחזירה לידים לרשימת היום כשמגיע תאריך המעקב, ומחלקת את העבודה בין הנציגים.',
  },
  {
    question: 'האם ניתן לייבא לידים קיימים מאקסל?',
    answer:
      'כן. מעלים קובץ אקסל קיים, והלידים מסודרים במערכת. אפשר גם לייצא בחזרה לאקסל או ל-PDF בכל רגע, כך שהנתונים תמיד שלכם.',
  },
  {
    question: 'מה ה-AI במערכת עושה בפועל?',
    answer:
      'על כל ליד יש תקציר קצר, שתי נקודות מפתח ופעולה מומלצת עם הסיבה שלה, על סמך ההיסטוריה שנשמרה על הליד. אפשר לבקש טיוטה להודעת מעקב, לשאול מה הצעד הבא או לשאול כל שאלה על הליד. הטיוטות לא נשלחות מעצמן: הודעה יוצאת רק כשלוחצים על שליחה. המענה האוטומטי בוואטסאפ הוא תכונה נפרדת. שכבת ה-AI זמינה בתוכנית Pro.',
  },
  {
    question: 'האם SocialCRM מתאים לעסק של אדם אחד?',
    answer:
      'כן. המערכת נבנתה קודם כול לבעלי עסקים שמנהלים את הלידים בעצמם. אפשר להוסיף נציגים בהמשך, לשייך להם לידים ולחלק עמלות על עסקה משותפת, בלי להחליף תוכנית.',
  },
  {
    question: 'כמה זה עולה?',
    answer:
      TRIAL_OFFER_FAQ_ANSWER,
  },
]

/**
 * No SoftwareApplication node here on purpose.
 *
 * `softwareApplicationSchema()` in the marketing layout already emits one for
 * every marketing route, under `@id` `…/#software`. This page used to emit a
 * second node with that same `@id` (and `url: …/crm`), so the homepage shipped
 * two conflicting definitions of one entity and consumers merged them
 * arbitrarily. The layout's node is the authoritative one.
 */
const howToSchema = {
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name: 'איך מתחילים לנהל לידים לעסק קטן',
  description: 'מדריך צעד אחר צעד להתחלת ניהול לידים מסודר בעסק קטן',
  inLanguage: 'he',
  step: [
    { '@type': 'HowToStep', position: 1, name: 'אוספים את כל הלידים הקיימים', text: 'מייבאים מאקסל את הלידים הקיימים ומוסיפים ידנית פניות ממקורות אחרים, כך שהכול נמצא במקום אחד.' },
    { '@type': 'HowToStep', position: 2, name: 'מחברים את מקורות הלידים', text: 'מחברים את הדף העסקי בפייסבוק, ולידים חדשים ממודעות פייסבוק ואינסטגרם נכנסים אוטומטית.' },
    { '@type': 'HowToStep', position: 3, name: 'עובדים עם סטטוסים ברורים', text: 'לכל ליד יש סטטוס: חדש, בטיפול, מעוניין, סגור או אבוד.' },
    { '@type': 'HowToStep', position: 4, name: 'משייכים לנציגים', text: 'מחלקים את הלידים בין הנציגים, וכל נציג רואה את הלידים שלו.' },
    { '@type': 'HowToStep', position: 5, name: 'עובדים לפי רשימת היום', text: 'פותחים את המערכת בבוקר ורואים מיד למי צריך לחזור היום.' },
  ],
}

const faqSchema = buildFAQSchema(faqItems)

/**
 * `/` — the Lumen homepage, with SocialCRM content.
 *
 * Moved here from `/crm` unchanged; `/crm` is now a 308 to `/` (see
 * `next.config.mjs`). There is one homepage.
 *
 * Section order is Lumen's own
 * (`_reference/lumen-nextjs-template-1.0.0/src/app/page.tsx`), unchanged. The
 * components are Lumen's implementation; only the copy inside them is
 * SocialCRM's. Lumen's images, gradient, noise texture and motion are used
 * as shipped.
 *
 * `.lumen` scopes Lumen's design tokens so `bg-primary`, `bg-accent`,
 * `border-border` and `rounded-*` cannot reach the authenticated CRM, which
 * owns those utility names.
 */
export default function HomePage() {
  return (
    <ThemeProvider attribute='class' defaultTheme='light' enableSystem={false} disableTransitionOnChange>
    <div className='lumen' dir='rtl'>
      <JsonLd data={howToSchema} />
      <JsonLd data={faqSchema} />

      <Navbar initialBannerVisible={false} />
      <Hero />
      <Logos />
      <FeaturesCarousel />
      <FeaturesGrid />
      <FeaturesShowcase />
      <FAQSection />
      <Pricing />
      <Footer />
    </div>
    </ThemeProvider>
  )
}
