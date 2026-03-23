import Link from 'next/link'
import { Metadata } from 'next'
import AccordionItem from '@/lib/AccordionItem'
import Icon from '@/lib/Icon'
import { MarketingLayout } from '@/components/seo/MarketingLayout'

export const metadata: Metadata = {
  title: 'מערכת ניהול לידים לעסקים קטנים | SocialCRM',
  description:
    'SocialCRM, מערכת CRM בעברית לניהול לידים מפייסבוק, אינסטגרם ווואטסאפ. ייבוא מאקסל, מעקב מכירות, ניהול נציגים. התחל בחינם.',
  alternates: {
    canonical: 'https://socialcrm.vercel.app/features',
  },
  openGraph: {
    title: 'מערכת ניהול לידים לעסקים קטנים | SocialCRM',
    description: 'כל הלידים מפייסבוק, אינסטגרם ווואטסאפ, במקום אחד. ניהול, מעקב, וסגירת עסקאות.',
    url: 'https://socialcrm.vercel.app/features',
  },
}

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'מה זה מערכת CRM לעסקים קטנים?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'מערכת CRM (ניהול קשרי לקוחות) לעסקים קטנים היא תוכנה שמאגדת את כל הלידים ואנשי הקשר של העסק במקום אחד. היא מאפשרת לנהל סטטוס, לשייך נציגים, לעקוב אחר התקדמות ולסגור יותר עסקאות.',
      },
    },
    {
      '@type': 'Question',
      name: 'האם SocialCRM מתחבר לפייסבוק?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'כן. SocialCRM מתחבר ישירות לדף העסקי בפייסבוק ומביא כל ליד שממלא טופס מודעה ישירות למערכת, אוטומטית, בלי העתקה ידנית.',
      },
    },
    {
      '@type': 'Question',
      name: 'איך מייבאים לידים מאקסל?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'מעלים קובץ אקסל עם עמודות שם, טלפון ומקור. המערכת מייבאת את כל הלידים בכמה שניות ומאפשרת להתחיל לעבוד מיד.',
      },
    },
    {
      '@type': 'Question',
      name: 'האם אפשר לנהל צוות נציגים במערכת?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'כן. ניתן לשייך לידים לנציגים ספציפיים, לראות את ביצועי כל נציג, ולנהל צוותי מכירות שלמים מממשק אחד.',
      },
    },
    {
      '@type': 'Question',
      name: 'כמה זמן לוקח להתחיל לעבוד עם המערכת?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'ההרשמה לוקחת פחות מדקה. ניתן להוסיף לידים ולהתחיל לעבוד מיד. חיבור לפייסבוק לוקח כ-5 דקות.',
      },
    },
    {
      '@type': 'Question',
      name: 'מה ההבדל בין SocialCRM למערכות CRM אחרות?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'SocialCRM בנויה ספציפית לעסקים קטנים שמקבלים לידים ממדיה חברתית. היא פשוטה, בעברית, ומותאמת לשוק הישראלי, בלי עומס של פיצ\'רים שלא צריכים.',
      },
    },
  ],
}

const webPageSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': 'https://socialcrm.vercel.app/features',
  url: 'https://socialcrm.vercel.app/features',
  name: 'מערכת ניהול לידים לעסקים קטנים | SocialCRM',
  description: 'SocialCRM, מערכת CRM בעברית לניהול לידים מפייסבוק, אינסטגרם ווואטסאפ.',
  inLanguage: 'he',
  isPartOf: { '@id': 'https://socialcrm.vercel.app/#website' },
  about: { '@id': 'https://socialcrm.vercel.app/#software' },
  breadcrumb: {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'דף הבית', item: 'https://socialcrm.vercel.app/auth' },
      { '@type': 'ListItem', position: 2, name: 'פיצ\'רים', item: 'https://socialcrm.vercel.app/features' },
    ],
  },
}

const features = [
  {
    title: 'חיבור אוטומטי לפייסבוק',
    description:
      'מחברים את דף הפייסבוק העסקי פעם אחת. מאותו רגע כל ליד שממלא טופס מגיע ישירות למערכת, בלי העתקה ידנית, בלי שכחה.',
    icon: 'plug' as const,
  },
  {
    title: 'ייבוא לידים מאקסל',
    description:
      'יש רשימת לידים ישנה? מעלים קובץ אקסל ובשניות כל הלידים מאורגנים במערכת עם סטטוס, שם ומספר טלפון.',
    icon: 'file-excel' as const,
  },
  {
    title: 'ניהול סטטוס ומעקב',
    description:
      'כל ליד עובר בין סטטוסים: חדש, בטיפול, סגור, אבוד. תמיד ברור מה הצעד הבא ומי צריך טיפול דחוף.',
    icon: 'circle-check' as const,
  },
  {
    title: 'שיוך לנציגים',
    description:
      'שייך כל ליד לנציג מכירות ספציפי. כל נציג רואה רק את הלידים שלו. מנהל רואה את כולם.',
    icon: 'user-tie' as const,
  },
  {
    title: 'מעקב ומשימות',
    description:
      'מוסיפים תזכורות ומשימות לכל ליד. המערכת תזכיר מתי לחזור, כך שאף ליד לא נשכח.',
    icon: 'bell' as const,
  },
  {
    title: 'דוחות מכירות',
    description:
      'ראה כמה לידים נסגרו, מי הנציג הכי יעיל, ואיזה מקור מביא הכי הרבה עסקאות, הכל בדוח אחד.',
    icon: 'chart-line' as const,
  },
]

