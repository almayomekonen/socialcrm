import Link from 'next/link'
import { buildPageMetadata } from '@/lib/seo/metadata'
import { JsonLd } from '@/components/seo/JsonLd'
import { MarketingLayout } from '@/components/seo/MarketingLayout'
import { MarketingNavbar } from '@/components/marketing/MarketingNavbar'
import { FinalCTA } from '@/components/seo/CRMSections'
import { FAQ } from '@/components/ui/faq-tabs'
import { buildFAQSchema } from '@/components/seo/FAQ'
import { MagnifiedBento } from '@/components/ui/magnified-bento'
import { FeatureGrid } from '@/components/ui/feature-section'
import { AnimatedCta } from '@/components/ui/animated-cta'
import Icon from '@/lib/Icon'

export const metadata = buildPageMetadata({
  path: '/facebook-leads',
  title: 'ניהול לידים מפייסבוק, אוטומטי וחכם | SocialCRM',
  description:
    'חבר את דף הפייסבוק שלך ל-SocialCRM וקבל כל ליד שממלא טופס מודעה, ישירות למערכת, אוטומטית. בלי העתקה ידנית, בלי שכחה.',
  ogDescription: 'לידים מטפסי פייסבוק מגיעים ישירות למערכת. חיבור של 5 דקות, חיסכון של שעות.',
})

const faqItems = [
  {
    question: 'איך מחברים לידים מפייסבוק למערכת?',
    answer:
      'נכנסים להגדרות, בוחרים "חבר פייסבוק", ומתחברים עם חשבון הפייסבוק העסקי. מאותו רגע כל ליד שממלא טופס מגיע אוטומטית למערכת.',
  },
  {
    question: 'כמה זמן לוקח להגדיר את האינטגרציה עם פייסבוק?',
    answer: 'כ-5 דקות. מתחברים עם חשבון פייסבוק, בוחרים את הדף העסקי, ומאשרים הרשאות. זהו.',
  },
  {
    question: 'האם כל הלידים מפייסבוק מגיעים אוטומטית?',
    answer:
      'כן. כל ליד שממלא טופס Lead Ad בפייסבוק מגיע למערכת תוך שניות, כולל השם, הטלפון, ופרטים נוספים שהגדרת בטופס.',
  },
  {
    question: 'האם אפשר לחבר כמה דפי פייסבוק?',
    answer: 'כן. ניתן לחבר מספר דפי פייסבוק לאותה מערכת. כל ליד מזוהה לפי הדף שממנו הגיע.',
  },
  {
    question: 'מה קורה אם הקישור לפייסבוק מתנתק?',
    answer: 'המערכת מזהה ניתוק ומיידעת אותך. ניתן לחבר מחדש בלחיצה אחת מהגדרות החשבון.',
  },
  {
    question: 'האם SocialCRM עובד עם מודעות Lead Ads בפייסבוק?',
    answer:
      'כן. SocialCRM מתחבר ישירות ל-Facebook Lead Ads API ומביא כל ליד חדש שמגיע מטפסי המודעות שלך.',
  },
]

const faqSchema = buildFAQSchema(faqItems)

const howToSchema = {
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name: 'איך לחבר לידים מפייסבוק ל-SocialCRM',
  description: 'מדריך לחיבור לידים מפייסבוק Lead Ads ישירות ל-SocialCRM',
  inLanguage: 'he',
  step: [
    { '@type': 'HowToStep', position: 1, name: 'נרשמים ל-SocialCRM', text: 'יוצרים חשבון ב-SocialCRM עם חשבון גוגל.' },
    { '@type': 'HowToStep', position: 2, name: 'נכנסים להגדרות פייסבוק', text: 'בתפריט ההגדרות בוחרים "חיבור פייסבוק".' },
    { '@type': 'HowToStep', position: 3, name: 'מתחברים עם חשבון פייסבוק', text: 'מאשרים הרשאות לפייסבוק ובוחרים את הדף העסקי.' },
    { '@type': 'HowToStep', position: 4, name: 'לידים מגיעים אוטומטית', text: 'מעכשיו כל ליד שממלא טופס מגיע ישירות למערכת.' },
  ],
}

const webPageSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': 'https://getsocialcrm.com/facebook-leads',
  url: 'https://getsocialcrm.com/facebook-leads',
  name: 'ניהול לידים מפייסבוק, SocialCRM',
  inLanguage: 'he',
  isPartOf: { '@id': 'https://getsocialcrm.com/#website' },
  breadcrumb: {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'דף הבית', item: 'https://getsocialcrm.com/' },
      { '@type': 'ListItem', position: 2, name: 'ניהול לידים מפייסבוק', item: 'https://getsocialcrm.com/facebook-leads' },
    ],
  },
}

const faqData = {
  general: faqItems.slice(0, 3),
  setup: faqItems.slice(3),
}

const STATS = [
  { value: '5 דק׳', label: 'להגדיר את החיבור', sub: 'ואז הכל מגיע אוטומטית' },
  { value: '0', label: 'לידים שנשכחים', sub: 'כשהם מגיעים ישירות למערכת' },
  { value: '×3', label: 'יותר לידים נסגרים', sub: 'לעסקים שמחברים פייסבוק' },
]

