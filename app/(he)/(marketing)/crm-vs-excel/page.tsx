import Link from 'next/link'
import { buildPageMetadata } from '@/lib/seo/metadata'
import { PRICING, TRIAL_CTA_LABEL } from '@/lib/pricing'
import { TRIAL_LENGTH_DAYS } from '@/lib/trial'
import { JsonLd } from '@/components/seo/JsonLd'
import { MarketingLayout } from '@/components/seo/MarketingLayout'
import { FinalCTA } from '@/components/seo/CRMSections'
import { FAQ } from '@/components/ui/faq-tabs'
import { AnimatedCta } from '@/components/ui/animated-cta'
import { CRMComparisonTable } from '@/components/ui/crm-comparison-table'
import { FeatureGrid } from '@/components/ui/feature-section'
import { buildFAQSchema } from '@/components/seo/FAQ'
import Icon from '@/lib/Icon'
import { Btn } from '@/lib/btns/Btn'

export const metadata = buildPageMetadata({
  path: '/crm-vs-excel',
  title: 'CRM מול אקסל לניהול לידים: מה עדיף? | SocialCRM',
  description:
    'אקסל מעולה לאחסון, אבל לא לניהול תהליך מכירה. 16 נקודות השוואה על חיבור לפייסבוק, מעקב, תזכורות וניהול צוות, שיעזרו לכם להחליט מתי לעבור.',
  ogTitle: 'CRM מול אקסל לניהול לידים | SocialCRM',
  ogDescription: 'אקסל מספיק לניהול לידים? 16 נקודות השוואה שיעזרו לכם להחליט.',
})

const faqItems = [
  {
    question: 'מתי כדאי לעבור מאקסל למערכת CRM?',
    answer: 'כשיש יותר משלושים לידים בחודש, כשיש יותר מנציג אחד, או כשלידים מתחילים להישכח. אם פתחתם את האקסל ולא ידעתם מי צריך טיפול, עברתם את הגבול.',
  },
  {
    question: 'האם אפשר לייבא את הנתונים מהאקסל הישן?',
    answer: 'כן. מעלים את הקובץ הקיים, המערכת ממפה את העמודות אוטומטית ומייבאת הכול בתוך דקות, בלי להקליד מחדש.',
  },
  {
    question: 'האם SocialCRM יקרה יותר מאקסל?',
    answer: `אקסל נראה חינמי, אבל לידים שנשכחים עולים הרבה יותר, וליד אחד שנסגר יכול לכסות את עלות המנוי. מתחילים ב-${TRIAL_LENGTH_DAYS} ימי ניסיון ללא חיוב (נדרש כרטיס אשראי), ולאחר מכן ${PRICING.currency}${PRICING.monthly} לחודש עד לביטול.`,
  },
  {
    question: 'מה ההבדל הכי גדול בין אקסל למערכת CRM?',
    answer: 'אקסל שומר נתונים, ו-CRM מניע פעולה. לאקסל אין תזכורות, שיוך לנציג או סנכרון אוטומטי עם פייסבוק. זה ההבדל בין גיליון נתונים לכלי מכירות.',
  },
]

const faqSchema = buildFAQSchema(faqItems)

const pageSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': 'https://getsocialcrm.com/crm-vs-excel',
  url: 'https://getsocialcrm.com/crm-vs-excel',
  name: 'CRM מול אקסל לניהול לידים | SocialCRM',
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
      { text: 'לידים מ-Lead Ads של פייסבוק ישירות למערכת' },
      { text: 'טפסי לידים מאינסטגרם, אוטומטית' },
      { text: 'בלי העתקה ידנית' },
    ],
  },
  {
    icon: <Icon name='upload' className='size-6 bg-primary' />,
    title: 'ייבוא מאקסל קיים',
    items: [
      { text: 'העלאת קובץ אקסל' },
      { text: 'מיפוי עמודות אוטומטי' },
      { text: 'בלי להקליד הכול מחדש' },
    ],
  },
  {
    icon: <Icon name='circle-check' className='size-6 bg-primary' />,
    title: 'עדכון סטטוס ומעקב',
    items: [
      { text: 'סטטוס בלחיצה, מחדש ועד סגור' },
      { text: 'היסטוריה מלאה של כל ליד' },
      { text: 'תאריך מעקב לכל ליד' },
    ],
  },
  {
    icon: <Icon name='users' className='size-6 bg-primary' />,
    title: 'ניהול צוות',
    items: [
      { text: 'שיוך לידים לנציגים' },
      { text: 'כל נציג רואה את הלידים שלו' },
      { text: 'מנהל רואה את כולם' },
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
      { text: 'ביצועים לפי תקופה' },
    ],
  },
]

const STATS = [
  { value: '16', label: 'נקודות השוואה', sub: 'מייבוא הלידים ועד ביצועי הנציגים' },
  { value: '5', label: 'סטטוסים ברורים לכל ליד', sub: 'חדש, בטיפול, מעוניין, סגור ואבוד' },
  { value: '1', label: 'רשימה לכל הלידים', sub: 'מפייסבוק, מאינסטגרם, מוואטסאפ ומאקסל' },
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


          <div className='relative z-10 max-w-6xl mx-auto bg-white rounded-xl shadow-2xl overflow-hidden'>
            <div className='flex flex-col items-center text-center p-8 lg:px-12 lg:pt-8 lg:pb-16' dir='rtl'>
              <span
                className='inline-block px-3 py-1 rounded-full text-xs font-semibold mb-6 text-white'
                style={{ backgroundColor: '#217346' }}
              >
                CRM מול אקסל
              </span>
              <h1 className='text-4xl md:text-5xl font-bold text-gray-900 mb-6 leading-tight'>
                מפסיקים לנהל לידים באקסל
                <br />
                <span className='text-gray-500'>עוברים למערכת שבאמת בנויה למכירות</span>
              </h1>
              <p className='text-lg text-gray-700 mb-8 max-w-xl'>
                אקסל מצוין לשמירת נתונים, אבל ניהול לידים הוא תהליך חי. הנה 16 נקודות השוואה שמראות בדיוק איפה עובר הגבול.
              </p>
              <div className='flex flex-col sm:flex-row items-center gap-4'>
                <Link
                  href='/'
                  className='w-full sm:w-auto px-8 py-4 border border-gray-300 rounded-xl text-gray-800 font-bold hover:bg-gray-50 text-sm'
                >
                  לכל היכולות
                </Link>
                <Btn
                  href='/auth/register'
                  lbl={TRIAL_CTA_LABEL}
                  className='w-full sm:w-auto h-auto px-8 py-4 rounded-xl text-white font-bold hover:scale-105 transition-all text-sm'
                  style={{ backgroundColor: '#3f20f5' }}
                />
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
            buttonText={TRIAL_CTA_LABEL}
            buttonHref='/auth'
          />
        </div>

        {/* Animated CTA */}
        <AnimatedCta
          title='מפסיקים לנהל לידים באקסל'
          highlight='עוברים למערכת שבאמת בנויה למכירות'
          buttonText={TRIAL_CTA_LABEL}
          buttonHref='/auth'
        />

        {/* FAQ */}
        <FAQ
          title='שאלות נפוצות'
          subtitle='שאלות על המעבר מאקסל למערכת'
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
