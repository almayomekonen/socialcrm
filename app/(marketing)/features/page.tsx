import Link from 'next/link'
import Icon from '@/lib/Icon'
import { buildPageMetadata } from '@/lib/seo/metadata'
import { JsonLd } from '@/components/seo/JsonLd'
import { MarketingLayout } from '@/components/seo/MarketingLayout'
import { MarketingNavbar } from '@/components/marketing/MarketingNavbar'
import { StatsSection, FinalCTA } from '@/components/seo/CRMSections'
import { FAQ } from '@/components/ui/faq-tabs'
import { buildFAQSchema } from '@/components/seo/FAQ'
import { FeatureGrid } from '@/components/ui/feature-section'
import { AnimatedCta } from '@/components/ui/animated-cta'

export const metadata = buildPageMetadata({
  path: '/features',
  title: 'מערכת ניהול לידים לעסקים קטנים | SocialCRM',
  description:
    'SocialCRM, מערכת CRM בעברית לניהול לידים מפייסבוק ואינסטגרם ומוואטסאפ. ייבוא מאקסל, מעקב מכירות, ניהול נציגים. התחל בחינם.',
  ogDescription: 'כל הלידים מפייסבוק ואינסטגרם ומוואטסאפ, במקום אחד. ניהול, מעקב, וסגירת עסקאות.',
})

const faqItems = [
  {
    question: 'מה זה מערכת CRM לעסקים קטנים?',
    answer: 'מערכת CRM לעסקים קטנים היא תוכנה שמאגדת את כל הלידים ואנשי הקשר של העסק במקום אחד. היא מאפשרת לנהל סטטוס, לשייך נציגים, לעקוב אחר התקדמות ולסגור יותר עסקאות.',
  },
  {
    question: 'האם SocialCRM מתחבר לפייסבוק?',
    answer: 'כן. SocialCRM מתחבר ישירות לדף העסקי בפייסבוק ומביא כל ליד שממלא טופס מודעה ישירות למערכת, אוטומטית, בלי העתקה ידנית.',
  },
  {
    question: 'איך מייבאים לידים מאקסל?',
    answer: 'מעלים קובץ אקסל עם עמודות שם, טלפון ומקור. המערכת מייבאת את כל הלידים בכמה שניות ומאפשרת להתחיל לעבוד מיד.',
  },
  {
    question: 'האם אפשר לנהל צוות נציגים במערכת?',
    answer: 'כן. ניתן לשייך לידים לנציגים ספציפיים, לראות את ביצועי כל נציג, ולנהל צוותי מכירות שלמים מממשק אחד.',
  },
  {
    question: 'כמה זמן לוקח להתחיל לעבוד עם המערכת?',
    answer: 'ההרשמה לוקחת פחות מדקה. ניתן להוסיף לידים ולהתחיל לעבוד מיד. חיבור לפייסבוק לוקח כ-5 דקות.',
  },
  {
    question: 'מה ההבדל בין SocialCRM למערכות CRM אחרות?',
    answer: "SocialCRM בנויה ספציפית לעסקים קטנים שמקבלים לידים ממדיה חברתית. היא פשוטה, בעברית, ומותאמת לשוק הישראלי, בלי עומס של פיצ'רים שלא צריכים.",
  },
]

const faqSchema = buildFAQSchema(faqItems)

const faqData = {
  general: [faqItems[0], faqItems[4], faqItems[5]],
  features: [faqItems[2], faqItems[3]],
  integrations: [faqItems[1]],
}

const featureCategories = [
  {
    icon: <Icon name='facebook-f' className='size-6 bg-primary' />,
    title: 'חיבור לפייסבוק ואינסטגרם',
    items: [
      { text: 'לידים מ-Lead Ads אוטומטית' },
      { text: 'חיבור לדף העסקי בלחיצה' },
      { text: 'עדכון בזמן אמת' },
    ],
  },
  {
    icon: <Icon name='whatsapp' className='size-6 bg-primary' />,
    title: 'לידים מוואטסאפ',
    items: [
      { text: 'הוספה ידנית ב-10 שניות' },
      { text: 'ייבוא מספרי טלפון' },
      { text: 'מקור מזוהה אוטומטית' },
    ],
  },
  {
    icon: <Icon name='upload' className='size-6 bg-primary' />,
    title: 'ייבוא מאקסל',
    items: [
      { text: 'העלאת קובץ קיים' },
      { text: 'מיפוי עמודות אוטומטי' },
      { text: '200 לידים תוך דקה' },
    ],
  },
  {
    icon: <Icon name='users' className='size-6 bg-primary' />,
    title: 'ניהול צוות',
    items: [
      { text: 'שיוך לידים לנציגים' },
      { text: 'כל נציג רואה רק את שלו' },
      { text: 'מנהל רואה הכל' },
    ],
  },
  {
    icon: <Icon name='circle-check' className='size-6 bg-primary' />,
    title: 'מעקב וסגירה',
    items: [
      { text: 'עדכון סטטוס בקליק' },
      { text: 'היסטוריה מלאה לכל ליד' },
      { text: 'תזכורות פולואו-אפ' },
    ],
  },
  {
    icon: <Icon name='chart-line' className='size-6 bg-primary' />,
    title: 'ביצועים ודוחות',
    items: [
      { text: 'אחוז סגירה לפי מקור' },
      { text: 'ביצועי נציגים' },
      { text: 'דוחות חודשיים' },
    ],
  },
]

