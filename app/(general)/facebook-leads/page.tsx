import Link from 'next/link'
import { Metadata } from 'next'
import AccordionItem from '@/lib/AccordionItem'
import { MarketingLayout } from '@/components/seo/MarketingLayout'

export const metadata: Metadata = {
  title: 'ניהול לידים מפייסבוק, אוטומטי וחכם | SocialCRM',
  description:
    'חבר את דף הפייסבוק שלך ל-SocialCRM וקבל כל ליד שממלא טופס מודעה, ישירות למערכת, אוטומטית. בלי העתקה ידנית, בלי שכחה.',
  alternates: {
    canonical: 'https://socialcrm.vercel.app/facebook-leads',
  },
  openGraph: {
    title: 'ניהול לידים מפייסבוק, אוטומטי וחכם | SocialCRM',
    description: 'לידים מטפסי פייסבוק מגיעים ישירות למערכת. חיבור של 5 דקות, חיסכון של שעות.',
    url: 'https://socialcrm.vercel.app/facebook-leads',
  },
}

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'איך מחברים לידים מפייסבוק למערכת?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'נכנסים להגדרות, בוחרים "חבר פייסבוק", ומתחברים עם חשבון הפייסבוק העסקי. מאותו רגע כל ליד שממלא טופס מגיע אוטומטית למערכת.',
      },
    },
    {
      '@type': 'Question',
      name: 'כמה זמן לוקח להגדיר את האינטגרציה עם פייסבוק?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'כ-5 דקות. מתחברים עם חשבון פייסבוק, בוחרים את הדף העסקי, ומאשרים הרשאות. זהו.',
      },
    },
    {
      '@type': 'Question',
      name: 'האם כל הלידים מפייסבוק מגיעים אוטומטית?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'כן. כל ליד שממלא טופס Lead Ad בפייסבוק מגיע למערכת תוך שניות, כולל השם, הטלפון, ופרטים נוספים שהגדרת בטופס.',
      },
    },
    {
      '@type': 'Question',
      name: 'האם אפשר לחבר כמה דפי פייסבוק?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'כן. ניתן לחבר מספר דפי פייסבוק לאותה מערכת. כל ליד מזוהה לפי הדף שממנו הגיע.',
      },
    },
    {
      '@type': 'Question',
      name: 'מה קורה אם הקישור לפייסבוק מתנתק?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'המערכת מזהה ניתוק ומיידעת אותך. ניתן לחבר מחדש בלחיצה אחת מהגדרות החשבון.',
      },
    },
    {
      '@type': 'Question',
      name: 'האם SocialCRM עובד עם מודעות Lead Ads בפייסבוק?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'כן. SocialCRM מתחבר ישירות ל-Facebook Lead Ads API ומביא כל ליד חדש שמגיע מטפסי המודעות שלך.',
      },
    },
  ],
}

const howToSchema = {
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name: 'איך לחבר לידים מפייסבוק ל-SocialCRM',
  description: 'מדריך לחיבור לידים מפייסבוק Lead Ads ישירות ל-SocialCRM',
  inLanguage: 'he',
  step: [
    {
      '@type': 'HowToStep',
      position: 1,
      name: 'נרשמים ל-SocialCRM',
      text: 'יוצרים חשבון ב-SocialCRM עם חשבון גוגל.',
    },
    {
      '@type': 'HowToStep',
      position: 2,
      name: 'נכנסים להגדרות פייסבוק',
      text: 'בתפריט ההגדרות בוחרים "חיבור פייסבוק".',
    },
    {
      '@type': 'HowToStep',
      position: 3,
      name: 'מתחברים עם חשבון פייסבוק',
      text: 'מאשרים הרשאות לפייסבוק ובוחרים את הדף העסקי.',
    },
    {
      '@type': 'HowToStep',
      position: 4,
      name: 'לידים מגיעים אוטומטית',
      text: 'מעכשיו כל ליד שממלא טופס מגיע ישירות למערכת.',
    },
  ],
}

const webPageSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': 'https://socialcrm.vercel.app/facebook-leads',
  url: 'https://socialcrm.vercel.app/facebook-leads',
  name: 'ניהול לידים מפייסבוק, SocialCRM',
  inLanguage: 'he',
  isPartOf: { '@id': 'https://socialcrm.vercel.app/#website' },
  breadcrumb: {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'דף הבית', item: 'https://socialcrm.vercel.app/auth' },
      { '@type': 'ListItem', position: 2, name: 'ניהול לידים מפייסבוק', item: 'https://socialcrm.vercel.app/facebook-leads' },
    ],
  },
}

