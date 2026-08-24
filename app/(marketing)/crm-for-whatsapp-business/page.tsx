import Link from 'next/link'
import { buildPageMetadata } from '@/lib/seo/metadata'
import { JsonLd } from '@/components/seo/JsonLd'
import { breadcrumbSchema, webPageSchema } from '@/lib/seo/schemas'
import { MarketingLayout } from '@/components/seo/MarketingLayout'
import { FinalCTA } from '@/components/seo/CRMSections'
import { FAQ } from '@/components/ui/faq-tabs'
import { AnimatedCta } from '@/components/ui/animated-cta'
import { FeatureGrid } from '@/components/ui/feature-section'
import { buildFAQSchema } from '@/components/seo/FAQ'
import Icon from '@/lib/Icon'
import { Btn } from '@/lib/btns/Btn'

const PAGE_PATH = '/crm-for-whatsapp-business'
const PAGE_TITLE = 'WhatsApp Business CRM, ניהול לידים מעבר לתוויות | SocialCRM'
const PAGE_DESCRIPTION =
  'וואטסאפ עסקי נותן תוויות ותגובות מהירות, אבל זו לא מערכת מכירות. SocialCRM מחבר את הוואטסאפ שלכם, הופך כל שיחה לליד עם סטטוס, בעלים ומעקב, ודואג ששום פנייה לא תיפול בין הכיסאות.'

export const metadata = buildPageMetadata({
  path: PAGE_PATH,
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  ogTitle: 'WhatsApp Business CRM | SocialCRM',
  ogDescription: 'מחברים את הוואטסאפ העסקי, וכל שיחה הופכת לליד עם סטטוס, בעלים ומעקב. שום פנייה לא נשכחת בצ׳אט.',
})

const faqItems = [
  {
    question: 'האם SocialCRM מתחבר לוואטסאפ העסקי?',
    answer:
      'כן. מחברים את הוואטסאפ העסקי, מקבלים את השיחות בתוך המערכת, ועונים מכאן. כל שיחה מחוברת לליד עם מקור וסטטוס, ואפשר גם להוסיף ליד ידנית או לייבא רשימת מספרים מאקסל.',
  },
  {
    question: 'מה ההבדל בין תוויות בוואטסאפ עסקי לבין סטטוסים במערכת?',
    answer:
      'תוויות הן תיוג ויזואלי על שיחות בתוך וואטסאפ. הן לא נציג, לא תזכורת, ולא טבלה אחת עם כל הלידים והפילטרים. SocialCRM מנהל את הליד מהרגע הראשון ועד הסגירה, עם סטטוס, בעלים, תאריך פנייה, היסטוריה ותזכורות.',
  },
  {
    question: 'האם זה מתאים לעסק עם נציג אחד?',
    answer:
      'כן, ובמיוחד. כשעסק קטן עובד לבד דרך WhatsApp, הסיכון הכי גדול הוא ששיחה תיבלע באלפי הודעות אחרות. SocialCRM נותן לך טבלה אחת של כל הלידים ומבטיח שאף אחד לא נופל בין הכיסאות.',
  },
  {
    question: 'כמה זמן לוקח להעביר לידים קיימים מהוואטסאפ?',
    answer:
      'דקות. אם יש רשימת מספרים באקסל, מעלים את הקובץ והכל מאורגן במערכת. אם אין, מוסיפים לידים ידנית בעשר שניות לכל אחד.',
  },
  {
    question: 'האם יש עלות?',
    answer:
      'מתחילים בחינם. ניתן להירשם ולעבוד עם המערכת ללא עלות, בלי כרטיס אשראי. שדרוג נדרש רק כשהעסק מתרחב לנפחים גדולים יותר או לתכונות צוות מתקדמות.',
  },
  {
    question: 'האם יש שיוך לידים בין נציגים?',
    answer:
      'כן. כל ליד מוואטסאפ אפשר לשייך לנציג. הנציג רואה רק את הלידים שלו, והמנהל רואה את כולם, כולל ביצועים, אחוזי סגירה ולידים שדורשים טיפול.',
  },
  {
    question: 'מה קורה אם נציג עוזב?',
    answer:
      'בוואטסאפ פרטי כל ההיסטוריה יושבת בטלפון של הנציג. במערכת שלנו הליד והשיוך נשמרים, ונציג חדש נכנס ורואה מיד את כל ההקשר: סטטוס, היסטוריית פעולות, והשלב הבא.',
  },
]

