import Link from 'next/link'
import { Metadata } from 'next'
import { MarketingLayout } from '@/components/seo/MarketingLayout'
import { FAQSection, buildFAQSchema } from '@/components/seo/FAQ'
import { Hero } from '@/components/seo/Hero'

export const metadata: Metadata = {
  title: 'ניהול לידים מוואטסאפ | SocialCRM',
  description:
    'ייבא ונהל לידים שמגיעים בוואטסאפ. הוסף ידנית, ייבא מספרים, ונהל הכל מתוך SocialCRM, מערכת ניהול לידים לעסקים קטנים.',
  alternates: { canonical: 'https://socialcrm.vercel.app/whatsapp-leads' },
  openGraph: {
    title: 'ניהול לידים מוואטסאפ | SocialCRM',
    description: 'לידים מוואטסאפ? מייבאים, מנהלים, ומוודאים שאף אחד לא נשכח.',
    url: 'https://socialcrm.vercel.app/whatsapp-leads',
  },
}

const faqItems = [
  {
    question: 'איך מייבאים לידים מוואטסאפ ל-SocialCRM?',
    answer:
      'ניתן להוסיף לידים מוואטסאפ בשתי דרכים: הוספה ידנית מהירה (שם + טלפון בשניות), או ייבוא מאקסל אם יש רשימה של מספרים.',
  },
  {
    question: 'האם יש אינטגרציה ישירה עם וואטסאפ?',
    answer:
      'SocialCRM לא קוראת את ההודעות בוואטסאפ. במקום זאת, מוסיפים לידים מוואטסאפ ידנית (מהיר מאוד) ואז כל התקשורת והמעקב מתנהלים בתוך SocialCRM.',
  },
  {
    question: 'מהי הדרך הכי מהירה להוסיף ליד מוואטסאפ?',
    answer:
      'לוחצים "הוסף ליד", מזינים שם ומספר טלפון (10 שניות), ובוחרים מקור "וואטסאפ". הליד מיד מופיע ברשימה ומחכה לטיפול.',
  },
  {
    question: 'איך מבדילים בין לידים מוואטסאפ ללידים מפייסבוק?',
    answer:
      'כל ליד ב-SocialCRM מוגדר עם מקור. ניתן לסנן ולראות רק לידים מוואטסאפ, רק מפייסבוק, או הכל יחד.',
  },
  {
    question: 'מה עושים עם ליד שפנה בוואטסאפ ולא מוכר לקנות עכשיו?',
    answer:
      'מוסיפים תזכורת, "לחזור עוד שבועיים". המערכת תזכיר. כך לא מפספסים לידים שרק צריכים יותר זמן.',
  },
]

const faqSchema = buildFAQSchema(faqItems)

const pageSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': 'https://socialcrm.vercel.app/whatsapp-leads',
  url: 'https://socialcrm.vercel.app/whatsapp-leads',
  name: 'ניהול לידים מוואטסאפ | SocialCRM',
  description: 'ייבא ונהל לידים שמגיעים בוואטסאפ עם SocialCRM.',
  inLanguage: 'he',
  isPartOf: { '@id': 'https://socialcrm.vercel.app/#website' },
  breadcrumb: {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'דף הבית', item: 'https://socialcrm.vercel.app/' },
      { '@type': 'ListItem', position: 2, name: 'ניהול לידים', item: 'https://socialcrm.vercel.app/crm' },
      { '@type': 'ListItem', position: 3, name: 'לידים מוואטסאפ', item: 'https://socialcrm.vercel.app/whatsapp-leads' },
    ],
  },
}

const WHATSAPP_PROBLEMS = [
  {
    title: 'לידים קבורים בהיסטוריית שיחות',
    desc: 'ליד פנה לפני שבוע, ועכשיו צריך לגלול 200 הודעות כדי למצוא אותו.',
  },
  {
    title: 'אין מעקב אחרי מי עדיין ממתין',
    desc: 'מי חיכה למחיר? מי רצה שנחזור? אין דרך לדעת מבלי לקרוא את כל השיחות.',
  },
  {
    title: 'לידים שנשכחים',
    desc: 'הבטחת לחזור אליו ביום שלישי. שכחת. הליד עבר למתחרה.',
  },
  {
    title: 'אי אפשר לשתף עם נציג',
    desc: 'כשמעבירים שיחת וואטסאפ לנציג, הקשר הולך לאיבוד. אין היסטוריה.',
  },
]

const ADD_METHODS = [
  {
    title: 'הוספה ידנית מהירה',
    desc: 'לוחצים "הוסף ליד", מזינים שם ומספר, בוחרים מקור "וואטסאפ". 10 שניות.',
    badge: 'הכי נפוץ',
  },
  {
    title: 'ייבוא מאקסל',
    desc: 'יש רשימת מספרים? מעלים קובץ אקסל עם שמות ומספרים, הכל מגיע בבת אחת.',
    badge: null,
  },
  {
    title: 'ייבוא מספרי טלפון',
    desc: 'מעתיקים רשימת מספרים ישירות, המערכת יוצרת ליד לכל מספר.',
    badge: null,
  },
]

