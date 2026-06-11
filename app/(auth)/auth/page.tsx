import Link from 'next/link'
import Login from '@/components/auth/Login'
import LoginMagicLink from '@/components/auth/LoginMagicLink'
import { getUser } from '@/db/auth'
import { Metadata } from 'next'
import AccordionItem from '@/lib/AccordionItem'
import HeroScroll from '@/components/auth/HeroScroll'

export const metadata: Metadata = {
  title: 'התחברות | SocialCRM — מערכת ניהול לידים',
  description:
    'התחבר ל-SocialCRM — מערכת ניהול הלידים לעסקים קטנים. כל הלידים מפייסבוק, אינסטגרם ווואטסאפ במקום אחד. בלי לפספס אף ליד.',
  alternates: {
    canonical: 'https://getsocialcrm.com/auth',
  },
  openGraph: {
    title: 'SocialCRM כל הלידים שלך במקום אחד',
    description: 'נהל את כל הלידים מפייסבוק, אינסטגרם ווואטסאפ ממקום אחד. התחל עכשיו בחינם.',
    url: 'https://getsocialcrm.com/auth',
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

export default async function AuthPage({ searchParams }) {
  const { error } = await searchParams
  const user = await getUser()

  return (
    <>
      <div className='min-h-screen bg-white'>
        {/* Login section */}
        <div className='grid lg:grid-cols-2 w-screen place-items-center'>
          <div className='grid place-items-center gap-6 lg:gap-8 py-14 lg:py-0 px-6'>
            <h1 className='text-3xl md:text-5xl font-bold text-center'>SocialCRM הכל במקום אחד</h1>
            <p className='text-gray-500 font-normal text-base mt-2 text-center'>
              כל הלידים שלך במקום אחד. בלי לפספס אף אחד.
            </p>
            <div className='grid w-full max-w-sm'>
              <p className='mb-1'>התחברות עם גוגל</p>
              <Login user={user} />
              <p className='text-gray-500 text-xs text-center mt-2'>עובד עם וואטסאפ, אינסטגרם ופייסבוק</p>
              <LoginMagicLink error={error} />

              <p className='text-gray-500 text-xs text-center mt-3'>
                אין לך חשבון?{' '}
                <Link
                  href='/auth/register'
                  className='text-primary-text font-semibold hover:text-primary transition-colors'
                >
                  הצטרף עכשיו
                </Link>
              </p>
            </div>
          </div>
          <img src='/media/auth.jpg' alt='ניהול לידים לעסקים קטנים' className='w-full h-screen object-cover hidden lg:block' />
        </div>

        {/* SEO content — visible to crawlers and AI engines, useful for users */}
        <section aria-label='מידע על המערכת' className='bg-white border-t border-gray-100'>
          <HeroScroll />

          <div className='max-w-4xl mx-auto px-8 pb-16'>
            <div className='max-w-2xl mx-auto'>
              <h2 className='text-2xl text-center font-bold mb-6'>שאלות נפוצות</h2>
              <div className='bg-white rounded-lg overflow-hidden border border-gray-100 shadow-sm'>
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
