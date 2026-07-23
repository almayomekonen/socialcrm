import Link from 'next/link'
import { buildPageMetadata } from '@/lib/seo/metadata'
import { JsonLd } from '@/components/seo/JsonLd'
import { MarketingLayout } from '@/components/seo/MarketingLayout'
import { MarketingNavbar } from '@/components/marketing/MarketingNavbar'
import { FinalCTA } from '@/components/seo/CRMSections'
import { FAQ } from '@/components/ui/faq-tabs'
import { AnimatedCta } from '@/components/ui/animated-cta'
import { MagnifiedBento } from '@/components/ui/magnified-bento'
import { FeatureGrid } from '@/components/ui/feature-section'
import { buildFAQSchema } from '@/components/seo/FAQ'
import Icon from '@/lib/Icon'
import { Btn } from '@/lib/btns/Btn'

export const metadata = buildPageMetadata({
  path: '/whatsapp-leads',
  title: 'ניהול לידים מוואטסאפ | SocialCRM',
  description:
    'ייבא ונהל לידים שמגיעים בוואטסאפ. הוסף ידנית, ייבא מספרים, ונהל הכל מתוך SocialCRM, מערכת ניהול לידים לעסקים קטנים.',
  ogDescription: 'לידים מוואטסאפ? מייבאים, מנהלים, ומוודאים שאף אחד לא נשכח.',
})

const faqItems = [
  {
    question: 'איך מייבאים לידים מוואטסאפ ל-SocialCRM?',
    answer: 'ניתן להוסיף לידים מוואטסאפ בשתי דרכים: הוספה ידנית מהירה (שם + טלפון בשניות), או ייבוא מאקסל אם יש רשימה של מספרים.',
  },
  {
    question: 'האם יש אינטגרציה ישירה עם וואטסאפ?',
    answer: 'SocialCRM לא קוראת את ההודעות בוואטסאפ. במקום זאת, מוסיפים לידים מוואטסאפ ידנית (מהיר מאוד) ואז כל התקשורת והמעקב מתנהלים בתוך SocialCRM.',
  },
  {
    question: 'מהי הדרך הכי מהירה להוסיף ליד מוואטסאפ?',
    answer: 'לוחצים "הוסף ליד", מזינים שם ומספר טלפון (10 שניות), ובוחרים מקור "וואטסאפ". הליד מיד מופיע ברשימה ומחכה לטיפול.',
  },
  {
    question: 'איך מבדילים בין לידים מוואטסאפ ללידים מפייסבוק?',
    answer: 'כל ליד ב-SocialCRM מוגדר עם מקור. ניתן לסנן ולראות רק לידים מוואטסאפ, רק מפייסבוק, או הכל יחד.',
  },
  {
    question: 'מה עושים עם ליד שפנה בוואטסאפ ולא מוכר לקנות עכשיו?',
    answer: 'מוסיפים תזכורת, "לחזור עוד שבועיים". המערכת תזכיר. כך לא מפספסים לידים שרק צריכים יותר זמן.',
  },
]

const faqSchema = buildFAQSchema(faqItems)

const pageSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': 'https://getsocialcrm.com/whatsapp-leads',
  url: 'https://getsocialcrm.com/whatsapp-leads',
  name: 'ניהול לידים מוואטסאפ | SocialCRM',
  inLanguage: 'he',
  isPartOf: { '@id': 'https://getsocialcrm.com/#website' },
}

const faqData = {
  general: faqItems.slice(0, 3),
  setup: faqItems.slice(3),
}

const STATS = [
  { value: '10 שנ׳', label: 'להוסיף ליד חדש', sub: 'שם, טלפון, מקור — וסיימנו' },
  { value: '0', label: 'לידים שנשכחים', sub: 'כשיש תזכורות ומעקב' },
  { value: '×3', label: 'יותר לידים נסגרים', sub: 'לעסקים שעברו לניהול ממוקד' },
]