const featureCategories = [
  {
    icon: <Icon name='facebook-f' className='size-6 bg-primary' />,
    title: 'לידים מפייסבוק',
    items: [
      { text: 'קבלה אוטומטית מ-Lead Ads' },
      { text: 'חיבור לדף העסקי' },
      { text: 'זיהוי הדף שממנו הגיע הליד' },
    ],
  },
  {
    icon: <Icon name='instagram' className='size-6 bg-primary' />,
    title: 'לידים מאינסטגרם',
    items: [
      { text: 'טפסי מודעות אינסטגרם' },
      { text: 'כל מודעה באינסטגרם, אוטומטית' },
      { text: 'עדכון אוטומטי בזמן אמת' },
    ],
  },
  {
    icon: <Icon name='whatsapp' className='size-6 bg-primary' />,
    title: 'לידים מוואטסאפ',
    items: [
      { text: 'לידים מקישורי וואטסאפ' },
      { text: 'כל שיחה נשמרת על הליד' },
      { text: 'רואים מתי ההודעה נקראה' },
    ],
  },
  {
    icon: <Icon name='upload' className='size-6 bg-primary' />,
    title: 'ייבוא מאקסל',
    items: [
      { text: 'העלאת קובץ אקסל קיים' },
      { text: 'מיפוי עמודות אוטומטי' },
      { text: '200 לידים תוך פחות מדקה' },
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
    icon: <Icon name='chart-line' className='size-6 bg-primary' />,
    title: 'מעקב וביצועים',
    items: [
      { text: 'אחוז סגירה לפי מקור' },
      { text: 'ביצועי נציגים' },
      { text: 'דוחות חודשיים' },
    ],
  },
]

export default function FacebookLeadsPage() {
  return (
    <>
      <JsonLd data={faqSchema} />
      <JsonLd data={howToSchema} />
      <JsonLd data={webPageSchema} />

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
                style={{ backgroundColor: '#1877F2' }}
              >
                פייסבוק Lead Ads
              </span>
              <h1 className='text-4xl md:text-5xl font-bold text-gray-900 mb-6 leading-tight'>
                לידים מפייסבוק, ישירות למערכת, אוטומטית
              </h1>
              <p className='text-lg text-gray-700 mb-8 max-w-xl'>
                מחברים את דף הפייסבוק פעם אחת, וכל ליד שממלא טופס מודעה נכנס ישר למערכת. בלי העתקות, בלי לפספס אף אחד.
              </p>
              <div className='flex flex-col sm:flex-row items-center gap-4'>
                <Link
                  href='/crm'
                  className='w-full sm:w-auto px-8 py-4 border border-gray-300 rounded-xl text-gray-800 font-bold hover:bg-gray-50 text-sm'
                >
                  ראה איך זה עובד
                </Link>
                <Link
                  href='/auth'
                  className='w-full sm:w-auto px-8 py-4 rounded-xl text-white font-bold hover:scale-105 transition-all text-sm'
                  style={{ backgroundColor: '#3f20f5' }}
                >
                  חבר את הפייסבוק שלך עכשיו
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <section className='px-8 py-14' style={{ backgroundColor: '#0a0a0a' }}>
          <div className='max-w-5xl mx-auto' dir='rtl'>
            <div className='grid grid-cols-1 md:grid-cols-3 gap-6'>
              {STATS.map((s) => (
                <div
                  key={s.value}
                  className='rounded-2xl p-8 text-center'
                  style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.07)' }}
                >
                  <p className='text-5xl font-bold text-white mb-2'>{s.value}</p>
                  <p className='text-white font-semibold mb-1'>{s.label}</p>
                  <p className='text-white/40 text-sm'>{s.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* MagnifiedBento */}
        <section className='px-8 py-16' style={{ backgroundColor: '#0a0a0a' }}>
          <div className='max-w-5xl mx-auto mb-10 text-center' dir='rtl'>
            <h2 className='text-3xl font-bold text-white mb-3'>כל הלידים שלך, ממקום אחד</h2>
            <p className='text-white/50 max-w-xl mx-auto'>מפייסבוק, אינסטגרם, וואטסאפ ואקסל הכל מגיע ישירות למערכת.</p>
          </div>
          <div className='max-w-5xl mx-auto flex justify-center'>
            <MagnifiedBento />
          </div>
        </section>

        {/* Feature Grid */}
        <div className='bg-white'>
        <FeatureGrid
          className='pb-0'
          title={
            <span>
              כל מה שצריך כדי{' '}
              <span className='relative inline-block'>
                לא לפספס ליד
                <svg
                  viewBox='0 0 160 6'
                  className='absolute left-0 bottom-0 -mb-1 w-full'
                  aria-hidden='true'
                >
                  <path
                    d='M1 4.5C34 1.63 126 1.39 159 4.5'
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
          buttonHref='/auth'
        />
        </div>

        {/* Animated CTA */}
        <AnimatedCta
          title='מפסיקים לפספס לידים מפייסבוק'
          highlight='מתחילים לקבל אותם אוטומטית'
          buttonText='חבר את הפייסבוק שלך עכשיו'
          buttonHref='/auth'
        />

        {/* FAQ */}
        <FAQ
          title='שאלות נפוצות'
          subtitle='שאלות על חיבור פייסבוק'
          categories={{
            general: 'כללי',
            setup: 'הגדרה וחיבור',
          }}
          faqData={faqData}
        />

        {/* ראה גם */}
        <section className='px-8 py-12' style={{ backgroundColor: '#0a0a0a' }} dir='rtl'>
          <div className='max-w-3xl mx-auto text-center'>
            <p className='text-white/50 text-sm mb-4'>ראה גם</p>
            <div className='flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm'>
              <Link href='/instagram-leads-crm' className='text-white/80 hover:text-white underline'>
                CRM ללידים מאינסטגרם
              </Link>
              <Link href='/crm-for-whatsapp-business' className='text-white/80 hover:text-white underline'>
                CRM ל-WhatsApp Business
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
