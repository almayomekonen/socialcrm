import Link from 'next/link'
import { Metadata } from 'next'
import { MarketingLayout } from '@/components/seo/MarketingLayout'
import { FAQSection, buildFAQSchema } from '@/components/seo/FAQ'
import { Hero } from '@/components/seo/Hero'

export const metadata: Metadata = {
  title: 'ניהול לידים לעסקים קטנים, המדריך המלא | SocialCRM',
  description:
    'כל מה שצריך לדעת על ניהול לידים לעסקים קטנים. מה זה CRM, איך מנהלים לידים מפייסבוק ווואטסאפ, ולמה עסקים קטנים עוברים ממקסל למערכת ייעודית.',
  alternates: { canonical: 'https://socialcrm.vercel.app/crm' },
  openGraph: {
    title: 'ניהול לידים לעסקים קטנים, המדריך המלא',
    description: 'המדריך המלא לניהול לידים: מה זה CRM, איך מתחילים, ואיך לא לפספס אף עסקה.',
    url: 'https://socialcrm.vercel.app/crm',
  },
}

const faqItems = [
  {
    question: 'מה זה ניהול לידים?',
    answer:
      'ניהול לידים הוא תהליך של איסוף, ארגון ומעקב אחר פניות של לקוחות פוטנציאליים. המטרה היא לוודא שכל ליד מטופל בזמן ולא נשכח, עד לסגירת עסקה או להחלטה שהוא לא רלוונטי.',
  },
  {
    question: 'מה זה CRM?',
    answer:
      'CRM (Customer Relationship Management) הוא מערכת לניהול קשרי לקוחות. עבור עסקים קטנים, CRM היא בדרך כלל תוכנה שמאגדת את כל הלידים ואנשי הקשר, מאפשרת לעדכן סטטוס, לשייך נציגים ולעקוב אחר ההתקדמות.',
  },
  {
    question: 'מדוע עסקים קטנים צריכים מערכת ניהול לידים?',
    answer:
      'בלי מערכת, לידים מגיעים מכל מקום, פייסבוק, וואטסאפ, מייל, אינסטגרם, ומפוזרים. קשה לדעת מי טופל ומי לא, מי צריך מעקב, ומה המצב של כל ליד. מערכת CRM פותרת את הבעיה הזו באופן מלא.',
  },
  {
    question: 'מה ההבדל בין ניהול לידים באקסל לבין מערכת CRM?',
    answer:
      'אקסל מספיק רק לנפחים קטנים מאוד. מערכת CRM מתחברת ישירות למקורות הלידים (פייסבוק, וואטסאפ), מאפשרת שיתוף בין נציגים, שולחת תזכורות, ומנהלת היסטוריה של כל ליד, דברים שאקסל לא יכול לעשות.',
  },
  {
    question: 'מאיפה מגיעים הלידים בדרך כלל לעסקים קטנים?',
    answer:
      'רוב הלידים לעסקים קטנים מגיעים מפרסום בפייסבוק ואינסטגרם (Lead Ads), מהמלצות בוואטסאפ, מטפסי יצירת קשר באתר, ומפה לאוזן. SocialCRM מתמקדת בלידים ממקורות אלו.',
  },
  {
    question: 'כמה זמן לוקח ליד להפוך ל"קר" ולא שמיש?',
    answer:
      'מחקרים מראים שסיכוי יצירת קשר מוצלח יורד ב-80% תוך 5 דקות מהפניה, וב-90% תוך שעה. לכן מהירות המענה היא הגורם הקריטי ביותר בניהול לידים.',
  },
  {
    question: 'האם SocialCRM מתאים לעסק של אדם אחד?',
    answer:
      'בהחלט. SocialCRM מתוכנן קודם כל לבעל עסק יחיד שמנהל לידים בעצמו. ניתן להוסיף נציגים בהמשך, אבל גם לבד המערכת שווה הרבה.',
  },
  {
    question: 'האם אפשר לנסות את SocialCRM בחינם?',
    answer:
      'כן. ניתן להירשם ולהתחיל לעבוד עם המערכת ללא עלות. אין צורך בכרטיס אשראי להתחלה.',
  },
]

