import Login from '@/components/auth/Login'
import LoginMagicLink from '@/components/auth/LoginMagicLink'
import { getUser } from '@/db/auth'
import { Metadata } from 'next'
import AccordionItem from '@/lib/AccordionItem'

export const metadata: Metadata = {
  title: 'התחברות | SocialCRM — מערכת ניהול לידים',
  description:
    'התחבר ל-SocialCRM — מערכת ניהול הלידים לעסקים קטנים. כל הלידים מפייסבוק, אינסטגרם ווואטסאפ במקום אחד. בלי לפספס אף ליד.',
  alternates: {
    canonical: 'https://socialcrm.vercel.app/auth',
  },
  openGraph: {
    title: 'SocialCRM — כל הלידים שלך במקום אחד',
    description: 'נהל את כל הלידים מפייסבוק, אינסטגרם ווואטסאפ ממקום אחד. התחל עכשיו בחינם.',
    url: 'https://socialcrm.vercel.app/auth',
  },
}

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'מה זה SocialCRM?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'SocialCRM היא מערכת ניהול לידים לעסקים קטנים. היא מאגדת את כל הלידים שמגיעים מפייסבוק, אינסטגרם ווואטסאפ למקום אחד, כך שלא מפספסים אף ליד.',
      },
    },
    {
      '@type': 'Question',
      name: 'האם SocialCRM עובד עם פייסבוק ואינסטגרם?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'כן. SocialCRM מתחבר ישירות לדף הפייסבוק שלך ומביא אוטומטית כל ליד שממלא טופס מודעה. לא צריך להעתיק ידנית.',
      },
    },
    {
      '@type': 'Question',
      name: 'האם אפשר לייבא לידים מאקסל?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'כן. ניתן להעלות קובץ אקסל עם לידים קיימים ולייבא אותם למערכת בכמה שניות.',
      },
    },
    {
      '@type': 'Question',
      name: 'כמה זמן לוקח להתחיל?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'ההרשמה לוקחת פחות מדקה. לאחר ההתחברות ניתן מיד להוסיף לידים ולהתחיל לעבוד.',
      },
    },
    {
      '@type': 'Question',
      name: 'למי SocialCRM מתאים?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'SocialCRM מתאים לבעלי עסקים קטנים ונציגי מכירות שמקבלים לידים ממדיה חברתית ורוצים לנהל אותם בצורה מסודרת ויעילה.',
      },
    },
  ],
}

const websiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': 'https://socialcrm.vercel.app/#website',
  url: 'https://socialcrm.vercel.app',
  name: 'SocialCRM',
  description: 'מערכת ניהול לידים לעסקים קטנים',
  inLanguage: 'he',
  publisher: { '@id': 'https://socialcrm.vercel.app/#organization' },
}

export default async function AuthPage({ searchParams }) {
  const { error } = await searchParams
  const user = await getUser()

  return (
    <>
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }} />

      <div className='min-h-screen bg-white'>
        {/* Login section */}
        <div className='grid lg:grid-cols-2 w-screen place-items-center'>
          <div className='grid place-items-center gap-8 py-24 lg:py-0'>
            <h1 className='text-5xl font-bold'>ברוכים הבאים ל-SocialCRM</h1>
            <p className='text-gray-500 font-normal text-base mt-2'>
              כל הלידים שלך במקום אחד. בלי לפספס אף אחד.
            </p>
            <div className='grid'>
              <p className='mb-1'>התחברות עם גוגל</p>
              <Login user={user} />
              <p className='text-gray-500 text-xs text-center mt-2'>עובד עם וואטסאפ, אינסטגרם ופייסבוק</p>
              <LoginMagicLink error={error} />

              <div className='flex justify-center mt-2'>
                {/* <Link href='/auth/register' className='underline font-semibold '>
                    הרשמה{' '}
                  </Link> */}
              </div>
            </div>
          </div>
          <img src='/media/auth.jpg' alt='ניהול לידים לעסקים קטנים' className='w-full h-screen object-cover hidden lg:block' />
        </div>

        {/* SEO content — visible to crawlers and AI engines, useful for users */}
        <section aria-label='מידע על המערכת' className='bg-gray-50 border-t border-gray-100 py-16 px-8'>
          <div className='max-w-4xl mx-auto'>
            <h2 className='text-2xl font-bold text-center mb-2'>למה עסקים בוחרים ב-SocialCRM?</h2>
            <p className='text-gray-500 text-center mb-10'>
              מערכת ניהול לידים שמתחברת לפייסבוק, מייבאת מאקסל, ועוזרת לסגור יותר עסקאות
            </p>

            <div className='grid md:grid-cols-3 gap-6 mb-14'>
              <div className='bg-white rounded-lg p-6 shadow-sm'>
                <h3 className='font-bold text-lg mb-2'>חיבור לפייסבוק</h3>
                <p className='text-gray-500 text-sm'>
                  לידים מטפסי פייסבוק מגיעים ישירות למערכת אוטומטית, בלי העתקה ידנית.
                </p>
              </div>
              <div className='bg-white rounded-lg p-6 shadow-sm'>
                <h3 className='font-bold text-lg mb-2'>ייבוא מאקסל</h3>
                <p className='text-gray-500 text-sm'>
                  יש לך רשימת לידים באקסל? מעלים קובץ אחד ובשניות הכל מאורגן במערכת.
                </p>
              </div>
              <div className='bg-white rounded-lg p-6 shadow-sm'>
                <h3 className='font-bold text-lg mb-2'>מעקב ומכירה</h3>
                <p className='text-gray-500 text-sm'>
                  עדכן סטטוס, הוסף הערות, שייך נציג כל ליד מנוהל עד לסגירה.
                </p>
              </div>
            </div>

            <div className='max-w-2xl mx-auto'>
              <h2 className='text-xl font-bold mb-6'>שאלות נפוצות</h2>
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
          </div>
        </section>
      </div>
    </>
  )
}
