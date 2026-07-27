import { buildPageMetadata } from '@/lib/seo/metadata'
import { JsonLd } from '@/components/seo/JsonLd'
import { MarketingLayout } from '@/components/seo/MarketingLayout'
import { buildFAQSchema } from '@/components/seo/FAQ'
import { FAQ } from '@/components/ui/faq-tabs'
import { HeroSection } from '@/components/ui/hero/HeroSection'
import { Features7Section, OrbitalFeaturesSection, HowItWorksSection, StatsSection, LeadSourcesSection, FinalCTA } from '@/components/seo/CRMSections'
import dynamic from 'next/dynamic'

const TestimonialsSection = dynamic(() => import('@/components/seo/CRMSections').then(m => ({ default: m.TestimonialsSection })))
import { AnimatedCta } from '@/components/ui/animated-cta'

export const metadata = buildPageMetadata({
  path: '/crm',
  title: 'מערכת ניהול לידים לעסקים קטנים | SocialCRM',
  description:
    'SocialCRM מרכזת את כל הלידים מפייסבוק, מאינסטגרם ומוואטסאפ במקום אחד. לכל ליד יש שיחה מחוברת, סטטוס ובעלים, ובתוכנית Pro גם AI שמכיר את ההיסטוריה וממליץ על הצעד הבא. מתחילים בחינם.',
  ogDescription:
    'כל הלידים מפייסבוק, מאינסטגרם ומוואטסאפ במקום אחד, עם שיחה, סטטוס ומעקב לכל ליד. שום פנייה לא נופלת.',
  canonical: 'https://getsocialcrm.com/',
})