export default function FeaturesPage() {
  return (
    <>
      <JsonLd data={faqSchema} />

      <MarketingLayout>

        {/* Hero */}
        <div className='relative bg-blue-50 overflow-hidden font-sans pb-8 px-4'>
          <div>
            <div className='absolute inset-0 bg-linear-to-br from-transparent via-transparent to-blue-700 opacity-50 z-0' />
            <div className='absolute bottom-0 right-0 w-3/4 h-3/4 bg-blue-600 transform origin-bottom-right rotate-12 translate-y-1/3 -translate-x-1/4 opacity-90 z-0' />
            <div className='absolute bottom-0 left-0 w-1/2 h-1/2 bg-blue-700 opacity-80 z-0' />
            <div className='absolute top-0 left-0 w-1/2 h-full bg-blue-400 transform -skew-y-6 origin-top-left -translate-y-1/4 opacity-30 z-0' />
          </div>

          <MarketingNavbar />

          <div className='relative z-10 max-w-6xl mx-auto bg-white rounded-xl shadow-2xl overflow-hidden'>
            <div className='flex flex-col items-center text-center p-8 lg:px-12 lg:pt-8 lg:pb-16' dir='rtl'>
              <span
                className='inline-block px-3 py-1 rounded-full text-xs font-semibold mb-6 text-white'
                style={{ backgroundColor: '#3f20f5' }}
              >
                הפיצ׳רים
              </span>
              <h1 className='text-4xl md:text-5xl font-bold text-gray-900 mb-6 leading-tight'>
                כל מה שצריך כדי לא לפספס אף ליד
              </h1>
              <p className='text-lg text-gray-700 mb-8 max-w-xl'>
                מרכוז, מעקב, וסגירת עסקאות מכל מקור שהלידים שלך מגיעים ממנו.
              </p>
              <div className='flex flex-col sm:flex-row items-center gap-4'>
                <Link
                  href='/crm'
                  className='w-full sm:w-auto px-8 py-4 border border-gray-300 rounded-xl text-gray-800 font-bold hover:bg-gray-50 text-sm'
                >
                  קרא עוד על ניהול לידים
                </Link>
                <Link
                  href='/auth/register'
                  className='w-full sm:w-auto px-8 py-4 rounded-xl text-white font-bold hover:scale-105 transition-all text-sm'
                  style={{ backgroundColor: '#3f20f5' }}
                >
                  התחל בחינם עכשיו
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Feature Grid */}
        <div className='bg-white'>
          <FeatureGrid
            className='pb-0'
            title={
              <span>
                כל הפיצ׳רים שצריך{' '}
                <span className='relative inline-block'>
                  לסגור יותר עסקאות
                  <svg
                    viewBox='0 0 200 6'
                    className='absolute left-0 bottom-0 -mb-1 w-full'
                    aria-hidden='true'
                  >
                    <path
                      d='M1 4.5C50 1.63 150 1.39 199 4.5'
                      stroke='#3f20f5'
                      strokeWidth='2'
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      fill='none'
                    />
                  </svg>
                </span>
              </span>
            }
            subtitle='מפייסבוק, אינסטגרם, וואטסאפ ואקסל כל הלידים שלך מנוהלים במקום אחד.'
            categories={featureCategories}
            buttonText='התחל בחינם עכשיו'
            buttonHref='/auth/register'
          />
        </div>

        {/* Animated CTA */}
        <AnimatedCta
          title='מפסיקים לפספס לידים'
          highlight='מתחילים לנהל אותם נכון'
          buttonText='התחל בחינם עכשיו'
          buttonHref='/auth/register'
        />

        {/* Stats */}
        <div className='border-b border-gray-200'>
          <StatsSection />
        </div>

        {/* FAQ */}
        <FAQ
          title='שאלות נפוצות'
          subtitle="שאלות נפוצות על המערכת"
          categories={{
            general: 'כללי',
            features: "פיצ'רים",
            integrations: 'חיבורים',
          }}
          faqData={faqData}
        />

        {/* ראה גם */}
        <section className='px-8 py-12' style={{ backgroundColor: '#0a0a0a' }} dir='rtl'>
          <div className='max-w-3xl mx-auto text-center'>
            <p className='text-white/50 text-sm mb-4'>ראה גם</p>
            <div className='flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm'>
              <Link href='/crm-for-whatsapp-business' className='text-white/80 hover:text-white underline'>
                CRM ל-WhatsApp Business
              </Link>
              <Link href='/instagram-leads-crm' className='text-white/80 hover:text-white underline'>
                CRM ללידים מאינסטגרם
              </Link>
              <Link href='/crm-vs-excel' className='text-white/80 hover:text-white underline'>
                CRM לעומת אקסל
              </Link>
            </div>
          </div>
        </section>

        {/* CTA */}
        <FinalCTA />

      </MarketingLayout>
    </>
  )
}
