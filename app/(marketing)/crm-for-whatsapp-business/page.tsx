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

const PAGE_PATH = '/crm-for-whatsapp-business'
const PAGE_TITLE = 'CRM ל-WhatsApp Business — ניהול לידים מעבר ל-Labels | SocialCRM'
const PAGE_DESCRIPTION =
  'WhatsApp Business נותן Labels ותגובות אוטומטיות, אבל לעסק שגדל זה לא מספיק. SocialCRM מוסיף שכבת CRM מלאה: סטטוסים, נציגים, תזכורות ומעקב — בלי שום ליד שנשכח בצ׳אט.'

export const metadata = buildPageMetadata({
  path: PAGE_PATH,
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  ogTitle: 'CRM ל-WhatsApp Business | SocialCRM',
  ogDescription: 'מעבר ל-Labels של WhatsApp Business — שכבת CRM אמיתית עם סטטוסים, נציגים ותזכורות.',
})

const faqItems = [
  {
    question: 'האם SocialCRM מתחבר ישירות ל-WhatsApp Business API?',
    answer:
      'לא באופן אוטומטי. הוספת לידים מ-WhatsApp נעשית בהקלקה אחת — שם וטלפון, מקור "WhatsApp", ומיד הליד נמצא במערכת עם סטטוס וניהול מלא. אם יש רשימה גדולה של מספרים מ-WhatsApp Business, אפשר לייבא הכל מאקסל בכמה שניות.',
  },
  {
    question: 'מה ההבדל בין Labels של WhatsApp Business לסטטוסים ב-SocialCRM?',
    answer:
      'Labels הם תיוגים על שיחות בתוך WhatsApp. הם נחמדים לסידור ויזואלי, אבל הם לא נציגים, הם לא תזכורות, והם לא מאפשרים לראות את כל הלידים בטבלה אחת עם פילטרים. SocialCRM מנהל את כל הליד מההתחלה ועד הסגירה — סטטוס, נציג אחראי, תאריך פנייה, היסטוריה ותזכורות.',
  },
  {
    question: 'האם זה מתאים לעסק עם נציג אחד?',
    answer:
      'כן, ובמיוחד. כשעסק קטן עובד לבד דרך WhatsApp, הסיכון הכי גדול הוא ששיחה תיבלע באלפי הודעות אחרות. SocialCRM נותן לך טבלה אחת של כל הלידים ומבטיח שאף אחד לא נופל בין הכיסאות.',
  },
  {
    question: 'כמה זמן לוקח להעביר את הלידים הקיימים מ-WhatsApp?',
    answer:
      'דקות. אם יש לך אקסל עם מספרי טלפון מתוך WhatsApp Business — מעלים את הקובץ והכל מאורגן במערכת. אם אין אקסל, אפשר להוסיף לידים ידנית, 10 שניות לכל ליד.',
  },
  {
    question: 'האם יש עלות?',
    answer:
      'מתחילים בחינם. ניתן להירשם ולעבוד עם המערכת ללא עלות, בלי כרטיס אשראי. שדרוג נדרש רק כשהעסק מתרחב לנפחים גדולים יותר או לתכונות צוות מתקדמות.',
  },
  {
    question: 'האם יש שיוך לידים בין נציגים?',
    answer:
      'כן. כל ליד שמגיע מ-WhatsApp ניתן לשיוך לנציג ספציפי. הנציג רואה רק את הלידים שלו, והמנהל רואה את כולם — כולל ביצועים, אחוזי סגירה ולידים שדורשים טיפול.',
  },
  {
    question: 'מה קורה אם נציג עוזב?',
    answer:
      'בניגוד ל-WhatsApp שבו כל ההיסטוריה הולכת עם הטלפון של הנציג, ב-SocialCRM כל ליד ושיוך נשמר במערכת. נציג חדש יכול להיכנס מיד ולראות את כל ההקשר — סטטוס, היסטוריית פעולות, ומה השלב הבא.',
  },
]

const faqData = {
  general: faqItems.slice(0, 3),
  setup: faqItems.slice(3, 5),
  team: faqItems.slice(5),
}

const STATS = [
  { value: '10 שנ׳', label: 'להוסיף ליד מ-WhatsApp', sub: 'שם, טלפון, מקור — וזה במערכת' },
  { value: '0', label: 'לידים שנשכחים בצ׳אט', sub: 'כשיש סטטוס, נציג ותזכורת' },
  { value: '×3', label: 'יותר עוקבים נסגרים', sub: 'כשהמעקב מאורגן, לא בראש' },
]

