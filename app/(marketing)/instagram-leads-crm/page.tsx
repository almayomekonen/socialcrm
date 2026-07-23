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
const PAGE_TITLE = 'CRM ללידים מאינסטגרם — ניהול DMs, סטוריז וקמפיינים | SocialCRM'
const PAGE_DESCRIPTION =
  'לידים מאינסטגרם מגיעים מכל מקום: DMs, סטוריז, קמפיינים. SocialCRM אוסף את כולם למקום אחד עם מקור, סטטוס, נציג ותזכורות — ומראה לך איזה קמפיין באמת סוגר.'

export const metadata = buildPageMetadata({
  path: PAGE_PATH,
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  ogTitle: 'CRM ללידים מאינסטגרם | SocialCRM',
  ogDescription: 'ניהול DMs, סטוריז וקמפיינים מאינסטגרם במקום אחד. ROI ברור על כל קמפיין IG.',
})

const faqItems = [
  {
    question: 'האם SocialCRM מייבא אוטומטית הודעות מ-Instagram DMs?',
    answer:
      'לא ייבוא אוטומטי של תוכן ההודעות — Instagram לא מאפשר את זה למערכות חיצוניות. אבל הוספת ליד מ-DM היא מהירה במיוחד: שם וטלפון מתוך הצ׳אט, מקור "Instagram", ומיד הליד נמצא במערכת. למי שמפרסם ב-Instagram יש גם חיבור אוטומטי דרך Meta Lead Ads (ראה השאלה הבאה).',
  },
  {
    question: 'איך עובד החיבור לקמפיינים של Instagram?',
    answer:
      'אינסטגרם רץ דרך Meta, אז כל קמפיין Lead Ads שאתה מריץ באינסטגרם — בין שזה ב-Stories Ads, Reels Ads או פיד — מתחבר אוטומטית ל-SocialCRM דרך החיבור היחיד למטא. כל ליד שממלא טופס מודעה באינסטגרם מגיע למערכת תוך שניות עם הסימון "Instagram" כמקור.',
  },
  {
    question: 'אפשר לעקוב אחר ROI של קמפיין באינסטגרם ספציפי?',
    answer:
      'כן. כל ליד שמגיע מקמפיין IG נושא תיוג של מקור הקמפיין. אפשר לראות בקלות איזה קמפיין הביא 50 לידים אבל סגר רק 2, ואיזה הביא 12 לידים אבל סגר 8. זה הופך את ההחלטה איפה לשים את התקציב להחלטה מבוססת נתונים.',
  },
  {
    question: 'מה ההבדל בין לידים מאינסטגרם ללידים מפייסבוק?',
    answer:
      'מבחינת המערכת — שניהם מגיעים דרך החיבור ל-Meta. אבל לידים מאינסטגרם נוטים להיות צעירים יותר, מגיבים מהר יותר ב-DM, ומצפים לתגובה חזותית. סימון המקור נפרד ("Instagram" vs "Facebook") מאפשר לך להגדיר קצב מענה ותסריטי שיחה שונים לכל ערוץ.',
  },
  {
    question: 'מה עם תגובות לסטוריז ול-Reels — איך מנהלים אותן?',
    answer:
      'תגובות לסטוריז ו-Reels אלו לידים בכל מובן — מישהו הביע עניין. כשמישהו עונה לסטורי או מגיב על Reel, מוסיפים אותו ל-SocialCRM כליד חדש (10 שניות), עם המקור "Instagram" ועם הערה קצרה על איזה תוכן הוא הגיב. ככה לא מאבדים את ההקשר.',
  },
  {
    question: 'כמה זמן לוקח להגדיר את החיבור?',
    answer:
      'החיבור ל-Meta (פייסבוק + אינסטגרם) לוקח כ-5 דקות: נכנסים להגדרות, מאשרים הרשאות, ובוחרים את הדף העסקי המקושר לאינסטגרם. מאותו רגע כל ליד מקמפיינים נכנס אוטומטית.',
  },
  {
    question: 'האם זה עובד לעסק שמוכר רק דרך Instagram?',
    answer:
      'בהחלט. הרבה עסקים שמוכרים פיזית או מוצרי בריאות וטיפוח מנהלים את כל המכירות שלהם דרך IG. SocialCRM נותן להם בדיוק את שכבת הניהול שחסרה: תזכורות, סטטוסים, וטבלה אחת של כל מי שפנה — בלי תלות בכמות ה-DMs.',
  },
]

const faqData = {
  general: faqItems.slice(0, 3),
  campaigns: faqItems.slice(3, 5),
  setup: faqItems.slice(5),
}

const STATS = [
  { value: '5 דק׳', label: 'לחבר Meta Lead Ads', sub: 'אוטומטית גם לאינסטגרם' },
  { value: '0', label: 'לידים שנעלמים ב-DM', sub: 'כשכל פנייה הופכת לליד מנוהל' },
  { value: 'ROI', label: 'ברור לכל קמפיין IG', sub: 'יודעים איזה קמפיין באמת סוגר' },
]