const faqData = {
  general: faqItems.slice(0, 3),
  setup: faqItems.slice(3, 5),
  team: faqItems.slice(5),
}

const STATS = [
  { value: '10 שנ׳', label: 'משיחה לליד מנוהל', sub: 'שם, טלפון ומקור, והכל במערכת' },
  { value: '0', label: 'לידים שנשכחים בצ׳אט', sub: 'כשיש סטטוס, בעלים ותזכורת' },
  { value: '×3', label: 'יותר לידים נסגרים', sub: 'כשהמעקב מסודר, לא בראש' },
]

const featureCategories = [
  {
    icon: <Icon name='comment-dots' className='size-6 bg-primary' />,
    title: 'שיחות מחוברות ללידים',
    items: [
      { text: 'כל שיחה מחוברת לליד שלה' },
      { text: 'עונים מהמערכת עם תבניות מוכנות' },
      { text: 'רואים מתי ההודעה נקראה' },
    ],
  },
  {
    icon: <Icon name='upload' className='size-6 bg-primary' />,
    title: 'ייבוא מאקסל',
    items: [
      { text: 'העלאת רשימת מספרים קיימת' },
      { text: 'מיפוי עמודות אוטומטי' },
      { text: '200 לידים תוך פחות מדקה' },
    ],
  },
  {
    icon: <Icon name='info' className='size-6 bg-primary' />,
    title: 'סטטוסים ופילטרים',
    items: [
      { text: 'מהתוויות לפייפליין אמיתי' },
      { text: 'סינון לפי מקור, סטטוס, תאריך' },
      { text: 'תצוגה אחת של כל הלידים' },
    ],
  },
  {
    icon: <Icon name='users' className='size-6 bg-primary' />,
    title: 'ניהול צוות',
    items: [
      { text: 'שיוך לידים לנציגים' },
      { text: 'כל נציג רואה רק את שלו' },
      { text: 'מנהל רואה את הכל' },
    ],
  },
  {
    icon: <Icon name='calendar' className='size-6 bg-primary' />,
    title: 'תזכורות ומעקב',
    items: [
      { text: 'תאריך לחזור לכל ליד' },
      { text: 'הליד חוזר ברשימת היום' },
      { text: 'אף ליד לא נשכח' },
    ],
  },
  {
    icon: <Icon name='chart-line' className='size-6 bg-primary' />,
    title: 'ביצועים אמיתיים',
    items: [
      { text: 'אחוז סגירה לפי מקור' },
      { text: 'ביצועי כל נציג' },
      { text: 'מי ממתין לטיפול עכשיו' },
    ],
  },
]

