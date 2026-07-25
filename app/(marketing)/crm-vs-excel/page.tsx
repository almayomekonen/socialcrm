import Link from 'next/link'
import { buildPageMetadata } from '@/lib/seo/metadata'
import { JsonLd } from '@/components/seo/JsonLd'
import { MarketingLayout } from '@/components/seo/MarketingLayout'
import { MarketingNavbar } from '@/components/marketing/MarketingNavbar'
import { FinalCTA } from '@/components/seo/CRMSections'
import { FAQ } from '@/components/ui/faq-tabs'
import { AnimatedCta } from '@/components/ui/animated-cta'
import { CRMComparisonTable } from '@/components/ui/crm-comparison-table'
import { FeatureGrid } from '@/components/ui/feature-section'
import { buildFAQSchema } from '@/components/seo/FAQ'
import Icon from '@/lib/Icon'

export const metadata = buildPageMetadata({
  path: '/crm-vs-excel',
  title: 'CRM vs אקסל לניהול לידים מה עדיף? | SocialCRM',
  description:
    'משווים CRM לאקסל לניהול לידים: אינטגרציה עם פייסבוק, מעקב, תזכורות, ניהול צוות ועוד. ראה 16 נקודות השוואה ותחליט.',
  ogTitle: 'CRM vs אקסל לניהול לידים | SocialCRM',
  ogDescription: 'אקסל מספיק לניהול לידים? 16 נקודות השוואה שיגידו לך את האמת.',
})

const faqItems = [
  {
    question: 'מתי כדאי לעבור מאקסל ל-CRM?',
    answer: 'כשיש יותר מ-30 לידים בחודש, כשיש יותר מנציג אחד, או כשלידים מתחילים להישכח — זה הזמן. אם פתחת את האקסל ולא ידעת מי צריך טיפול, עברת את הגבול.',
  },
  {
    question: 'האם אפשר לייבא את הנתונים מהאקסל הישן?',
    answer: 'כן. מעלים את הקובץ הקיים ל-SocialCRM, המערכת ממפה את העמודות אוטומטית ומייבאת הכל תוך דקות. אין צורך להזין מחדש.',
  },
  {
    question: 'האם SocialCRM יקר יותר מאקסל?',
    answer: 'אקסל נראה בחינם, אבל לידים שנשכחים עולים הרבה יותר. כל ליד שהמערכת מונעת מלהיאבד — משלם את עצמה. SocialCRM מתחיל בחינם.',
  },
  {
    question: 'מה ההבדל הכי גדול בין אקסל ל-CRM?',
    answer: 'אקסל מאחסן נתונים. CRM מניע פעולה. אין לאקסל תזכורות, שיוך לנציג, או סינכרון אוטומטי מפייסבוק. זה ההבדל בין כלי כתיבה לכלי מכירות.',
  },
]

const faqSchema = buildFAQSchema(faqItems)

const pageSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': 'https://getsocialcrm.com/crm-vs-excel',
  url: 'https://getsocialcrm.com/crm-vs-excel',
  name: 'CRM vs אקסל לניהול לידים | SocialCRM',
  inLanguage: 'he',
  isPartOf: { '@id': 'https://getsocialcrm.com/#website' },
}

const faqData = {
  general: faqItems.slice(0, 2),
  decision: faqItems.slice(2),
}

const featureCategories = [
  {
    icon: <Icon name='facebook-f' className='size-6 bg-primary' />,
    title: 'ייבוא אוטומטי ממדיה חברתית',
    items: [
      { text: 'פייסבוק Lead Ads ישירות למערכת' },
      { text: 'טפסי אינסטגרם אוטומטית' },
      { text: 'ללא העתקה ידנית' },
    ],
  },
  {
    icon: <Icon name='upload' className='size-6 bg-primary' />,
    title: 'ייבוא מאקסל קיים',
    items: [
      { text: 'העלאת קובץ אקסל' },
      { text: 'מיפוי עמודות אוטומטי' },
      { text: 'ללא אובדן נתונים' },
    ],
  },
  {
    icon: <Icon name='circle-check' className='size-6 bg-primary' />,
    title: 'עדכון סטטוס ומעקב',
    items: [
      { text: 'סטטוס בקליק, מחדש ועד סגור' },
      { text: 'היסטוריה מלאה של כל ליד' },
      { text: 'תאריך מעקב לכל ליד' },
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
    icon: <Icon name='magnifying-glass' className='size-6 bg-primary' />,
    title: 'חיפוש וסינון',
    items: [
      { text: 'חיפוש לפי שם וטלפון' },
      { text: 'סינון לפי מקור, נציג, סטטוס' },
      { text: 'תצוגה מסוננת' },
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

const STATS = [
  { value: '×3', label: 'יותר לידים שנסגרים', sub: 'לעסקים שעברו מאקסל ל-CRM' },
  { value: '5 דק׳', label: 'חיסכון לכל ליד', sub: 'זמן שחוזר לטיפול עצמי' },
  { value: '0', label: 'לידים שנשכחים', sub: 'כשיש סטטוס ותאריך מעקב לכל ליד' },
]

export default function CRMvsExcelPage() {
  return (
    <>
      <JsonLd data={pageSchema} />
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
                style={{ backgroundColor: '#217346' }}
              >
                <span dir='ltr'>CRM vs אקסל</span>
              </span>
              <h1 className='text-4xl md:text-5xl font-bold text-gray-900 mb-6 leading-tight'>
                אקסל מספיק לניהול לידים?
                <br />
                <span className='text-gray-500'>הנה מה שאתה מפסיד</span>
              </h1>
              <p className='text-lg text-gray-700 mb-8 max-w-xl'>
                אקסל מצוין לנתונים. גרוע לניהול לידים. הנה 16 נקודות השוואה שמראות בדיוק איפה הפער.
              </p>
              <div className='flex flex-col sm:flex-row items-center gap-4'>
                <Link
                  href='/features'
                  className='w-full sm:w-auto px-8 py-4 border border-gray-300 rounded-xl text-gray-800 font-bold hover:bg-gray-50 text-sm'
                >
                  ראה את כל הפיצ׳רים
                </Link>
                <Link
                  href='/auth'
                  className='w-full sm:w-auto px-8 py-4 rounded-xl text-white font-bold hover:scale-105 transition-all text-sm'
                  style={{ backgroundColor: '#3f20f5' }}
                >
                  עוברים מהאקסל בחינם
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

        {/* Comparison table */}
        <div className='bg-white'>
          <CRMComparisonTable />
        </div>

        {/* Feature Grid — what SocialCRM does instead */}
        <div className='bg-white'>
          <FeatureGrid
            className='pb-0'
            title={<span>מה SocialCRM עושה <span style={{ color: '#3f20f5' }}>במקום אקסל</span></span>}
            subtitle='כל הכלים שאקסל לא נותן, בממשק אחד ומהיר.'
            categories={featureCategories}
            buttonText='עוברים מהאקסל בחינם'
            buttonHref='/auth'
          />
        </div>

        {/* Animated CTA */}
        <AnimatedCta
          title='מפסיקים לנהל לידים באקסל'
          highlight='מתחילים לנהל אותם נכון'
          buttonText='עוברים מהאקסל בחינם'
          buttonHref='/auth'
        />

        {/* FAQ */}
        <FAQ
          title='שאלות נפוצות'
          subtitle='שאלות על המעבר מאקסל ל-CRM'
          categories={{
            general: 'מתי לעבור',
            decision: 'עלות ונתונים',
          }}
          faqData={faqData}
        />

        {/* CTA */}
        <FinalCTA />

      </MarketingLayout>
    </>
  )
}