const pageSchema = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  '@id': 'https://socialcrm.vercel.app/crm',
  headline: 'ניהול לידים לעסקים קטנים, המדריך המלא',
  description:
    'המדריך המקיף לניהול לידים לעסקים קטנים: מה זה CRM, מאיפה מגיעים הלידים, וכיצד SocialCRM עוזרת לסגור יותר עסקאות.',
  inLanguage: 'he',
  url: 'https://socialcrm.vercel.app/crm',
  publisher: { '@id': 'https://socialcrm.vercel.app/#organization' },
  about: { '@id': 'https://socialcrm.vercel.app/#software' },
  breadcrumb: {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'דף הבית', item: 'https://socialcrm.vercel.app/' },
      { '@type': 'ListItem', position: 2, name: 'ניהול לידים', item: 'https://socialcrm.vercel.app/crm' },
    ],
  },
}

const howToSchema = {
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name: 'איך מתחילים לנהל לידים לעסק קטן',
  description: 'מדריך שלב-אחר-שלב להתחלת ניהול לידים יעיל לעסקים קטנים',
  inLanguage: 'he',
  step: [
    { '@type': 'HowToStep', position: 1, name: 'אוספים את כל הלידים הקיימים', text: 'מייבאים לידים קיימים מאקסל, וואטסאפ ומקורות אחרים למקום אחד.' },
    { '@type': 'HowToStep', position: 2, name: 'מחברים את מקורות הלידים', text: 'מחברים דף פייסבוק ואינסטגרם כך שלידים חדשים יגיעו אוטומטית.' },
    { '@type': 'HowToStep', position: 3, name: 'מגדירים סטטוסים', text: 'קובעים את שלבי המכירה: חדש, בטיפול, הצעת מחיר, סגור, אבוד.' },
    { '@type': 'HowToStep', position: 4, name: 'משייכים לנציגים', text: 'מחלקים לידים בין הנציגים. כל אחד רואה רק את שלו.' },
    { '@type': 'HowToStep', position: 5, name: 'עובדים לפי רשימת עדיפויות', text: 'פותחים את המערכת בכל יום ורואים מיידית מה צריך טיפול דחוף.' },
  ],
}

const faqSchema = buildFAQSchema(faqItems)

const LEAD_SOURCES = [
  {
    title: 'לידים מפייסבוק',
    desc: 'לידים שממלאים טופס Lead Ad מגיעים אוטומטית למערכת תוך שניות מהגשה.',
    href: '/facebook-leads',
    cta: 'איך מחברים →',
  },
  {
    title: 'לידים מוואטסאפ',
    desc: 'לידים שפנו בוואטסאפ מייובאים בקלות, ידנית או דרך ייבוא מספרים.',
    href: '/whatsapp-leads',
    cta: 'איך מייבאים →',
  },
  {
    title: 'ייבוא מאקסל',
    desc: 'יש רשימת לידים ישנה? מעלים קובץ אקסל ובשניות הכל מאורגן במערכת.',
    href: '/features',
    cta: 'כל הפיצ\'רים →',
  },
]

const CRM_FEATURES = [
  { title: 'מרכוז כל הלידים', desc: 'כל ליד, מכל מקור, מגיע לרשימה אחת. לא עוד בלגן בין וואטסאפ, מייל ואקסל.' },
  { title: 'עדכון סטטוס', desc: 'מעדכנים בלחיצה אחת: חדש, בטיפול, הצעת מחיר נשלחה, סגור, אבוד.' },
  { title: 'שיוך לנציגים', desc: 'מחלקים לידים בין הצוות. כל נציג רואה את שלו, מנהל רואה הכל.' },
  { title: 'מעקב ותזכורות', desc: 'מוסיפים תזכורת "להתקשר ביום שלישי". המערכת תזכיר.' },
  { title: 'היסטוריה מלאה', desc: 'כל הערה, כל עדכון סטטוס, כל שיחה, נשמרים על הליד לצמיתות.' },
  { title: 'דוחות מכירות', desc: 'כמה לידים נסגרו החודש? מה שיעור ההמרה? התשובות נמצאות בלחיצה.' },
]