export default function CrmForWhatsAppBusinessPage() {
  return (
    <>
      <JsonLd data={webPageSchema({ path: PAGE_PATH, title: PAGE_TITLE, description: PAGE_DESCRIPTION })} />
      <JsonLd data={buildFAQSchema(faqItems)} />
      <JsonLd
        data={breadcrumbSchema([
          { name: 'דף הבית', path: '/' },
          { name: 'CRM לוואטסאפ עסקי', path: PAGE_PATH },
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


          <div className='relative z-10 max-w-6xl mx-auto bg-white rounded-xl shadow-2xl overflow-hidden'>
            <div className='flex flex-col items-center text-center p-8 lg:px-12 lg:pt-8 lg:pb-16' dir='rtl'>
              <span
                className='inline-block px-3 py-1 rounded-full text-xs font-semibold mb-6 text-white'
                style={{ backgroundColor: '#25D366' }}
              >
                WhatsApp Business + CRM
              </span>
              <h1 className='text-4xl md:text-5xl font-bold text-gray-900 mb-6 leading-tight'>
                תוויות מסדרות שיחות
                <br />
                מערכת מנהלת מכירות
              </h1>
              <p className='text-lg text-gray-700 mb-8 max-w-xl'>
                וואטסאפ עסקי נהדר לשיחות, אבל תווית צבעונית היא לא נציג, לא תזכורת, ולא תמונת מצב של כל הלידים. SocialCRM מחבר את הוואטסאפ שלכם ונותן לכל שיחה סטטוס, בעלים, היסטוריה ומעקב.
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
            <h2 className='text-3xl font-bold text-white mb-3 text-center'>הסיטואציה הזו מוכרת?</h2>
            <p className='text-white/50 text-center mb-10 max-w-xl mx-auto'>
              אתה עובד עם WhatsApp Business, ובכל זאת לידים נשמטים. זו הסיבה.
            </p>

            <ul className='space-y-4 text-white/80'>
              <li className='flex items-start gap-3'>
                <span className='size-2 rounded-full bg-red-500 mt-2 flex-none' />
                <span>
                  <strong className='text-white'>הודעות מצטברות ונבלעות.</strong> אחרי שלושה ימים
                  מי בכלל זוכר מי שאל על המוצר ומי כבר התחבר לתשלום?
                </span>
              </li>
              <li className='flex items-start gap-3'>
                <span className='size-2 rounded-full bg-red-500 mt-2 flex-none' />
                <span>
                  <strong className='text-white'>Labels זה לא פייפליין.</strong> אתה יכול לתייג
                  שיחה כ"חם", אבל אין לך מסך אחד שמראה לך את כל ה"חמים" יחד עם תאריך פנייה אחרון.
                </span>
              </li>
              <li className='flex items-start gap-3'>
                <span className='size-2 rounded-full bg-red-500 mt-2 flex-none' />
                <span>
                  <strong className='text-white'>אין תזכורות אמיתיות.</strong> הבטחת ללקוח לחזור
                  ביום שלישי? בלי מערכת אין מי שיזכיר לך, וזה ליד שהלך.
                </span>
              </li>
              <li className='flex items-start gap-3'>
                <span className='size-2 rounded-full bg-red-500 mt-2 flex-none' />
                <span>
                  <strong className='text-white'>אם נציג עוזב, הולך גם הזיכרון.</strong> כל
                  ההיסטוריה של הלידים שלו יושבת בטלפון שלו. נציג חדש מתחיל מאפס.
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
            <h2 className='text-3xl font-bold mb-6'>איך SocialCRM משלים את WhatsApp Business</h2>
            <p className='text-lg text-gray-700 mb-4 leading-relaxed'>
              לא צריך לבחור בין וואטסאפ למערכת. מחברים את הוואטסאפ העסקי, וכל שיחה חשובה הופכת לליד מנוהל עם סטטוס, בעלים ומקור. עונים מהמערכת, ורואים מתי הלקוח קיבל וקרא את ההודעה.
            </p>
            <p className='text-lg text-gray-700 mb-8 leading-relaxed'>
              הכל יושב על מסך אחד: מי חדש, מי בטיפול, ולמי צריך לחזור היום. גם כשנציג מתחלף, ההיסטוריה של הליד נשארת במקום, ושום שיחה לא הולכת לאיבוד בטלפון פרטי.
            </p>

            <div className='grid sm:grid-cols-2 gap-6'>
              <div className='p-6 rounded-xl border border-gray-200'>
                <p className='font-semibold mb-2'>WhatsApp Business לבד</p>
                <ul className='text-sm text-gray-600 space-y-1'>
                  <li>✕ תוויות בלבד</li>
                  <li>✕ אין שיוך לנציג</li>
                  <li>✕ אין תזכורות</li>
                  <li>✕ אין מסך אחד עם כל הלידים</li>
                </ul>
              </div>
              <div
                className='p-6 rounded-xl text-white'
                style={{ backgroundColor: '#3f20f5' }}
              >
                <p className='font-semibold mb-2'>WhatsApp Business + SocialCRM</p>
                <ul className='text-sm space-y-1 text-white/90'>
                  <li>✓ כל שיחה מחוברת לליד</li>
                  <li>✓ פייפליין מלא של סטטוסים</li>
                  <li>✓ שיוך לנציגים עם הרשאות</li>
                  <li>✓ טבלה אחת של כל הלידים</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Features grid */}
        <FeatureGrid
          title={<><span dir='ltr'>WhatsApp Business</span>, וכל מה שחסר לו</>}
          subtitle='שכבה ניהולית מלאה, בלי לוותר על השיחות שאתם כבר מנהלים בוואטסאפ.'
          categories={featureCategories}
          buttonText='חברו את הוואטסאפ בחינם'
          buttonHref='/auth'
        />

        <AnimatedCta
          title='תוויות מסדרות שיחות'
          highlight='מערכת מנהלת מכירות'
          buttonText='התחל בחינם'
          buttonHref='/auth'
        />

        <FAQ
          title='שאלות נפוצות על CRM לוואטסאפ עסקי'
          subtitle='מה ששואלים אותנו על השילוב'
          categories={{ general: 'כללי', setup: 'התחלה', team: 'צוות' }}
          faqData={faqData}
        />

        <FinalCTA />
      </MarketingLayout>
    </>
  )
}