export default function WhatsAppLeadsPage() {
  return (
    <>
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(pageSchema) }} />
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />

      <MarketingLayout>
        <Hero
          breadcrumbs={[
            { label: 'דף הבית', href: '/' },
            { label: 'ניהול לידים', href: '/crm' },
            { label: 'לידים מוואטסאפ', href: '/whatsapp-leads' },
          ]}
          title='לידים מוואטסאפ, נהל אותם, אל תאבד אותם'
          subtitle='לידים שמגיעים בוואטסאפ נשכחים בקלות בתוך ערימת ההודעות. SocialCRM נותנת להם מקום, ומוודאת שכל אחד מטופל.'
          cta={{ label: 'התחל לנהל לידים מוואטסאפ', href: '/auth/register' }}
          secondaryCta={{ label: 'ראה את כל הפיצ\'רים', href: '/features' }}
        />

        {/* Problem definition */}
        <section className='py-16 px-8 max-w-4xl mx-auto'>
          <h2 className='text-2xl font-bold text-center mb-2'>הבעיה עם ניהול לידים בוואטסאפ</h2>
          <p className='text-gray-500 text-center mb-10 max-w-2xl mx-auto'>
            וואטסאפ הוא כלי תקשורת מעולה, אבל כלי ניהול לידים גרוע. הנה למה:
          </p>
          <div className='grid md:grid-cols-2 gap-5'>
            {WHATSAPP_PROBLEMS.map((item) => (
              <article key={item.title} className='p-5 rounded-lg border border-gray-100 border-r-4' style={{ borderRightColor: '#3f20f5' }}>
                <h3 className='font-bold mb-2'>{item.title}</h3>
                <p className='text-gray-500 text-sm leading-relaxed'>{item.desc}</p>
              </article>
            ))}
          </div>
        </section>

        {/* How to add WhatsApp leads */}
        <section className='py-16 px-8' style={{ backgroundColor: '#f9f9f9' }}>
          <div className='max-w-4xl mx-auto'>
            <h2 className='text-2xl font-bold text-center mb-2'>איך מוסיפים לידים מוואטסאפ ל-SocialCRM?</h2>
            <p className='text-gray-500 text-center mb-10'>שלוש דרכים, בחר מה שנוח לך</p>
            <div className='grid md:grid-cols-3 gap-6'>
              {ADD_METHODS.map((m) => (
                <article key={m.title} className='bg-white rounded-lg p-6 shadow-sm relative'>
                  {m.badge && (
                    <span
                      className='absolute top-4 left-4 text-xs px-2 py-0.5 rounded-full text-white font-medium'
                      style={{ backgroundColor: '#3f20f5' }}
                    >
                      {m.badge}
                    </span>
                  )}
                  <h3 className='font-bold text-lg mb-2 mt-2'>{m.title}</h3>
                  <p className='text-gray-500 text-sm leading-relaxed'>{m.desc}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* After adding, what happens */}
        <section className='py-16 px-8 max-w-3xl mx-auto'>
          <h2 className='text-2xl font-bold text-center mb-10'>אחרי שמוסיפים, מה מקבלים?</h2>
          <ol className='grid md:grid-cols-2 gap-5'>
            {[
              { n: 1, title: 'ליד מופיע ברשימה', desc: 'שם, טלפון, מקור "וואטסאפ", סטטוס "חדש". ברור ומאורגן.' },
              { n: 2, title: 'מוסיפים הערות', desc: 'מה הוא ביקש? מה עוד רלוונטי? הכל נשמר על הליד לצמיתות.' },
              { n: 3, title: 'מגדירים תזכורת', desc: '"לחזור ב-15 לחודש", המערכת תזכיר. לא שוכחים יותר.' },
              { n: 4, title: 'מעדכנים סטטוס', desc: 'ליד סגר עסקה? לחיצה אחת, "סגור". הנתונים מתעדכנים מיידית בדוחות.' },
            ].map((item) => (
              <li key={item.n} className='flex gap-4 items-center bg-white rounded-lg p-6 shadow-sm border border-gray-100'>
                <div
                  className='size-9 rounded-full flex items-center justify-center font-bold text-white shrink-0 text-sm'
                  style={{ backgroundColor: '#3f20f5' }}
                >
                  {item.n}
                </div>
                <div className='flex-1'>
                  <h3 className='font-bold'>{item.title}</h3>
                  <p className='text-gray-500 text-sm mt-0.5'>{item.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Cross-channel teaser */}
        <section className='py-12 px-8' style={{ backgroundColor: '#f3f2ff' }}>
          <div className='max-w-4xl mx-auto'>
            <h2 className='text-xl font-bold text-center mb-6'>מנהלים לידים מכל הערוצים, ביחד</h2>
            <div className='grid md:grid-cols-3 gap-4'>
              {[
                { source: 'פייסבוק', desc: 'לידים מגיעים אוטומטית מ-Lead Ads', href: '/facebook-leads', active: false },
                { source: 'וואטסאפ', desc: 'מוסיפים ידנית או מייבאים', href: '/whatsapp-leads', active: true },
                { source: 'אקסל', desc: 'ייבוא לידים קיימים בקובץ', href: '/features', active: false },
              ].map((ch) => (
                <Link
                  key={ch.source}
                  href={ch.href}
                  className='block p-4 rounded-lg text-center transition-colors'
                  style={{
                    backgroundColor: ch.active ? '#3f20f5' : 'white',
                    color: ch.active ? 'white' : '#171424',
                  }}
                >
                  <div className='font-bold mb-1'>{ch.source}</div>
                  <div className={`text-xs ${ch.active ? 'text-purple-200' : 'text-gray-500'}`}>{ch.desc}</div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <FAQSection title='שאלות נפוצות על לידים מוואטסאפ' items={faqItems} />

        {/* CTA */}
        <section className='py-20 px-8 text-center' style={{ backgroundColor: '#171424' }}>
          <h2 className='text-3xl font-bold text-white mb-4'>מפסיקים לאבד לידים בוואטסאפ</h2>
          <p className='text-gray-400 mb-8'>הרשמה בחינם. תוסיף את הליד הראשון תוך דקה.</p>
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
