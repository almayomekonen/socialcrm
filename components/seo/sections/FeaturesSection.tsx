'use client'

import { FadeIn, SectionHeader } from './shared'

const features = [
  {
    title: 'מרכוז כל הלידים',
    desc: 'כל ליד, מכל מקור, מגיע לרשימה אחת. לא עוד בלגן בין וואטסאפ, מייל ואקסל.',
    icon: (
      <svg className='w-5 h-5' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
        <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={1.5} d='M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' />
      </svg>
    ),
  },
  {
    title: 'עדכון סטטוס בלחיצה',
    desc: 'מעדכנים בלחיצה אחת: חדש, בטיפול, הצעת מחיר נשלחה, סגור, אבוד.',
    icon: (
      <svg className='w-5 h-5' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
        <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={1.5} d='M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' />
      </svg>
    ),
  },
  {
    title: 'שיוך לנציגים',
    desc: 'מחלקים לידים בין הצוות. כל נציג רואה את שלו, מנהל רואה הכל.',
    icon: (
      <svg className='w-5 h-5' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
        <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={1.5} d='M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' />
      </svg>
    ),
  },
  {
    title: 'מעקב ותזכורות',
    desc: 'מוסיפים תזכורת "להתקשר ביום שלישי". המערכת תזכיר כשמגיע הזמן.',
    icon: (
      <svg className='w-5 h-5' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
        <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={1.5} d='M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' />
      </svg>
    ),
  },
  {
    title: 'היסטוריה מלאה',
    desc: 'כל הערה, כל עדכון סטטוס, כל שיחה, נשמרים על הליד לצמיתות.',
    icon: (
      <svg className='w-5 h-5' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
        <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={1.5} d='M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' />
      </svg>
    ),
  },
  {
    title: 'דוחות מכירות',
    desc: 'כמה לידים נסגרו החודש? מה שיעור ההמרה? התשובות נמצאות בלחיצה.',
    icon: (
      <svg className='w-5 h-5' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
        <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={1.5} d='M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' />
      </svg>
    ),
  },
]

export function FeaturesSection() {
  return (
    <section className='py-24 px-8 bg-white'>
      <div className='max-w-5xl mx-auto'>
        <FadeIn>
          <SectionHeader badge='הפתרון' title='כל מה שצריך, כלום מיותר' subtitle='מערכת ניהול לידים שבנויה ספציפית לעסקים קטנים שמקבלים לידים ממדיה חברתית.' />
        </FadeIn>

        <div className='grid md:grid-cols-2 lg:grid-cols-3 gap-6'>
          {features.map((f, i) => (
            <FadeIn key={f.title} delay={i * 0.07}>
              <div className='group p-6 rounded-2xl border border-gray-100 hover:border-transparent hover:shadow-xl transition-all duration-300 hover:-translate-y-1 bg-white'>
                <div className='w-10 h-10 rounded-xl flex items-center justify-center mb-4 text-white' style={{ backgroundColor: '#3f20f5' }}>
                  {f.icon}
                </div>
                <h3 className='font-bold text-gray-900 mb-2'>{f.title}</h3>
                <p className='text-gray-500 text-sm leading-relaxed'>{f.desc}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  )
}
