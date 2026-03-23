import Link from 'next/link'
import { Metadata } from 'next'
import { MarketingLayout } from '@/components/seo/MarketingLayout'
import { FAQSection, buildFAQSchema } from '@/components/seo/FAQ'
import { Hero } from '@/components/seo/Hero'

export const metadata: Metadata = {
  title: 'CRM לעומת אקסל לניהול לידים, השוואה מלאה | SocialCRM',
  description:
    'השוואה ישירה: CRM לעומת אקסל לניהול לידים. מה אקסל נותן, מה הוא לא יכול לעשות, ומתי כדאי לעסק קטן לעבור למערכת CRM.',
  alternates: { canonical: 'https://socialcrm.vercel.app/crm-vs-excel' },
  openGraph: {
    title: 'CRM לעומת אקסל, מה עדיף לניהול לידים?',
    description: 'השוואה מלאה: CRM לעומת אקסל. ראה בדיוק מה אתה מפסיד כשמנהלים לידים באקסל.',
    url: 'https://socialcrm.vercel.app/crm-vs-excel',
  },
}

const faqItems = [
  {
    question: 'האם אפשר לנהל לידים באקסל?',
    answer:
      'כן, אפשר, אבל רק עד נקודה מסוימת. אקסל עובד כשיש מעט לידים ונציג אחד. כשהנפח גדל, מתחילות הבעיות: כפילויות, עדכונים שנשכחים, ואין חיבור אוטומטי למקורות הלידים.',
  },
  {
    question: 'מתי כדאי לעבור מאקסל למערכת CRM?',
    answer:
      'כשמגיעים ל-30+ לידים בחודש, כשיש יותר מנציג אחד, או כשמרגישים שלידים הולכים לאיבוד, הגיע הזמן לעבור. מערכת CRM חוסכת זמן ומונעת אובדן עסקאות.',
  },
  {
    question: 'כמה זמן לוקח לייבא לידים מאקסל ל-SocialCRM?',
    answer:
      'כמה דקות. מעלים את קובץ האקסל, ממפים את העמודות, ומאשרים. כל הלידים מגיעים מיידית למערכת.',
  },
  {
    question: 'האם איבד נתונים כשעוברים מאקסל ל-CRM?',
    answer:
      'לא. ניתן לייבא את כל הלידים הקיימים מהאקסל ל-SocialCRM. כל הנתונים עוברים, שם, טלפון, מייל ועוד.',
  },
  {
    question: 'מה עדיף, Google Sheets או CRM?',
    answer:
      'Google Sheets עדיף על אקסל כי הוא משותף, אבל עדיין סובל מאותן בעיות: אין חיבור לפייסבוק, אין תזכורות, אין שיוך נציגים. CRM ייעודי עדיף לכל הגדלים מעל 20 לידים בחודש.',
  },
]

// Comparison data, the most AIO-valuable asset on this page
const COMPARISON_ROWS = [
  { feature: 'מרכוז לידים ממקורות שונים', excel: false, crm: true },
  { feature: 'חיבור אוטומטי לפייסבוק Lead Ads', excel: false, crm: true },
  { feature: 'עדכון סטטוס לכל ליד', excel: 'ידני', crm: true },
  { feature: 'שיוך לנציגים שונים', excel: false, crm: true },
  { feature: 'תזכורות ומעקב', excel: false, crm: true },
  { feature: 'היסטוריה של שיחות והערות', excel: false, crm: true },
  { feature: 'גישה מניידים', excel: 'מוגבל', crm: true },
  { feature: 'מניעת כפילויות', excel: false, crm: true },
  { feature: 'דוחות ביצועים', excel: 'ידני', crm: true },
  { feature: 'ייבוא לידים מאקסל', excel: true, crm: true },
  { feature: 'שיתוף צוות בזמן אמת', excel: 'מוגבל', crm: true },
  { feature: 'עלות', excel: 'חינם', crm: 'נמוכה' },
]

function CellValue({ val }: { val: boolean | string }) {
  if (val === true) return <span className='text-green-600 font-bold text-lg'>✓</span>
  if (val === false) return <span className='text-red-400 font-bold text-lg'>✗</span>
  return <span className='text-yellow-600 text-sm font-medium'>{val}</span>
}

