import { buildPageMetadata } from '@/lib/seo/metadata'
import { Section, Container } from '@/components/marketing/system'

export const metadata = buildPageMetadata({
  path: '/terms',
  title: 'תנאי שימוש | SocialCRM Platform',
  description: 'תנאי השימוש של מערכת SocialCRM Platform.',
})

export default function TermsPage() {
  return (
    <Section ground='light'>
      <Container width='prose'>
      <div dir='rtl'>
          <h1 className='text-3xl font-bold mb-2'>תנאי שימוש</h1>
          <p className='text-gray-500 text-sm mb-10'>עודכן לאחרונה: מרץ 2026</p>

          <div className='flex flex-col gap-10'>
            <div>
              <h2 className='text-xl font-semibold mb-3'>כללי</h2>
              <p className='text-gray-600 leading-relaxed'>
                השימוש במערכת SocialCRM Platform כפוף לתנאים המפורטים להלן. המשך השימוש במערכת מהווה הסכמה לתנאים אלו.
              </p>
            </div>

            <div>
              <h2 className='text-xl font-semibold mb-3'>מטרת השימוש</h2>
              <p className='text-gray-600 leading-relaxed mb-3'>המערכת מיועדת לשימוש חוקי בלבד לצורך:</p>
              <ul className='list-disc list-inside text-gray-600 leading-relaxed flex flex-col gap-2'>
                <li>ניהול לידים ולקוחות פוטנציאליים</li>
                <li>מעקב אחר סטטוס לידים ועדכונם</li>
                <li>ייבוא וייצוא נתוני לידים</li>
              </ul>
            </div>

            <div>
              <h2 className='text-xl font-semibold mb-3'>איסורים</h2>
              <p className='text-gray-600 leading-relaxed mb-3'>חל איסור מוחלט על:</p>
              <ul className='list-disc list-inside text-gray-600 leading-relaxed flex flex-col gap-2'>
                <li>שימוש במערכת למטרות לא חוקיות</li>
                <li>העברת פרטי גישה לצד שלישי</li>
                <li>ניסיון לפרוץ או לשבש את פעולת המערכת</li>
              </ul>
            </div>

            <div>
              <h2 className='text-xl font-semibold mb-3'>אחריות המשתמש</h2>
              <p className='text-gray-600 leading-relaxed'>
                המשתמש אחראי לשמירה על פרטי ההתחברות שלו ולכל פעולה שתבוצע תחת חשבונו. יש לעדכן אותנו מיידית במקרה של חשד
                לשימוש לא מורשה בחשבון.
              </p>
            </div>

            <div>
              <h2 className='text-xl font-semibold mb-3'>שינויים בתנאים</h2>
              <p className='text-gray-600 leading-relaxed'>
                אנו שומרים לעצמנו את הזכות לעדכן תנאים אלו בכל עת. שינויים מהותיים יפורסמו בעמוד זה עם עדכון תאריך השינוי
                האחרון.
              </p>
            </div>

            <div>
              <h2 className='text-xl font-semibold mb-3'>יצירת קשר</h2>
              <p className='text-gray-600 leading-relaxed whitespace-pre-line'>
                {'מפעיל השירות:\nאלמיהו מקונן (עוסק פטור)\n\nשם מסחרי:\nSocialCRM\n\nאימייל:\n'}
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
