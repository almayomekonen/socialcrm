import Link from 'next/link'
import { buildPageMetadata } from '@/lib/seo/metadata'
import { JsonLd } from '@/components/seo/JsonLd'
import { breadcrumbSchema, webPageSchema } from '@/lib/seo/schemas'
import { MarketingLayout } from '@/components/seo/MarketingLayout'
import { MarketingNavbar } from '@/components/marketing/MarketingNavbar'
import { FinalCTA } from '@/components/seo/CRMSections'
import { FAQ } from '@/components/ui/faq-tabs'
import { AnimatedCta } from '@/components/ui/animated-cta'
import { FeatureGrid } from '@/components/ui/feature-section'
import { buildFAQSchema } from '@/components/seo/FAQ'
import Icon from '@/lib/Icon'
import { Btn } from '@/lib/btns/Btn'

const PAGE_PATH = '/instagram-leads-crm'
const PAGE_TITLE = 'ניהול לידים ממודעות אינסטגרם | SocialCRM'
const PAGE_DESCRIPTION =
  'מודעות אינסטגרם מביאות לידים ישר למערכת, אוטומטית. פנייה במסר או תגובה לסטורי מתווספות בשניות. הכל במקום אחד עם מקור, סטטוס ומעקב.'

export const metadata = buildPageMetadata({
  path: PAGE_PATH,
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  ogTitle: 'לידים ממודעות אינסטגרם | SocialCRM',
  ogDescription: 'מודעות אינסטגרם מביאות לידים ישר למערכת, אוטומטית. הכל במקום אחד עם מקור, סטטוס ומעקב.',
})

const faqItems = [
  {
    question: 'האם SocialCRM מייבא אוטומטית הודעות מאינסטגרם?',
    answer:
      'Instagram לא מאפשר למערכות חיצוניות לקרוא את תוכן ההודעות, אז פניות במסר מוסיפים ידנית בעשר שניות: שם, טלפון ומקור אינסטגרם, והליד כבר במערכת. מי שמפרסם נהנה גם מחיבור אוטומטי דרך Meta Lead Ads (ראו את השאלה הבאה).',
  },
  {
    question: 'איך עובד החיבור לקמפיינים של Instagram?',
    answer:
      'אינסטגרם רץ דרך Meta, אז כל מודעת Lead Ads שאתם מריצים באינסטגרם מתחברת אוטומטית למערכת. כל מי שממלא טופס נכנס כליד תוך שניות, עם הסימון אינסטגרם כמקור.',
  },
  {
    question: 'אפשר לראות כמה מהלידים מאינסטגרם באמת נסגרו?',
    answer:
      'המערכת מראה אחוז סגירה לפי מקור, כך שרואים כמה מהלידים מאינסטגרם באמת נסגרו. כל ליד שומר את המקור שלו, ואתם מודדים את הערוץ לאורך זמן.',
  },
  {
    question: 'מה ההבדל בין לידים מאינסטגרם ללידים מפייסבוק?',
    answer:
      'שניהם מגיעים אוטומטית דרך החיבור למטא. לידים מאינסטגרם נוטים להגיב מהר ולצפות לתגובה חזותית, וסימון המקור הנפרד מאפשר לכם קצב מענה ותסריט שונה לכל ערוץ.',
  },
  {
    question: 'מה עם תגובות לסטוריז ולסרטונים? איך מנהלים אותן?',
    answer:
      'תגובה לסטורי או לסרטון היא ליד לכל דבר, מישהו הביע עניין. מוסיפים אותו למערכת בעשר שניות, עם המקור אינסטגרם והערה קצרה על מה הוא הגיב, וההקשר נשמר.',
  },
  {
    question: 'כמה זמן לוקח להגדיר את החיבור?',
    answer:
      'החיבור למטא, פייסבוק ואינסטגרם, לוקח כחמש דקות: נכנסים להגדרות, מאשרים הרשאות, ובוחרים את הדף העסקי המקושר לאינסטגרם. מאותו רגע כל ליד ממודעה נכנס אוטומטית.',
  },
  {
    question: 'האם זה עובד לעסק שמוכר רק דרך Instagram?',
    answer:
      'בהחלט. הרבה עסקים מנהלים את כל המכירות דרך אינסטגרם. SocialCRM נותן להם בדיוק את שכבת הניהול שחסרה: סטטוסים, תזכורות, וטבלה אחת של כל מי שפנה, בלי תלות בכמות הפניות.',
  },
]

const faqData = {
  general: faqItems.slice(0, 3),
  campaigns: faqItems.slice(3, 5),
  setup: faqItems.slice(5),
}