const featureCategories = [
  {
    icon: <Icon name='comment-dots' className='size-6 bg-primary' />,
    title: 'הוספת ליד מ-WhatsApp',
    items: [
      { text: '10 שניות מהודעה לליד מנוהל' },
      { text: 'מקור "WhatsApp" אוטומטית' },
      { text: 'שיוך מיידי לנציג' },
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
      { text: 'מעבר מ-Labels לפייפליין אמיתי' },
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
      { text: '"לחזור עוד שבועיים"' },
      { text: 'התראות אוטומטיות' },
      { text: 'אף ליד לא נשכח' },
    ],
  },
  {
    icon: <Icon name='chart-line' className='size-6 bg-primary' />,
    title: 'ביצועים אמיתיים',
    items: [
      { text: 'אחוז סגירה לפי מקור' },
      { text: 'ביצועי כל נציג' },
      { text: 'ROI ברור על קמפיינים' },
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
          { name: 'CRM ל-WhatsApp Business', path: PAGE_PATH },
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
                style={{ backgroundColor: '#25D366' }}
              >
                WhatsApp Business + CRM
              </span>
              <h1 className='text-4xl md:text-5xl font-bold text-gray-900 mb-6 leading-tight'>
                הופכים את WhatsApp Business למערכת מכירות
                <br />
                כל השיחות, הלידים והמעקבים במקום אחד
              </h1>
              <p className='text-lg text-gray-700 mb-8 max-w-xl'>
                Labels ב-WhatsApp Business עוזרים לסדר שיחות, אבל הם לא מערכת ניהול לידים. כשהעסק
                גדל וההודעות זורמות, אתה צריך סטטוסים, שיוך לנציגים, תזכורות ומעקב — לא רק תוויות
                צבעוניות.
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
              לא צריך לבחור בין WhatsApp לבין מערכת. ממשיכים לנהל את השיחות ב-WhatsApp Business —
              אתה מכיר את הכלי וזה עובד. SocialCRM הופך לשכבה הניהולית שיושבת מעל: כל פנייה
              חשובה הופכת לליד מנוהל עם סטטוס, נציג, מקור, ותזכורות.
            </p>
            <p className='text-lg text-gray-700 mb-8 leading-relaxed'>
              הוספה לוקחת 10 שניות. ייבוא של רשימה קיימת לוקח דקה. ומאותו רגע יש לך מסך אחד
              שמראה לך מי לידים חדשים, מי בטיפול, ומי לחזור אליו היום — לא צריך לזכור, לא צריך
              לחפש בצ׳אט.
            </p>

            <div className='grid sm:grid-cols-2 gap-6'>
              <div className='p-6 rounded-xl border border-gray-200'>
                <p className='font-semibold mb-2'>WhatsApp Business לבד</p>
                <ul className='text-sm text-gray-600 space-y-1'>
                  <li>✕ Labels בלבד</li>
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
                  <li>✓ פייפליין מלא של סטטוסים</li>
                  <li>✓ שיוך לנציגים עם הרשאות</li>
                  <li>✓ תזכורות אוטומטיות</li>
                  <li>✓ טבלה אחת של כל הלידים</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Features grid */}
        <FeatureGrid
          title={<>הכל מה שחסר ל-<span dir='ltr'>WhatsApp Business</span></>}
          subtitle='שכבה ניהולית מלאה — בלי לוותר על השיחות שאתה מנהל ב-WhatsApp.'
          categories={featureCategories}
          buttonText='התחל לנהל לידים מ-WhatsApp בחינם'
          buttonHref='/auth'
        />

        <AnimatedCta
          title='כל הלידים במקום אחד'
          highlight='כל העסק בשליטה אחת'
          buttonText='התחל בחינם'
          buttonHref='/auth'
        />

        <FAQ
          title='שאלות נפוצות על CRM ל-WhatsApp Business'
          subtitle='מה ששואלים אותנו על השילוב'
          categories={{ general: 'כללי', setup: 'התחלה', team: 'צוות' }}
          faqData={faqData}
        />

        <FinalCTA />
      </MarketingLayout>
    </>
  )
}