export default function FeaturesPage() {
  return (
    <>
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageSchema) }} />

      <MarketingLayout>
        {/* Hero */}
        <section className='py-20 px-8 text-center' style={{ backgroundColor: '#f3f2ff' }}>
          <nav aria-label='breadcrumb' className='text-sm text-gray-400 mb-6'>
            <Link href='/auth' className='hover:underline'>דף הבית</Link>
            <span className='mx-2'>/</span>
            <span>פיצ'רים</span>
          </nav>
          <h1 className='text-4xl lg:text-5xl font-bold mb-4' style={{ color: '#171424' }}>
            מערכת ניהול לידים לעסקים קטנים
          </h1>
          <p className='text-gray-500 text-lg max-w-2xl mx-auto mb-8'>
            כל הלידים מפייסבוק, אינסטגרם ווואטסאפ, במקום אחד. ניהול, מעקב, וסגירת עסקאות. בלי לפספס אף ליד.
          </p>
          <Link
            href='/auth'
            className='inline-block px-8 py-3 rounded-lg text-white font-semibold text-lg'
            style={{ backgroundColor: '#3f20f5' }}
          >
            התחל בחינם עכשיו
          </Link>
        </section>

        {/* Problem section */}
        <section className='py-16 px-8 max-w-4xl mx-auto'>
          <h2 className='text-2xl font-bold text-center mb-4'>למה לידים הולכים לאיבוד?</h2>
          <p className='text-gray-500 text-center max-w-2xl mx-auto mb-10'>
            ליד מגיע מפייסבוק, נשכח בווטסאפ. עוד ליד נכנס למייל, לא מטופל. אקסל מתעדכן רק כשזוכרים. התוצאה, עסקאות שהולכות לאיבוד.
          </p>

          <div className='grid md:grid-cols-3 gap-6 text-center'>
            {[
              { stat: '78%', label: 'מהלידים לא מקבלים מענה תוך 5 דקות' },
              { stat: '44%', label: 'מהלידים נשכחים לחלוטין ללא מעקב' },
              { stat: '3x', label: 'יותר סיכוי לסגור ליד שמטופל מיד' },
            ].map((item) => (
              <div key={item.stat} className='p-6 rounded-lg border border-gray-100'>
                <div className='text-4xl font-bold mb-2' style={{ color: '#3f20f5' }}>{item.stat}</div>
                <div className='text-gray-500 text-sm'>{item.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className='py-16 px-8' style={{ backgroundColor: '#f9f9f9' }}>
          <div className='max-w-4xl mx-auto'>
            <h2 className='text-2xl font-bold text-center mb-2'>הכל שצריך לנהל לידים</h2>
            <p className='text-gray-500 text-center mb-10'>פשוט, ברור, ויעיל, בלי עודף פיצ'רים שלא צריך</p>

            <div className='grid md:grid-cols-2 lg:grid-cols-3 gap-6'>
              {features.map((f) => (
                <article key={f.title} className='bg-white rounded-lg p-6 shadow-sm'>
                  <Icon name={f.icon} className='size-6 mb-3' style={{ color: '#3f20f5' }} />
                  <h3 className='font-bold text-lg mb-2'>{f.title}</h3>
                  <p className='text-gray-500 text-sm leading-relaxed'>{f.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className='py-16 px-8 max-w-3xl mx-auto'>
          <h2 className='text-2xl font-bold text-center mb-10'>איך זה עובד?</h2>
          <ol className='grid md:grid-cols-2 gap-6'>
            {[
              { step: '1', title: 'נרשמים', desc: 'הרשמה עם גוגל, פחות מדקה, בלי כרטיס אשראי.' },
              { step: '2', title: 'מחברים את הלידים', desc: 'מחברים דף פייסבוק או מעלים אקסל עם הלידים הקיימים.' },
              { step: '3', title: 'מתחילים לעבוד', desc: 'רואים את כל הלידים, מעדכנים סטטוס, מתקשרים, וסוגרים עסקאות.' },
            ].map((item) => (
              <li key={item.step} className='flex gap-4 items-center bg-white rounded-lg p-6 shadow-sm border border-gray-100'>
                <div
                  className='size-10 rounded-full flex items-center justify-center font-bold text-white shrink-0'
                  style={{ backgroundColor: '#3f20f5' }}
                >
                  {item.step}
                </div>
                <div className='flex-1'>
                  <h3 className='font-bold text-lg'>{item.title}</h3>
                  <p className='text-gray-500 text-sm mt-1'>{item.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* FAQ */}
        <section className='py-16 px-8' style={{ backgroundColor: '#f9f9f9' }}>
          <div className='max-w-2xl mx-auto'>
            <h2 className='text-2xl font-bold text-center mb-8'>שאלות נפוצות</h2>
            <div className='bg-white rounded-lg shadow-sm overflow-hidden'>
              {faqSchema.mainEntity.map((item) => (
                <AccordionItem
                  key={item.name}
                  title={item.name}
                  className='flex items-center justify-between px-5 py-4 cursor-pointer select-none'
                  bodyClass='px-5 pb-4 text-gray-500 text-sm leading-relaxed'
                >
                  {item.acceptedAnswer.text}
                </AccordionItem>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className='py-20 px-8 text-center' style={{ backgroundColor: '#171424' }}>
          <h2 className='text-3xl font-bold text-white mb-4'>מוכן להפסיק לפספס לידים?</h2>
          <p className='text-gray-400 mb-8'>הרשמה בחינם, לא צריך כרטיס אשראי.</p>
          <Link
            href='/auth/register'
            className='inline-block px-8 py-3 rounded-lg text-white font-semibold text-lg'
            style={{ backgroundColor: '#3f20f5' }}
          >
            התחל בחינם עכשיו
          </Link>
        </section>

      </MarketingLayout>
    </>
  )
}