const STATS = [
  { value: '5 דק׳', label: 'לחבר Meta Lead Ads', sub: 'אוטומטית גם לאינסטגרם' },
  { value: '0', label: 'לידים שנעלמים', sub: 'כשכל פנייה הופכת לליד מנוהל' },
  { value: 'שניות', label: 'מהמודעה למערכת', sub: 'כל ליד ממודעה נכנס אוטומטית' },
]

const featureCategories = [
  {
    icon: <Icon name='instagram' className='size-6 bg-primary' />,
    title: 'מודעות אינסטגרם',
    items: [
      { text: 'לידים ממודעות נכנסים אוטומטית' },
      { text: 'דרך Meta Lead Ads, כיסוי מלא' },
      { text: 'מסומנים עם מקור וסטטוס' },
    ],
  },
  {
    icon: <Icon name='comment-dots' className='size-6 bg-primary' />,
    title: 'פניות במסר ובסטוריז',
    items: [
      { text: 'מוסיפים ליד בעשר שניות' },
      { text: 'מסומן במקור אינסטגרם' },
      { text: 'הערה קצרה על ההקשר' },
    ],
  },
  {
    icon: <Icon name='chart-line' className='size-6 bg-primary' />,
    title: 'סטטוס ומעקב',
    items: [
      { text: 'סטטוס לכל ליד' },
      { text: 'תאריך לחזור' },
      { text: 'אחוז סגירה לפי מקור' },
    ],
  },
  {
    icon: <Icon name='users' className='size-6 bg-primary' />,
    title: 'ניהול צוות',
    items: [
      { text: 'שיוך לידים לנציגים' },
      { text: 'כל אחד עם הלידים שלו' },
      { text: 'מנהל רואה את הכל' },
    ],
  },
  {
    icon: <Icon name='calendar' className='size-6 bg-primary' />,
    title: 'תזכורות ומעקב',
    items: [
      { text: 'תאריך לחזור לכל ליד' },
      { text: 'הליד חוזר ברשימת היום' },
      { text: 'שום פנייה לא נשכחת' },
    ],
  },
  {
    icon: <Icon name='upload' className='size-6 bg-primary' />,
    title: 'ייבוא היסטוריה',
    items: [
      { text: 'אקסל עם לידים קיימים' },
      { text: 'מיפוי עמודות אוטומטי' },
      { text: 'הכל במקום אחד' },
    ],
  },
]