export default function FacebookLeadsPage() {
  return (
    <>
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(howToSchema) }} />
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageSchema) }} />

      <MarketingLayout>
        {/* Hero */}
        <section className='py-20 px-8 text-center' style={{ backgroundColor: '#f3f2ff' }}>
          <nav aria-label='breadcrumb' className='text-sm text-gray-400 mb-6'>
            <Link href='/auth' className='hover:underline'>דף הבית</Link>
            <span className='mx-2'>/</span>
            <span>ניהול לידים מפייסבוק</span>
          </nav>
          <h1 className='text-4xl lg:text-5xl font-bold mb-4' style={{ color: '#171424' }}>
            לידים מפייסבוק, ישירות למערכת, אוטומטית
          </h1>
          <p className='text-gray-500 text-lg max-w-2xl mx-auto mb-8'>
            חיבור של 5 דקות. מאותו רגע כל ליד שממלא טופס Facebook Lead Ad מגיע ישירות ל-SocialCRM, בלי העתקה ידנית, בלי שכחה.
          </p>
          <Link
            href='/auth'
            className='inline-block px-8 py-3 rounded-lg text-white font-semibold text-lg'
            style={{ backgroundColor: '#3f20f5' }}
          >
            חבר את הפייסבוק שלך עכשיו
          </Link>
        </section>

        {/* How it works */}
        <section className='py-16 px-8 max-w-3xl mx-auto'>
          <h2 className='text-2xl font-bold text-center mb-10'>איך זה עובד?</h2>
          <ol className='grid md:grid-cols-2 gap-6'>
            {howToSchema.step.map((item) => (
              <li key={item.position} className='flex gap-5 items-center bg-white rounded-lg p-6 shadow-sm border border-gray-100'>
                <div
                  className='size-10 rounded-full flex items-center justify-center font-bold text-white shrink-0 text-lg'
                  style={{ backgroundColor: '#3f20f5' }}
                >
                  {item.position}
                </div>
                <div className='flex-1'>
                  <h3 className='font-bold text-lg'>{item.name}</h3>
                  <p className='text-gray-500 text-sm mt-1'>{item.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Why section */}
        <section className='py-16 px-8' style={{ backgroundColor: '#f9f9f9' }}>
          <div className='max-w-4xl mx-auto'>
            <h2 className='text-2xl font-bold text-center mb-2'>למה זה כל כך חשוב?</h2>
            <p className='text-gray-500 text-center mb-10'>
              מחקרים מראים שסיכוי המכירה יורד ב-80% אחרי 5 דקות ממילוי הטופס. עם SocialCRM הלידים מגיעים מיידית.
            </p>
            <div className='grid md:grid-cols-3 gap-6'>
              {[
                {
                  title: 'מענה מיידי',
                  desc: 'ליד שמגיע מיידית למערכת מטופל מהר, הסיכוי לסגירה גבוה פי 3.',
                },
                {
                  title: 'אפס שכחות',
                  desc: 'לא עוד לידים שנשכחים ב-Messenger או בדוא"ל. הכל מגיע לרשימה אחת.',
                },
                {
                  title: 'מעקב מלא',
                  desc: 'כל ליד מפייסבוק מסומן עם המקור, כך שיודעים מאיזה קמפיין הגיע.',
                },
              ].map((item) => (
                <article key={item.title} className='bg-white rounded-lg p-6 shadow-sm'>
                  <h3 className='font-bold text-lg mb-2'>{item.title}</h3>
                  <p className='text-gray-500 text-sm leading-relaxed'>{item.desc}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className='py-16 px-8'>
          <div className='max-w-2xl mx-auto'>
            <h2 className='text-2xl font-bold text-center mb-8'>שאלות נפוצות על לידים מפייסבוק</h2>
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
          <h2 className='text-3xl font-bold text-white mb-4'>מוכן לקבל לידים מפייסבוק אוטומטית?</h2>
          <p className='text-gray-400 mb-8'>חיבור של 5 דקות. לא צריך כרטיס אשראי.</p>
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
