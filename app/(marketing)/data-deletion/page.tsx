import { buildPageMetadata } from '@/lib/seo/metadata'
import { Section, Container } from '@/components/marketing/system'

export const metadata = buildPageMetadata({
  path: '/data-deletion',
  title: 'מחיקת נתונים | SocialCRM Platform',
  description: 'כיצד לבקש מחיקת המידע האישי שלך ממערכת SocialCRM Platform.',
})

export default function DataDeletionPage() {
  return (
    <Section ground='light'>
      <Container width='prose'>
      <div dir='rtl'>
          <h1 className='text-3xl font-bold mb-2'>מחיקת נתונים</h1>
          <p className='text-gray-500 text-sm mb-10'>עודכן לאחרונה: מרץ 2026</p>

          <div className='flex flex-col gap-10'>
            <div>
              <h2 className='text-xl font-semibold mb-3'>זכותך למחיקת מידע</h2>
              <p className='text-gray-600 leading-relaxed'>
                אם ברצונך למחוק את המידע האישי שלך מהמערכת, תוכל לפנות אלינו בכל עת. הבקשה תכלול את כל הנתונים שנשמרו אודותיך,
                כולל שם, כתובת אימייל, מספר טלפון ומידע מלידים המשויכים לחשבונך.
              </p>
            </div>

            <div className='p-6 bg-white rounded-lg border border-gray-200'>
              <h2 className='text-xl font-semibold mb-4'>כיצד לשלוח בקשת מחיקה</h2>
              <ol className='list-decimal list-inside text-gray-600 leading-relaxed flex flex-col gap-3'>
                <li>
                  שלח אימייל לכתובת:{' '}
                  <a href='mailto:alamayo274@gmail.com' className='font-semibold hover:underline' style={{ color: '#3f20f5' }}>
                    alamayo274@gmail.com
                  </a>
                </li>
                <li>השתמש בשורת הנושא: "בקשת מחיקת נתונים"</li>
                <li>
                  צרף פרטים מזהים בגוף ההודעה:
                  <ul className='list-disc list-inside mt-2 flex flex-col gap-1 text-gray-500 text-sm' style={{ paddingRight: '1rem' }}>
                    <li>שם מלא</li>
                    <li>כתובת האימייל המשויכת לחשבונך</li>
                  </ul>
                </li>
              </ol>
            </div>

            <div>
              <h2 className='text-xl font-semibold mb-3'>זמן טיפול</h2>
              <p className='text-gray-600 leading-relaxed'>
                אנו נטפל בכל בקשות המחיקה תוך <span className='font-semibold text-gray-800'>עד 7 ימי עסקים</span> מרגע קבלת
                הבקשה. תישלח אליך הודעת אישור לאחר השלמת המחיקה.
              </p>
            </div>

            <div>
              <h2 className='text-xl font-semibold mb-3'>שאלות נוספות</h2>
              <p className='text-gray-600 leading-relaxed'>
                לכל שאלה בנוגע לתהליך המחיקה, ניתן לפנות אלינו בכתובת:{' '}
                <a href='mailto:alamayo274@gmail.com' className='font-semibold hover:underline' style={{ color: '#3f20f5' }}>
                  alamayo274@gmail.com
                </a>
              </p>
            </div>
          </div>
        </div>
    </Container>
    </Section>
  )
}