const faqItems = [
  {
    question: 'מה זה ניהול לידים?',
    answer:
      'ניהול לידים הוא תהליך של איסוף, ארגון ומעקב אחר פניות של לקוחות פוטנציאליים. המטרה היא לוודא שכל ליד מטופל בזמן ולא נשכח, עד לסגירת עסקה או להחלטה שהוא לא רלוונטי.',
  },
  {
    question: 'מה זה CRM?',
    answer:
      'CRM (Customer Relationship Management) הוא מערכת לניהול קשרי לקוחות. עבור עסקים קטנים, CRM היא בדרך כלל תוכנה שמאגדת את כל הלידים ואנשי הקשר, מאפשרת לעדכן סטטוס, לשייך נציגים ולעקוב אחר ההתקדמות.',
  },
  {
    question: 'מדוע עסקים קטנים צריכים מערכת ניהול לידים?',
    answer:
      'בלי מערכת, לידים מגיעים מכל מקום, פייסבוק, וואטסאפ, מייל, אינסטגרם, ומפוזרים. קשה לדעת מי טופל ומי לא, מי צריך מעקב, ומה המצב של כל ליד. מערכת CRM פותרת את הבעיה הזו באופן מלא.',
  },
  {
    question: 'מה ההבדל בין ניהול לידים באקסל לבין מערכת CRM?',
    answer:
      'אקסל מצוין לאחסון, אבל הוא לא מנהל תהליך מכירה. מערכת CRM מחברת את מקורות הלידים, שומרת את השיחה וההיסטוריה על כל ליד, שולחת תזכורות ומחלקת עבודה בין נציגים. זה ההבדל בין רשימה סטטית לבין תהליך חי.',
  },
  {
    question: 'מאיפה מגיעים הלידים בדרך כלל לעסקים קטנים?',
    answer:
      'רוב הלידים לעסקים קטנים מגיעים מפרסום בפייסבוק ואינסטגרם (Lead Ads), מהמלצות בוואטסאפ, מטפסי יצירת קשר באתר, ומפה לאוזן. SocialCRM מתמקדת בלידים ממקורות אלו.',
  },
  {
    question: 'כמה זמן לוקח ליד להפוך ל"קר" ולא שמיש?',
    answer:
      'מחקרים מראים שסיכוי יצירת קשר מוצלח יורד ב-80% תוך 5 דקות מהפניה, וב-90% תוך שעה. לכן מהירות המענה היא הגורם הקריטי ביותר בניהול לידים.',
  },
  {
    question: 'האם SocialCRM מתאים לעסק של אדם אחד?',
    answer:
      'בהחלט. SocialCRM מתוכנן קודם כל לבעל עסק יחיד שמנהל לידים בעצמו. ניתן להוסיף נציגים בהמשך, אבל גם לבד המערכת שווה הרבה.',
  },
  {
    question: 'האם אפשר לנסות את SocialCRM בחינם?',
    answer:
      'כן. ניתן להירשם ולהתחיל לעבוד עם המערכת ללא עלות. אין צורך בכרטיס אשראי להתחלה.',
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

      <MarketingLayout>
        <HeroSection />
        <Features7Section />
        <OrbitalFeaturesSection />
        <HowItWorksSection />
        <StatsSection />
        <LeadSourcesSection />

        <TestimonialsSection />

        <AnimatedCta
          title='כל הלידים במקום אחד'
          highlight='כל העסק בשליטה אחת'
          buttonText='התחל לנהל לידים בחינם'
          buttonHref='/auth'
        />

        <FAQ
          title='שאלות נפוצות'
          subtitle='שאלות נפוצות על ניהול לידים'
          categories={{
            general: 'כללי',
            features: 'פיצ׳רים',
            integrations: 'חיבורים',
            pricing: 'תמחור',
          }}
          faqData={{
            general: [
              { question: 'מה זה ניהול לידים?', answer: 'ניהול לידים הוא תהליך של איסוף, ארגון ומעקב אחר פניות של לקוחות פוטנציאליים. המטרה היא לוודא שכל ליד מטופל בזמן ולא נשכח, עד לסגירת עסקה או להחלטה שהוא לא רלוונטי.' },
              { question: 'מה זה CRM?', answer: 'CRM (Customer Relationship Management) הוא מערכת לניהול קשרי לקוחות. עבור עסקים קטנים, CRM היא בדרך כלל תוכנה שמאגדת את כל הלידים ואנשי הקשר, מאפשרת לעדכן סטטוס, לשייך נציגים ולעקוב אחר ההתקדמות.' },
              { question: 'מדוע עסקים קטנים צריכים מערכת ניהול לידים?', answer: 'בלי מערכת, לידים מגיעים מכל מקום פייסבוק, וואטסאפ, מייל, אינסטגרם ומפוזרים. קשה לדעת מי טופל ומי לא, מי צריך מעקב, ומה המצב של כל ליד. מערכת CRM פותרת את הבעיה הזו באופן מלא.' },
              { question: 'כמה זמן לוקח ליד להפוך ל"קר"?', answer: 'מחקרים מראים שסיכוי יצירת קשר מוצלח יורד ב-80% תוך 5 דקות מהפניה, וב-90% תוך שעה. לכן מהירות המענה היא הגורם הקריטי ביותר בניהול לידים.' },
            ],
            features: [
              { question: 'מה ההבדל בין ניהול לידים באקסל לבין מערכת CRM?', answer: 'אקסל מצוין לאחסון, אבל הוא לא מנהל תהליך מכירה. מערכת CRM מחברת את מקורות הלידים, שומרת את השיחה וההיסטוריה על כל ליד, שולחת תזכורות ומחלקת עבודה בין נציגים. זה ההבדל בין רשימה סטטית לבין תהליך חי.' },
              { question: 'האם אפשר לשייך לידים לנציגים שונים?', answer: 'כן. ניתן לשייך כל ליד לנציג ספציפי. כל נציג רואה רק את הלידים שלו, והמנהל רואה הכל.' },
              { question: 'האם ניתן לעקוב אחר היסטוריה של כל ליד?', answer: 'כל שיחה, עדכון סטטוס והערה נשמרים על הליד עצמו. גם כשנציג מתחלף, ההקשר המלא נשאר במקום, ותמיד יודעים מה קרה ומה השלב הבא.' },
            ],
            integrations: [
              { question: 'מאיפה מגיעים הלידים בדרך כלל לעסקים קטנים?', answer: 'רוב הלידים לעסקים קטנים מגיעים מפרסום בפייסבוק ואינסטגרם (Lead Ads), מהמלצות בוואטסאפ, מטפסי יצירת קשר באתר, ומפה לאוזן. SocialCRM מתמקדת בלידים ממקורות אלו.' },
              { question: 'איך מחברים פייסבוק למערכת?', answer: 'מחברים את הדף העסקי בפייסבוק בלחיצה אחת. לאחר החיבור, כל ליד שממלא טופס Lead Ad מגיע אוטומטית למערכת תוך שניות.' },
              { question: 'האם ניתן לייבא לידים מאקסל?', answer: 'כן. ניתן להעלות קובץ אקסל קיים ובשניות כל הלידים מאורגנים במערכת. מושלם לעסקים שמתחילים לעבוד עם המערכת עם לידים קיימים.' },
            ],
            pricing: [
              { question: 'האם SocialCRM מתאים לעסק של אדם אחד?', answer: 'בהחלט. SocialCRM מתוכנן קודם כל לבעל עסק יחיד שמנהל לידים בעצמו. ניתן להוסיף נציגים בהמשך, אבל גם לבד המערכת שווה הרבה.' },
              { question: 'האם אפשר לנסות את SocialCRM בחינם?', answer: 'כן. ניתן להירשם ולהתחיל לעבוד עם המערכת ללא עלות. אין צורך בכרטיס אשראי להתחלה.' },
            ],
          }}
        />
        <FinalCTA />
      </MarketingLayout>
    </>
  )
}