const featureCategories = [
  {
    icon: <Icon name='whatsapp' className='size-6 bg-primary' />,
    title: 'הוספת לידים מוואטסאפ',
    items: [
      { text: 'הוספה ידנית ב-10 שניות' },
      { text: 'ייבוא מספרי טלפון' },
      { text: 'מקור מוואטסאפ מזוהה' },
    ],
  },
  {
    icon: <Icon name='upload' className='size-6 bg-primary' />,
    title: 'ייבוא מאקסל',
    items: [
      { text: 'קובץ אקסל קיים' },
      { text: 'מיפוי עמודות אוטומטי' },
      { text: '200 לידים תוך דקה' },
    ],
  },
  {
    icon: <Icon name='circle-check' className='size-6 bg-primary' />,
    title: 'מעקב וסטטוס',
    items: [
      { text: 'עדכון סטטוס בקליק' },
      { text: 'היסטוריה מלאה' },
      { text: 'ראה מי ממתין לטיפול' },
    ],
  },
  {
    icon: <Icon name='bell' className='size-6 bg-primary' />,
    title: 'תזכורות ומעקב',
    items: [
      { text: 'קבע תזכורת לכל ליד' },
      { text: 'אל תפספס פולואו-אפ' },
      { text: 'התראות על לידים שלא טופלו' },
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
    title: 'ביצועים',
    items: [
      { text: 'אחוז סגירה לפי מקור' },
      { text: 'ביצועי נציגים' },
      { text: 'דוחות חודשיים' },
    ],
  },
]

export default function WhatsAppLeadsPage() {
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
                style={{ backgroundColor: '#25D366' }}
              >
                וואטסאפ
              </span>
              <h1 className='text-4xl md:text-5xl font-bold text-gray-900 mb-6 leading-tight'>
                כל הפניות מ־WhatsApp במקום אחד
                <br />
                מנהלים כל שיחה וכל ליד בקלות
              </h1>
              <p className='text-lg text-gray-700 mb-8 max-w-xl'>
                לידים שמגיעים בוואטסאפ נשכחים בקלות בתוך ערימת ההודעות. SocialCRM נותנת להם מקום, ומוודאת שכל אחד מטופל.
              </p>
              <div className='flex flex-col sm:flex-row items-center gap-4'>
                <Link
                  href='/features'
                  className='w-full sm:w-auto px-8 py-4 border border-gray-300 rounded-xl text-gray-800 font-bold hover:bg-gray-50 text-sm'
                >
                  ראה את כל הפיצ׳רים
                </Link>
                <Btn
                  href='/auth'
                  lbl='התחל לנהל לידים מוואטסאפ'
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

        {/* MagnifiedBento — interactive */}
        <section className='px-8 py-16' style={{ backgroundColor: '#0a0a0a' }}>
          <div className='max-w-5xl mx-auto mb-10 text-center' dir='rtl'>
            <h2 className='text-3xl font-bold text-white mb-3'>כל ליד מוואטסאפ, מנוהל נכון</h2>
            <p className='text-white/50 max-w-xl mx-auto'>מרשימת הודעות כאוטית לרשימה ברורה עם סטטוס, נציג ומעקב.</p>
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
            subtitle='מוואטסאפ, אקסל וייבוא ידני כל הלידים שלך מנוהלים במקום אחד.'
            categories={featureCategories}
            buttonText='התחל לנהל לידים מוואטסאפ'
            buttonHref='/auth'
          />
        </div>

        {/* Animated CTA */}
        <AnimatedCta
          title='כל הלידים במקום אחד'
          highlight='כל העסק בשליטה אחת'
          buttonText='התחל בחינם עכשיו'
          buttonHref='/auth'
        />

        {/* FAQ */}
        <FAQ
          title='שאלות נפוצות'
          subtitle='שאלות על ניהול לידים מוואטסאפ'
          categories={{
            general: 'כללי',
            setup: 'הוספה וייבוא',
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
