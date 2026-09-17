import { buildPageMetadata } from '@/lib/seo/metadata'
import { Section, Container } from '@/components/marketing/system'
import { PRICING } from '@/lib/pricing'
import { TRIAL_LENGTH_DAYS } from '@/lib/trial'
import {
  BUSINESS_ADDRESS,
  BUSINESS_EMAIL,
  BUSINESS_OPERATOR,
  BUSINESS_PHONE_DISPLAY,
  BUSINESS_PHONE_HREF,
  BUSINESS_TRADE_NAME,
} from '@/lib/businessContact'

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
          <p className='text-gray-500 text-sm mb-10'>עודכן לאחרונה: ספטמבר 2026</p>

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
              <h2 className='text-xl font-semibold mb-3'>המנוי, ההתנסות והחיוב</h2>
              <ul className='list-disc list-inside text-gray-600 leading-relaxed flex flex-col gap-2'>
                <li>ההתנסות היא {TRIAL_LENGTH_DAYS} ימים במערכת המלאה.</li>
                <li>
                  כדי להתחיל את ההתנסות יש לשמור כרטיס אשראי. הכרטיס נשמר אצל ספק הסליקה Grow (משולם פתרונות תשלום),
                  ופרטי הכרטיס אינם נשמרים במערכת שלנו.
                </li>
                <li>
                  לצורך אימות הכרטיס תיתכן הקפאה זמנית של ₪1 אצל חברת האשראי. זו אינה גבייה. לפי ספק הסליקה Grow,
                  ההקפאה משתחררת בתוך עד 10 ימים.
                </li>
                <li>במהלך {TRIAL_LENGTH_DAYS} ימי ההתנסות לא מתבצע חיוב.</li>
                <li>
                  בתום {TRIAL_LENGTH_DAYS} הימים יחויב הכרטיס השמור ב־₪{PRICING.monthly} לחודש, ומדי חודש לאחר מכן,
                  עד לביטול.
                </li>
              </ul>
            </div>

            <div>
              <h2 className='text-xl font-semibold mb-3'>ביטול המנוי</h2>
              <ul className='list-disc list-inside text-gray-600 leading-relaxed flex flex-col gap-2'>
                <li>ניתן לבטל את המנוי בכל עת מתוך המערכת, בעמוד המנוי: הגדרות ← אמצעי תשלום.</li>
                <li>ביטול לפני החיוב הראשון: לא יבוצע חיוב כלל.</li>
                <li>ביטול לאחר שבוצע חיוב: הגישה נמשכת עד תום התקופה ששולמה, ולא יבוצע חיוב נוסף.</li>
                <li>הביטול חל על כל המשתמשים בסביבת העבודה.</li>
              </ul>
            </div>

            <div>
              <h2 className='text-xl font-semibold mb-3'>אספקת השירות</h2>
              <p className='text-gray-600 leading-relaxed'>
                השירות הוא שירות מקוון (SaaS) ואינו כולל משלוח פיזי. הגישה למערכת נפתחת מיד עם אימות הכרטיס מול ספק
                הסליקה, ובכל מקרה לא יאוחר מ־24 שעות ממועד הרכישה. השימוש נעשה בדפדפן, ואין מוצר הנשלח לכתובת.
              </p>
            </div>

            <div>
              <h2 className='text-xl font-semibold mb-3'>הגבלת גיל</h2>
              <p className='text-gray-600 leading-relaxed'>
                הרכישה באתר מותרת לבני 18 ומעלה בלבד.
              </p>
            </div>

            <div>
              <h2 className='text-xl font-semibold mb-3'>פרטיות</h2>
              <p className='text-gray-600 leading-relaxed'>
                המידע שנמסר בעת ההרשמה והשימוש משמש לצורך הפעלת השירות בלבד, ואינו נמכר או מועבר לצדדים שלישיים למטרות
                שיווק. הפירוט המלא נמצא ב
                <a href='/privacy' className='font-semibold hover:underline' style={{ color: '#3f20f5' }}>
                  מדיניות הפרטיות
                </a>
                .
              </p>
            </div>

            <div>
              <h2 className='text-xl font-semibold mb-3'>אחריות</h2>
              <p className='text-gray-600 leading-relaxed'>
                השירות ניתן כפי שהוא. מפעיל השירות ו/או מי מטעמו לא יהיו אחראים לנזק ישיר ו/או עקיף שייגרם כתוצאה
                משימוש בשירות.
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
              <h2 className='text-xl font-semibold mb-3'>פרטי בית העסק ויצירת קשר</h2>
              <dl className='text-gray-600 leading-relaxed flex flex-col gap-3'>
                <div>
                  <dt className='font-semibold text-gray-700'>מפעיל השירות</dt>
                  <dd>{BUSINESS_OPERATOR}</dd>
                </div>
                <div>
                  <dt className='font-semibold text-gray-700'>שם מסחרי</dt>
                  <dd>{BUSINESS_TRADE_NAME}</dd>
                </div>
                <div>
                  <dt className='font-semibold text-gray-700'>כתובת</dt>
                  {/* Grow's checklist requires the business address on the site
                      or in the תקנון. This is the copy that satisfies it. */}
                  <dd>
                    <address className='not-italic'>{BUSINESS_ADDRESS}</address>
                  </dd>
                </div>
                <div>
                  <dt className='font-semibold text-gray-700'>טלפון</dt>
                  {/* dir="ltr": an RTL paragraph reorders the segments of a bare
                      phone number, so the reader would see a different number. */}
                  <dd>
                    <a href={BUSINESS_PHONE_HREF} className='font-semibold hover:underline' style={{ color: '#3f20f5' }}>
                      <span dir='ltr' className='inline-block'>
                        {BUSINESS_PHONE_DISPLAY}
                      </span>
                    </a>
                  </dd>
                </div>
                <div>
                  <dt className='font-semibold text-gray-700'>אימייל</dt>
                  <dd>
                    <a href={`mailto:${BUSINESS_EMAIL}`} className='font-semibold hover:underline' style={{ color: '#3f20f5' }}>
                      {BUSINESS_EMAIL}
                    </a>
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
    </Container>
    </Section>
  )
}