const pageSchema = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  '@id': 'https://socialcrm.vercel.app/crm-vs-excel',
  headline: 'CRM לעומת אקסל לניהול לידים, השוואה מלאה',
  description: 'השוואה ישירה בין מערכת CRM לאקסל לניהול לידים. מתי כדאי לעבור, ומה מפסידים בכל בחירה.',
  inLanguage: 'he',
  url: 'https://socialcrm.vercel.app/crm-vs-excel',
  publisher: { '@id': 'https://socialcrm.vercel.app/#organization' },
  breadcrumb: {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'דף הבית', item: 'https://socialcrm.vercel.app/auth' },
      { '@type': 'ListItem', position: 2, name: 'ניהול לידים', item: 'https://socialcrm.vercel.app/crm' },
      { '@type': 'ListItem', position: 3, name: 'CRM לעומת אקסל', item: 'https://socialcrm.vercel.app/crm-vs-excel' },
    ],
  },
}

const faqSchema = buildFAQSchema(faqItems)

export default function CRMvsExcelPage() {
  return (
    <>
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(pageSchema) }} />
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />

      <MarketingLayout>
        <Hero
          breadcrumbs={[
            { label: 'דף הבית', href: '/auth' },
            { label: 'ניהול לידים', href: '/crm' },
            { label: 'CRM לעומת אקסל', href: '/crm-vs-excel' },
          ]}
          title='CRM לעומת אקסל, מה עדיף לניהול לידים?'
          subtitle='אקסל עובד עד נקודה מסוימת. ראה בדיוק מה הפרש בין ניהול לידים באקסל לבין מערכת CRM ייעודית, ומתי הזמן לעבור.'
          cta={{ label: 'נסה SocialCRM בחינם', href: '/auth' }}
          secondaryCta={{ label: 'ראה את כל הפיצ\'רים', href: '/features' }}
        />

        {/* Excel pros & cons, AIO entity definition */}
        <section className='py-16 px-8 max-w-4xl mx-auto'>
          <h2 className='text-2xl font-bold mb-8'>ניהול לידים באקסל, היתרונות והחסרונות</h2>
          <div className='grid md:grid-cols-2 gap-8'>
            <div>
              <h3 className='font-bold text-lg mb-4 text-green-700'>יתרונות אקסל</h3>
              <ul className='grid gap-3'>
                {[
                  'חינמי לגמרי',
                  'מוכר לכולם, אין צורך להתאמן',
                  'גמיש, כל עמודה שרוצים',
                  'אפשר לשתף בגוגל שיטס',
                ].map((item) => (
                  <li key={item} className='flex gap-2 items-start text-gray-600 text-sm'>
                    <span className='text-green-500 mt-0.5'>✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className='font-bold text-lg mb-4 text-red-600'>חסרונות אקסל לניהול לידים</h3>
              <ul className='grid gap-3'>
                {[
                  'לידים מפייסבוק לא מגיעים אוטומטית, צריך להעתיק ידנית',
                  'אין תזכורות, נשכח לחזור ללידים',
                  'אין שיוך נציגים, בלאגן כשיש צוות',
                  'כפילויות, אותו ליד פעמיים ואף אחד לא יודע',
                  'אין היסטוריה, מה דיברתם? לא ידוע',
                  'אין דוחות אמיתיים, צריך לחשב ידנית',
                ].map((item) => (
                  <li key={item} className='flex gap-2 items-start text-gray-600 text-sm'>
                    <span className='text-red-400 mt-0.5'>✗</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Comparison table, the AIO goldmine */}
        <section className='py-16 px-8' style={{ backgroundColor: '#f9f9f9' }}>
          <div className='max-w-3xl mx-auto'>
            <h2 className='text-2xl font-bold text-center mb-2'>השוואה ישירה: CRM לעומת אקסל</h2>
            <p className='text-gray-500 text-center mb-8'>כל מה שחשוב, שורה אחרי שורה</p>

            <div className='overflow-x-auto rounded-xl shadow-sm'>
              <table className='w-full bg-white' aria-label='השוואת CRM לעומת אקסל לניהול לידים'>
                <thead>
                  <tr style={{ backgroundColor: '#171424' }}>
                    <th className='text-right text-white text-sm font-semibold py-4 px-6'>יכולת</th>
                    <th className='text-center text-white text-sm font-semibold py-4 px-4'>אקסל / Sheets</th>
                    <th className='text-center text-white text-sm font-semibold py-4 px-4'>SocialCRM</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map((row, i) => (
                    <tr
                      key={row.feature}
                      className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                    >
                      <td className='text-sm text-gray-700 py-3 px-6'>{row.feature}</td>
                      <td className='text-center py-3 px-4'>
                        <CellValue val={row.excel} />
                      </td>
                      <td className='text-center py-3 px-4'>
                        <CellValue val={row.crm} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* When to switch */}
        <section className='py-16 px-8 max-w-3xl mx-auto'>
          <h2 className='text-2xl font-bold mb-6'>מתי כדאי לעבור מאקסל ל-CRM?</h2>
          <p className='text-gray-600 leading-relaxed mb-6'>
            אקסל מספיק לעסק בתחילת דרכו עם מעט לידים ונציג אחד. אבל ברגע שאחד מהתנאים הבאים מתקיים, הגיע הזמן לעבור:
          </p>
          <ul className='grid gap-4'>
            {[
              { trigger: 'יש יותר מ-30 לידים בחודש', why: 'כשהנפח גדל, אקסל נהיה כבד לעבודה ומועד לטעויות.' },
              { trigger: 'יש יותר מנציג מכירות אחד', why: 'שיתוף פעולה על אקסל מוביל לכפילויות ולבלאגן.' },
              { trigger: 'לידים "נעלמים" או לא מטופלים', why: 'אם מרגישים שמפספסים לידים, זה כבר קרה.' },
              { trigger: 'לידים מגיעים מפייסבוק', why: 'העתקה ידנית מפייסבוק לאקסל בזבוז זמן ומועדת לשגיאות.' },
              { trigger: 'רוצים לדעת כמה הרווחנו מלידים', why: 'דוחות אמיתיים דורשים מערכת, לא טבלאות ידניות.' },
            ].map((item) => (
              <li key={item.trigger} className='flex gap-4 items-start p-4 bg-gray-50 rounded-lg'>
                <span className='text-xl mt-0.5' aria-hidden='true'>→</span>
                <div>
                  <span className='font-semibold'>{item.trigger}</span>
                  <p className='text-gray-500 text-sm mt-0.5'>{item.why}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Migration section */}
        <section className='py-16 px-8' style={{ backgroundColor: '#f3f2ff' }}>
          <div className='max-w-3xl mx-auto text-center'>
            <h2 className='text-2xl font-bold mb-4'>עוברים מאקסל? תוך 5 דקות.</h2>
            <p className='text-gray-500 mb-8 max-w-lg mx-auto leading-relaxed'>
              לא צריך להזין מחדש. מעלים את קובץ האקסל, ממפים שם + טלפון, ולחיצה אחת, כל הלידים מגיעים ל-SocialCRM.
            </p>
            <div className='flex flex-wrap gap-3 justify-center'>
              <Link
                href='/auth/register'
                className='inline-block px-8 py-3 rounded-lg text-white font-semibold'
                style={{ backgroundColor: '#3f20f5' }}
              >
                ייבא את האקסל שלך עכשיו
              </Link>
              <Link
                href='/features'
                className='inline-block px-8 py-3 rounded-lg font-semibold border'
                style={{ borderColor: '#3f20f5', color: '#3f20f5' }}
              >
                ראה איך ייבוא עובד
              </Link>
            </div>
          </div>
        </section>

        <FAQSection title='שאלות נפוצות, CRM לעומת אקסל' items={faqItems} />

        {/* Related links, internal linking */}
        <section className='py-12 px-8 max-w-4xl mx-auto'>
          <h2 className='text-lg font-bold mb-4'>קרא גם</h2>
          <div className='grid md:grid-cols-3 gap-4'>
            {[
              { title: 'ניהול לידים, המדריך המלא', href: '/crm', desc: 'כל מה שצריך לדעת על ניהול לידים לעסקים קטנים.' },
              { title: 'לידים מפייסבוק, אוטומטי', href: '/facebook-leads', desc: 'חיבור של 5 דקות. לידים מגיעים ישירות למערכת.' },
              { title: 'לידים מוואטסאפ', href: '/whatsapp-leads', desc: 'ייבא ונהל לידים שמגיעים בוואטסאפ.' },
            ].map((item) => (
              <Link key={item.href} href={item.href} className='block p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors'>
                <h3 className='font-semibold mb-1 text-sm'>{item.title}</h3>
                <p className='text-gray-500 text-xs'>{item.desc}</p>
              </Link>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className='py-20 px-8 text-center' style={{ backgroundColor: '#171424' }}>
          <h2 className='text-3xl font-bold text-white mb-4'>מוכן לעזוב את האקסל?</h2>
          <p className='text-gray-400 mb-8'>הרשמה בחינם. ייבוא מאקסל בשניות. לא צריך כרטיס אשראי.</p>
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
