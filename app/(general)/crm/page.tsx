import { Metadata } from 'next'
import { MarketingLayout } from '@/components/seo/MarketingLayout'
import { buildFAQSchema } from '@/components/seo/FAQ'
import { FAQ } from '@/components/ui/faq-tabs'
import { HeroSection } from '@/components/ui/hero-section'
import type { HeroSectionComponentData } from '@/components/ui/hero-section'
import { Features7Section, OrbitalFeaturesSection, HowItWorksSection, StatsSection, LeadSourcesSection, FinalCTA } from '@/components/seo/CRMSections'
import dynamic from 'next/dynamic'

const TestimonialsSection = dynamic(() => import('@/components/seo/CRMSections').then(m => ({ default: m.TestimonialsSection })))
import { AnimatedCta } from '@/components/ui/animated-cta'

const heroData: HeroSectionComponentData = {
  heroContent: {
    subheadline: 'מערכת ניהול לידים לעסקים קטנים',
    headline: 'כל הלידים שלך, במקום אחד',
    description: 'לידים מפייסבוק, אינסטגרם ווואטסאפ מגיעים אוטומטית למערכת. עדכן סטטוס, שייך נציגים, וסגור יותר עסקאות. בלי לפספס אף ליד.',
    secondaryCtaText: "צפה בפיצ'רים",
    secondaryCtaLink: '/features',
    primaryCtaText: 'התחל לנהל לידים בחינם',
    primaryCtaLink: '/auth/register',
  },
  appPreview: {
    headerControls: {
      filters: [
        { label: 'נציג', icon: 'user', dropdown: true },
        { label: 'סטטוס', icon: 'info', dropdown: true },
        { label: 'תאריך', icon: 'calendar', dropdown: true },
        { label: 'מקור', icon: 'folder', dropdown: true },
      ],
      actions: [
        { type: 'button-outline', text: 'ייבוא מאקסל', icon: 'upload' },
        { type: 'button-primary', text: 'הוסף ליד', icon: 'plus' },
      ],
    },
    appDataTable: {
      headers: [
        { id: 'name', label: 'שם הליד', icon: 'document' },
        { id: 'assignee', label: 'נציג', icon: 'user' },
        { id: 'status', label: 'סטטוס', icon: 'info' },
        { id: 'dueDate', label: 'תאריך פנייה', icon: 'calendar' },
        { id: 'project', label: 'מקור', icon: 'folder' },
        { id: 'phone', label: 'טלפון', icon: 'user' },
      ],
      data: [
        { id: 1, name: 'דני לוי', assignee: ['יוסי כהן'], status: 'סגור', dueDate: '26/03/2026', project: 'פייסבוק', statusColor: 'green', phone: '050-1234567' },
        { id: 2, name: 'מיכל אברהם', assignee: ['רחל גולן'], status: 'בטיפול', dueDate: '25/03/2026', project: 'אינסטגרם', statusColor: 'blue', phone: '052-9876543' },
        { id: 3, name: 'אבי שרון', assignee: ['יוסי כהן'], status: 'ממתין למענה', dueDate: '24/03/2026', project: 'וואטסאפ', statusColor: 'yellow', phone: '054-4561230' },
        { id: 4, name: 'שרה פרץ', assignee: ['רחל גולן'], status: 'חדש', dueDate: '26/03/2026', project: 'פייסבוק', statusColor: 'blue', phone: '053-7654321' },
        { id: 5, name: 'נועם ביטון', assignee: ['יוסי כהן'], status: 'אבוד', dueDate: '20/03/2026', project: 'וואטסאפ', statusColor: 'gray', phone: '058-3219870' },
        { id: 6, name: 'תמר כץ', assignee: ['רחל גולן'], status: 'חדש', dueDate: '27/03/2026', project: 'אינסטגרם', statusColor: 'blue', phone: '050-6543210' },
        { id: 7, name: 'רון אלון', assignee: ['יוסי כהן'], status: 'בטיפול', dueDate: '26/03/2026', project: 'פייסבוק', statusColor: 'blue', phone: '052-1237890' },
      ],
    },
  },
}

