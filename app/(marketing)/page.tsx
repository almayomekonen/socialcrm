import { buildPageMetadata } from '@/lib/seo/metadata'
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
import Testimonials from '@/components/lumen/sections/testimonials'
import FAQSection from '@/components/lumen/sections/faq-section'
import Pricing from '@/components/lumen/sections/pricing'

export const metadata = buildPageMetadata({
  path: '/',
  title: 'מערכת ניהול לידים לעסקים קטנים | SocialCRM',
  description:
    'SocialCRM מרכזת את כל הלידים מפייסבוק, מאינסטגרם ומוואטסאפ במקום אחד. לכל ליד יש שיחה מחוברת, סטטוס ובעלים, ובתוכנית Pro גם AI שמכיר את ההיסטוריה וממליץ על הצעד הבא. מתחילים בחינם.',
  ogDescription:
    'כל הלידים מפייסבוק, מאינסטגרם ומוואטסאפ במקום אחד, עם שיחה, סטטוס ומעקב לכל ליד. שום פנייה לא נופלת.',
})

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
      <Testimonials />
      <FAQSection />
      <Pricing />
      <Footer />
    </div>
    </ThemeProvider>
  )
}