export default function CRMPage() {
  return (
    <>
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(pageSchema) }} />
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(howToSchema) }} />
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />

      <MarketingLayout>
        <Hero
          breadcrumbs={[
            { label: 'דף הבית', href: '/' },
            { label: 'ניהול לידים', href: '/crm' },
          ]}
          badge='מדריך מלא'
          title='ניהול לידים לעסקים קטנים'
          subtitle='כל הלידים מפייסבוק, אינסטגרם ווואטסאפ, במקום אחד. מעקב, עדכון סטטוס, וסגירת עסקאות. בלי לפספס אף ליד.'
          cta={{ label: 'התחל לנהל לידים בחינם', href: '/auth/register' }}
          secondaryCta={{ label: "צפה בפיצ'רים", href: '/features' }}
        />

        {/* Entity definition, critical for AIO */}
        <section className='py-16 px-8 max-w-4xl mx-auto'>
          <div className='grid md:grid-cols-2 gap-12'>
            <div>
              <h2 className='text-2xl font-bold mb-4'>מה זה ניהול לידים?</h2>
              <p className='text-gray-600 leading-relaxed mb-4'>
                <strong>ניהול לידים</strong> הוא תהליך של איסוף, ארגון ומעקב אחר פניות של לקוחות פוטנציאליים, מהרגע שהם מביעים עניין, עד שהם הופכים ללקוחות משלמים או שלא.
              </p>
              <p className='text-gray-600 leading-relaxed mb-4'>
                <strong>ליד</strong> (Lead) הוא כל אדם שהשאיר פרטים, שלח הודעה, מילא טופס, או התייחס למודעה שלך. הוא טרם לקוח, אך הוא ההזדמנות.
              </p>
              <p className='text-gray-600 leading-relaxed'>
                ניהול לידים יעיל מבטיח שכל הזדמנות מטופלת בזמן, ושאף פניה לא הולכת לאיבוד.
              </p>
            </div>
            <div>
              <h2 className='text-2xl font-bold mb-4'>מה זה CRM?</h2>
              <p className='text-gray-600 leading-relaxed mb-4'>
                <strong>CRM</strong> (Customer Relationship Management, ניהול קשרי לקוחות) היא מערכת תוכנה שמאגדת את כל הלידים, אנשי הקשר, ומידע על תהליך המכירה במקום אחד.
              </p>
              <p className='text-gray-600 leading-relaxed mb-4'>
                מערכת CRM לעסק קטן אמורה להיות פשוטה: להביא לידים, לאפשר עדכון מהיר, ולתת תמונה ברורה על מצב הפייפליין.
              </p>
              <p className='text-gray-600 leading-relaxed'>
                SocialCRM היא מערכת CRM שבנויה ספציפית לעסקים קטנים שמקבלים לידים ממדיה חברתית.
              </p>
            </div>
          </div>
        </section>

        {/* Why leads get lost */}
        <section className='py-16 px-8' style={{ backgroundColor: '#f9f9f9' }}>
          <div className='max-w-4xl mx-auto'>
            <h2 className='text-2xl font-bold text-center mb-2'>למה לידים הולכים לאיבוד?</h2>
            <p className='text-gray-500 text-center mb-10 max-w-2xl mx-auto'>
              הבעיה לא שחסרים לידים. הבעיה שהם מגיעים מכל מקום, ואין מערכת שמנהלת אותם.
            </p>
            <div className='grid md:grid-cols-2 gap-6'>
              {[
                {
                  problem: 'פיזור בין ערוצים',
                  desc: 'ליד מפייסבוק, עוד אחד מוואטסאפ, עוד אחד מהאתר. אין מקום אחד שרואים הכל.',
                },
                {
                  problem: 'מענה איטי',
                  desc: 'סיכוי המכירה יורד ב-80% תוך 5 דקות. כשהליד ממתין, הוא מתקרר.',
                },
                {
                  problem: 'שכחת מעקב',
                  desc: 'אמרת שתחזור אליו ביום שלישי. ביום שלישי, שכחת. הליד עבר למתחרה.',
                },
                {
                  problem: 'חוסר נראות',
                  desc: 'כמה לידים חדשים יש השבוע? כמה נסגרו? בלי מערכת, אין תשובות.',
                },
              ].map((item) => (
                <div key={item.problem} className='bg-white rounded-lg p-6 border-r-4' style={{ borderColor: '#3f20f5' }}>
                  <h3 className='font-bold text-lg mb-2'>{item.problem}</h3>
                  <p className='text-gray-500 text-sm'>{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Key CRM features */}
        <section className='py-16 px-8 max-w-4xl mx-auto'>
          <h2 className='text-2xl font-bold text-center mb-2'>תכונות הכרחיות במערכת ניהול לידים</h2>
          <p className='text-gray-500 text-center mb-10'>מה שעסק קטן באמת צריך, לא יותר, לא פחות</p>
          <div className='grid md:grid-cols-2 lg:grid-cols-3 gap-5'>
            {CRM_FEATURES.map((f) => (
              <article key={f.title} className='p-5 rounded-lg border border-gray-100'>
                <h3 className='font-bold mb-2'>{f.title}</h3>
                <p className='text-gray-500 text-sm leading-relaxed'>{f.desc}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Lead sources */}
        <section className='py-16 px-8' style={{ backgroundColor: '#f3f2ff' }}>
          <div className='max-w-4xl mx-auto'>
            <h2 className='text-2xl font-bold text-center mb-2'>מאיפה מגיעים הלידים שלך?</h2>
            <p className='text-gray-500 text-center mb-10'>SocialCRM מחובר לכל מקור</p>
            <div className='grid md:grid-cols-3 gap-6'>
              {LEAD_SOURCES.map((s) => (
                <article key={s.title} className='bg-white rounded-lg p-6 shadow-sm'>
                  <h3 className='font-bold text-lg mb-2'>{s.title}</h3>
                  <p className='text-gray-500 text-sm mb-4 leading-relaxed'>{s.desc}</p>
                  <Link href={s.href} className='text-sm font-semibold hover:underline' style={{ color: '#3f20f5' }}>
                    {s.cta}
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* How to start, HowTo content (AIO pattern) */}
        <section className='py-16 px-8 max-w-3xl mx-auto'>
          <h2 className='text-2xl font-bold text-center mb-10'>איך מתחילים לנהל לידים?</h2>
          <ol className='grid md:grid-cols-2 gap-6' aria-label='שלבי ניהול לידים'>
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
                  <p className='text-gray-500 text-sm mt-1 leading-relaxed'>{item.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Stats */}
        <section className='py-16 px-8' style={{ backgroundColor: '#f9f9f9' }}>
          <div className='max-w-4xl mx-auto text-center'>
            <h2 className='text-2xl font-bold mb-10'>למה זה משנה?</h2>
            <div className='grid md:grid-cols-3 gap-6'>
              {[
                { stat: '80%', label: 'ירידה בסיכוי מכירה תוך 5 דקות ממילוי טופס' },
                { stat: '44%', label: 'מהלידים לא מקבלים אף מעקב לאחר הפניה הראשונה' },
                { stat: '3x', label: 'יותר עסקאות נסגרות כשהמענה הוא תוך שעה' },
              ].map((item) => (
                <div key={item.stat} className='p-6 bg-white rounded-lg shadow-sm'>
                  <div className='text-4xl font-bold mb-2' style={{ color: '#3f20f5' }}>{item.stat}</div>
                  <div className='text-gray-500 text-sm'>{item.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CRM vs Excel teaser */}
        <section className='py-16 px-8 max-w-4xl mx-auto'>
          <div className='bg-gray-50 rounded-xl p-8 flex flex-col md:flex-row gap-6 items-center'>
            <div className='flex-1'>
              <h2 className='text-xl font-bold mb-2'>CRM לעומת אקסל, מה עדיף?</h2>
              <p className='text-gray-500 text-sm leading-relaxed'>
                אקסל עובד עד נקודה מסוימת. מעבר לכמה עשרות לידים, הוא מתחיל לגרום לטעויות. ראה את ההשוואה המלאה, מה אקסל נותן, ומה רק CRM יכול לעשות.
              </p>
            </div>
            <Link
              href='/crm-vs-excel'
              className='px-6 py-3 rounded-lg text-white font-semibold shrink-0'
              style={{ backgroundColor: '#3f20f5' }}
            >
              ראה השוואה מלאה
            </Link>
          </div>
        </section>

        <FAQSection title='שאלות נפוצות על ניהול לידים' items={faqItems} />

        {/* CTA */}
        <section className='py-20 px-8 text-center' style={{ backgroundColor: '#171424' }}>
          <h2 className='text-3xl font-bold text-white mb-4'>מוכן להפסיק לפספס לידים?</h2>
          <p className='text-gray-400 mb-8 max-w-lg mx-auto'>
            הירשם ל-SocialCRM בחינם. תוך 5 דקות תוכל לייבא את הלידים שלך ולהתחיל לעבוד.
          </p>
          <div className='flex flex-wrap gap-3 justify-center'>
            <Link
              href='/auth/register'
              className='inline-block px-8 py-3 rounded-lg text-white font-semibold text-lg'
              style={{ backgroundColor: '#3f20f5' }}
            >
              התחל בחינם עכשיו
            </Link>
            <Link
              href='/features'
              className='inline-block px-8 py-3 rounded-lg font-semibold text-lg border border-gray-600 text-gray-300 hover:border-gray-400'
            >
              כל הפיצ'רים
            </Link>
          </div>
        </section>
      </MarketingLayout>
    </>
  )
}