export const metadata: Metadata = {
  title: 'ניהול לידים לעסקים קטנים, המדריך המלא | SocialCRM',
  description:
    'כל מה שצריך לדעת על ניהול לידים לעסקים קטנים. מה זה CRM, איך מנהלים לידים מפייסבוק ווואטסאפ, ולמה עסקים קטנים עוברים ממקסל למערכת ייעודית.',
  alternates: { canonical: 'https://socialcrm.vercel.app/crm' },
  openGraph: {
    title: 'ניהול לידים לעסקים קטנים, המדריך המלא',
    description: 'המדריך המלא לניהול לידים: מה זה CRM, איך מתחילים, ואיך לא לפספס אף עסקה.',
    url: 'https://socialcrm.vercel.app/crm',
  },
}

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
      'אקסל מספיק רק לנפחים קטנים מאוד. מערכת CRM מתחברת ישירות למקורות הלידים (פייסבוק, וואטסאפ), מאפשרת שיתוף בין נציגים, שולחת תזכורות, ומנהלת היסטוריה של כל ליד, דברים שאקסל לא יכול לעשות.',
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
  '@type': 'Article',
  '@id': 'https://socialcrm.vercel.app/crm',
  headline: 'ניהול לידים לעסקים קטנים, המדריך המלא',
  description:
    'המדריך המקיף לניהול לידים לעסקים קטנים: מה זה CRM, מאיפה מגיעים הלידים, וכיצד SocialCRM עוזרת לסגור יותר עסקאות.',
  inLanguage: 'he',
  url: 'https://socialcrm.vercel.app/crm',
  publisher: { '@id': 'https://socialcrm.vercel.app/#organization' },
  about: { '@id': 'https://socialcrm.vercel.app/#software' },
  breadcrumb: {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'דף הבית', item: 'https://socialcrm.vercel.app/auth' },
      { '@type': 'ListItem', position: 2, name: 'ניהול לידים', item: 'https://socialcrm.vercel.app/crm' },
    ],
  },
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
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(pageSchema) }} />
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(howToSchema) }} />
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />

      <MarketingLayout>
        <HeroSection data={heroData} />
        <Features7Section />
        <OrbitalFeaturesSection />
        <HowItWorksSection />
        <StatsSection />
        <LeadSourcesSection />

        <TestimonialsSection />

        <AnimatedCta
          title='מפסיקים לנהל לידים בצד'
          highlight='מתחילים לנהל אותם נכון'
          buttonText='התחל לנהל לידים בחינם'
          buttonHref='/auth/register'
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
              { question: 'מה ההבדל בין ניהול לידים באקסל לבין מערכת CRM?', answer: 'אקסל מספיק רק לנפחים קטנים מאוד. מערכת CRM מתחברת ישירות למקורות הלידים (פייסבוק, וואטסאפ), מאפשרת שיתוף בין נציגים, שולחת תזכורות, ומנהלת היסטוריה של כל ליד — דברים שאקסל לא יכול לעשות.' },
              { question: 'האם אפשר לשייך לידים לנציגים שונים?', answer: 'כן. ניתן לשייך כל ליד לנציג ספציפי. כל נציג רואה רק את הלידים שלו, והמנהל רואה הכל.' },
              { question: 'האם ניתן לעקוב אחר היסטוריה של כל ליד?', answer: 'כן. כל עדכון סטטוס, הערה ושיחה נשמרים על הליד לצמיתות. תמיד ניתן לראות מה קרה עם כל ליד.' },
            ],
            integrations: [
              { question: 'מאיפה מגיעים הלידים בדרך כלל לעסקים קטנים?', answer: 'רוב הלידים לעסקים קטנים מגיעים מפרסום בפייסבוק ואינסטגרם (Lead Ads), מהמלצות בוואטסאפ, מטפסי יצירת קשר באתר, ומפה לאוזן. SocialCRM מתמקדת בלידים ממקורות אלו.' },
              { question: 'איך מחברים פייסבוק ל-SocialCRM?', answer: 'מחברים את הדף עסקי בפייסבוק בלחיצה אחת. לאחר החיבור, כל ליד שממלא טופס Lead Ad מגיע אוטומטית למערכת תוך שניות.' },
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
