import { Metadata } from 'next'
import { MarketingLayout } from '@/components/seo/MarketingLayout'

export const metadata: Metadata = {
  title: 'מדיניות פרטיות | SocialCRM Platform',
  description: 'מדיניות הפרטיות של SocialCRM Platform — כיצד אנו אוספים, משתמשים ומגנים על המידע שלך.',
}

export default function PrivacyPage() {
  return (
    <MarketingLayout>
      <section className='py-16 px-8' dir='rtl'>
        <div className='max-w-3xl mx-auto'>
          <h1 className='text-3xl font-bold mb-2'>מדיניות פרטיות</h1>
          <p className='text-gray-500 text-sm mb-10'>עודכן לאחרונה: מרץ 2026</p>

          <div className='flex flex-col gap-10'>
            <div>
              <h2 className='text-xl font-semibold mb-3'>מבוא</h2>
              <p className='text-gray-600 leading-relaxed'>
                אנו ב־SocialCRM Platform מכבדים את פרטיות המשתמשים שלנו ומתחייבים להגן על המידע האישי שלהם. מדיניות זו מסבירה
                כיצד אנו אוספים, משתמשים ושומרים על המידע בעת השימוש בשירותינו.
              </p>
            </div>

            <div>
              <h2 className='text-xl font-semibold mb-3'>איזה מידע אנו אוספים</h2>
              <p className='text-gray-600 leading-relaxed mb-3'>אנו אוספים את המידע הנדרש לצורך מתן שירותי ניהול הלידים:</p>
              <ul className='list-disc list-inside text-gray-600 leading-relaxed flex flex-col gap-2'>
                <li>שם מלא</li>
                <li>כתובת אימייל</li>
                <li>מספר טלפון</li>
                <li>מידע מלידים המגיעים מפייסבוק</li>
              </ul>
            </div>

            <div>
              <h2 className='text-xl font-semibold mb-3'>כיצד אנו משתמשים במידע</h2>
              <p className='text-gray-600 leading-relaxed mb-3'>המידע שנאסף משמש אך ורק למטרות הבאות:</p>
              <ul className='list-disc list-inside text-gray-600 leading-relaxed flex flex-col gap-2'>
                <li>ניהול לידים במערכת</li>
                <li>יצירת קשר עם לקוחות פוטנציאליים</li>
                <li>שיפור השירותים שלנו</li>
              </ul>
            </div>

            <div>
              <h2 className='text-xl font-semibold mb-3'>שיתוף מידע</h2>
              <p className='text-gray-600 leading-relaxed'>
                אנו לא מוכרים, משכירים או סוחרים במידע האישי שלך. המידע משמש רק לצרכים פנימיים או נמסר לשירותים אמינים
                הנדרשים להפעלת המערכת, תחת הסכמי סודיות קפדניים.
              </p>
            </div>

            <div>
              <h2 className='text-xl font-semibold mb-3'>שימוש ב־Facebook</h2>
              <p className='text-gray-600 leading-relaxed'>
                האפליקציה משתמשת ב־Facebook API כדי לקבל לידים שהוגשו דרך Facebook Lead Ads, אך ורק לאחר אישור מפורש של
                המשתמש. אנו עומדים בתנאי הפלטפורמה של Meta ומשתמשים רק בנתונים שהמשתמש אישר.
              </p>
            </div>

            <div>
              <h2 className='text-xl font-semibold mb-3'>אבטחת מידע</h2>
              <p className='text-gray-600 leading-relaxed'>
                אנו נוקטים באמצעי אבטחה טכניים וארגוניים סבירים להגנה על המידע מפני גישה בלתי מורשית, שינוי, חשיפה או השמדה.
                טוקנים ופרטי גישה רגישים מוצפנים ומאוחסנים בצורה מאובטחת.
              </p>
            </div>

            <div>
              <h2 className='text-xl font-semibold mb-3'>זכויות המשתמש</h2>
              <p className='text-gray-600 leading-relaxed'>
                למשתמש יש זכות לבקש גישה, תיקון או מחיקה של המידע האישי שלו בכל עת. לביצוע הבקשה יש לפנות אלינו בכתובת
                האימייל המפורטת להלן. נענה לכל הבקשות תוך 7 ימי עסקים.
              </p>
            </div>

            <div>
              <h2 className='text-xl font-semibold mb-3'>יצירת קשר</h2>
              <p className='text-gray-600 leading-relaxed'>
                לכל שאלה או בקשה בנוגע למדיניות פרטיות זו, ניתן לפנות אלינו בכתובת:{' '}
                <a href='mailto:alamayo274@gmail.com' className='font-semibold hover:underline' style={{ color: '#3f20f5' }}>
                  alamayo274@gmail.com
                </a>
              </p>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  )
}