const featureCategories = [
  {
    icon: <Icon name='instagram' className='size-6 bg-primary' />,
    title: 'חיבור ל-Instagram Ads',
    items: [
      { text: 'דרך Meta Lead Ads — כיסוי מלא' },
      { text: 'Stories, Reels, Feed Ads' },
      { text: 'תיוג קמפיין אוטומטי' },
    ],
  },
  {
    icon: <Icon name='comment-dots' className='size-6 bg-primary' />,
    title: 'לידים מ-DMs ותגובות',
    items: [
      { text: 'הוספה ידנית בעשר שניות' },
      { text: 'מקור "Instagram" אוטומטית' },
      { text: 'הערה קצרה על ההקשר' },
    ],
  },
  {
    icon: <Icon name='chart-line' className='size-6 bg-primary' />,
    title: 'ROI לפי קמפיין',
    items: [
      { text: 'לידים נסגרים לפי מקור' },
      { text: 'השוואה בין קמפיינים' },
      { text: 'איפה כדאי להשקיע יותר' },
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
      { text: 'אוטומטיות לכל ליד' },
      { text: '"לחזור עוד שבוע"' },
      { text: 'אף DM לא נשכח' },
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
                כל הלידים מאינסטגרם במקום אחד
                <br />
                כל שיחה, כל ליד, כל עסקה
              </h1>
              <p className='text-lg text-gray-700 mb-8 max-w-xl'>
                לידים מאינסטגרם מגיעים מכל פינה — DMs, תגובות לסטוריז, מודעות Lead Ads.
                SocialCRM אוסף את כולם למקום אחד, מתייג את המקור, ומראה לך איזה קמפיין באמת
                מחזיר את הכסף.
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
                  <strong className='text-white'>קמפיינים בלי מדידה אמיתית.</strong> שילמת
                  ₪3,000 על קמפיין IG ויש לך 40 לידים — אבל מי מהם נסגר? אין לך מושג.
                </span>
              </li>
              <li className='flex items-start gap-3'>
                <span className='size-2 rounded-full bg-pink-500 mt-2 flex-none' />
                <span>
                  <strong className='text-white'>אין הקשר על מי פנה ולמה.</strong> מי הגיב על
                  הסטורי על המבצע? מי שאל ב-DM על הקורס? ברור שאי אפשר לזכור את הכל בראש.
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
              שני סוגי לידים — שני סוגי טיפול. לידים מ-Lead Ads (סטוריז, Reels, פיד) נכנסים
              אוטומטית דרך החיבור ל-Meta תוך שניות, עם תיוג קמפיין מלא. לידים מ-DMs ומתגובות
              לסטוריז נוספים ידנית בעשר שניות, עם תיוג מקור "Instagram" ובמידת הצורך גם הערה
              על איזה תוכן הם הגיבו.
            </p>
            <p className='text-lg text-gray-700 mb-8 leading-relaxed'>
              מאותו רגע — הכל במסך אחד. סטטוסים, נציגים אחראים, תזכורות מעקב, ודיווח ברור על איזה
              קמפיין IG הביא את הסגירות הרבות ביותר. הופך את ההחלטה לאיפה לכוון תקציב פרסום
              להחלטה שמבוססת על מספרים, לא על תחושות.
            </p>

            <div className='grid sm:grid-cols-2 gap-6'>
              <div className='p-6 rounded-xl border border-gray-200'>
                <p className='font-semibold mb-2'>לידים מ-Instagram Ads</p>
                <ul className='text-sm text-gray-600 space-y-1'>
                  <li>✓ אוטומטי דרך Meta Lead Ads</li>
                  <li>✓ תיוג קמפיין מובנה</li>
                  <li>✓ זמן הגעה: שניות</li>
                  <li>✓ מדידת ROI לפי קמפיין</li>
                </ul>
              </div>
              <div
                className='p-6 rounded-xl text-white'
                style={{ backgroundColor: '#3f20f5' }}
              >
                <p className='font-semibold mb-2'>לידים מ-DMs ותגובות</p>
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
          title={<>כל מה שצריך לניהול לידים מ-<span dir='ltr'>Instagram</span></>}
          subtitle='ערוץ אחד עם הרבה צורות פנייה — שכבה ניהולית אחת שמטפלת בכולן.'
          categories={featureCategories}
          buttonText='התחל לנהל לידים מאינסטגרם בחינם'
          buttonHref='/auth'
        />

        <AnimatedCta
          title='כל הלידים במקום אחד'
          highlight='כל העסק בשליטה אחת'
          buttonText='התחל בחינם'
          buttonHref='/auth'
        />

        <FAQ
          title='שאלות נפוצות על ניהול לידים מאינסטגרם'
          subtitle='מה ששואלים על ניהול ה-DMs והקמפיינים'
          categories={{ general: 'כללי', campaigns: 'קמפיינים', setup: 'התחלה' }}
          faqData={faqData}
        />

        <FinalCTA />
      </MarketingLayout>
    </>
  )
}