export default function InstagramLeadsCrmPage() {
  return (
    <>
      <JsonLd data={webPageSchema({ path: PAGE_PATH, title: PAGE_TITLE, description: PAGE_DESCRIPTION })} />
      <JsonLd data={buildFAQSchema(faqItems)} />
      <JsonLd
        data={breadcrumbSchema([
          { name: 'דף הבית', path: '/' },
          { name: 'CRM ללידים מאינסטגרם', path: PAGE_PATH },
        ])}
      />

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
                style={{
                  background:
                    'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
                }}
              >
                Instagram Leads
              </span>
              <h1 className='text-4xl md:text-5xl font-bold text-gray-900 mb-6 leading-tight'>
                לידים ממודעות אינסטגרם
                <br />
                נכנסים אוטומטית, מסודרים מהרגע הראשון
              </h1>
              <p className='text-lg text-gray-700 mb-8 max-w-xl'>
                כל ליד ממודעת אינסטגרם נכנס למערכת אוטומטית, מסודר עם מקור וסטטוס. פנייה במסר או תגובה לסטורי מוסיפים ידנית בשניות, ולא מאבדים אף אחד.
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
                  lbl='התחל בחינם'
                  className='w-full sm:w-auto h-auto px-8 py-4 rounded-xl text-white font-bold hover:scale-105 transition-all text-sm'
                  style={{ backgroundColor: '#3f20f5' }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Pain points */}
        <section className='px-8 py-16' style={{ backgroundColor: '#0a0a0a' }}>
          <div className='max-w-3xl mx-auto' dir='rtl'>
            <h2 className='text-3xl font-bold text-white mb-3 text-center'>
              לידים מאינסטגרם נופלים בין הכיסאות
            </h2>
            <p className='text-white/50 text-center mb-10 max-w-xl mx-auto'>
              הסיבות המוכרות שגורמות לעסקים לאבד אנשים שכבר הביעו עניין.
            </p>

            <ul className='space-y-4 text-white/80'>
              <li className='flex items-start gap-3'>
                <span className='size-2 rounded-full bg-pink-500 mt-2 flex-none' />
                <span>
                  <strong className='text-white'>DMs נבלעים בין מאות הודעות.</strong> מישהו שאל
                  על מוצר שבוע שעבר, ענית, ועכשיו אתה לא זוכר אם הוא חזר אליך או נעלם.
                </span>
              </li>
              <li className='flex items-start gap-3'>
                <span className='size-2 rounded-full bg-pink-500 mt-2 flex-none' />
                <span>
                  <strong className='text-white'>תגובות לסטוריז זרמיות.</strong> סטורי טוב מקבל
                  עשרות תגובות. רובן הולכות לאיבוד ברגע שהסטורי נעלם תוך 24 שעות.
                </span>
              </li>
              <li className='flex items-start gap-3'>
                <span className='size-2 rounded-full bg-pink-500 mt-2 flex-none' />
                <span>
                  <strong className='text-white'>לידים ממודעות מתערבבים ונשכחים.</strong> ליד
                  ממודעה נכנס, אבל בלי סטטוס ומעקב הוא נבלע בין השאר, ואף אחד לא חוזר אליו.
                </span>
              </li>
              <li className='flex items-start gap-3'>
                <span className='size-2 rounded-full bg-pink-500 mt-2 flex-none' />
                <span>
                  <strong className='text-white'>אין הקשר על מי פנה ולמה.</strong> מי הגיב על
                  הסטורי על המבצע? מי שאל בהודעה על הקורס? ברור שאי אפשר לזכור את הכל בראש.
                </span>
              </li>
            </ul>
          </div>
        </section>

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

        {/* Solution */}
        <section className='px-8 py-16 bg-white' dir='rtl'>
          <div className='max-w-3xl mx-auto'>
            <h2 className='text-3xl font-bold mb-6'>איך SocialCRM מנהל לידים מאינסטגרם</h2>
            <p className='text-lg text-gray-700 mb-4 leading-relaxed'>
              כל ליד ממודעת אינסטגרם נכנס למערכת לבד, תוך שניות, מסודר עם מקור וסטטוס. פניות במסר ותגובות לסטוריז מוסיפים ידנית בעשר שניות, עם הערה קצרה על מה עניין אותם.
            </p>
            <p className='text-lg text-gray-700 mb-8 leading-relaxed'>
              מכאן הכל במסך אחד. לכל ליד יש סטטוס, בעלים ותאריך לחזור, ורואים אחוז סגירה לפי מקור, כדי לדעת מאיזה ערוץ מגיעות הסגירות.
            </p>

            <div className='grid sm:grid-cols-2 gap-6'>
              <div className='p-6 rounded-xl border border-gray-200'>
                <p className='font-semibold mb-2'>לידים ממודעות אינסטגרם</p>
                <ul className='text-sm text-gray-600 space-y-1'>
                  <li>✓ נכנסים אוטומטית, תוך שניות</li>
                  <li>✓ ישר מטופס המודעה לרשימה</li>
                  <li>✓ מסומנים עם מקור וסטטוס</li>
                  <li>✓ מוכנים למעקב מיד</li>
                </ul>
              </div>
              <div
                className='p-6 rounded-xl text-white'
                style={{ backgroundColor: '#3f20f5' }}
              >
                <p className='font-semibold mb-2'>פניות במסר ובסטוריז</p>
                <ul className='text-sm space-y-1 text-white/90'>
                  <li>✓ הוספה ידנית בעשר שניות</li>
                  <li>✓ תיוג מקור "Instagram"</li>
                  <li>✓ הערת הקשר חופשית</li>
                  <li>✓ נכנס לאותו פייפליין</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Features grid */}
        <FeatureGrid
          title={<><span dir='ltr'>Instagram</span>, כל הלידים במקום אחד</>}
          subtitle='ערוץ אחד עם הרבה צורות פנייה, ושכבה ניהולית אחת שמטפלת בכולן.'
          categories={featureCategories}
          buttonText='התחל לנהל לידים מאינסטגרם בחינם'
          buttonHref='/auth'
        />

        <AnimatedCta
          title='לידים ממודעות אינסטגרם'
          highlight='נכנסים אוטומטית, מסודרים מהרגע הראשון'
          buttonText='התחל בחינם'
          buttonHref='/auth'
        />

        <FAQ
          title='שאלות נפוצות על ניהול לידים מאינסטגרם'
          subtitle='מה ששואלים על ניהול הפניות והקמפיינים'
          categories={{ general: 'כללי', campaigns: 'קמפיינים', setup: 'התחלה' }}
          faqData={faqData}
        />

        <FinalCTA />
      </MarketingLayout>
    </>
  )
}
