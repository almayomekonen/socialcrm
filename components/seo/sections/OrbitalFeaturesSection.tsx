'use client'

import RadialOrbitalTimeline from '@/components/ui/radial-orbital-timeline'
import Icon from '@/lib/Icon'
import { FadeIn } from './shared'

const crmTimelineData = [
  { id: 1, title: 'מרכוז לידים', date: 'פייסבוק • וואטסאפ • אקסל', content: 'כל הלידים ממדיה חברתית מגיעים אוטומטית לרשימה אחת. לא עוד חיפוש בצ׳אטים.', category: 'ליבה', iconName: 'inbox' as const, relatedIds: [2, 3], status: 'completed' as const, energy: 100 },
  { id: 2, title: 'עדכון סטטוס', date: 'חדש • בטיפול • סגור • אבוד', content: 'מעדכנים סטטוס בלחיצה אחת. כל שלב במכירה מוגדר וברור לכל הצוות.', category: 'ניהול', iconName: 'circle-check' as const, relatedIds: [1, 4], status: 'completed' as const, energy: 92 },
  { id: 3, title: 'שיוך נציגים', date: 'כל נציג רואה את שלו', content: 'מחלקים לידים בין הצוות. מנהל רואה הכל, נציג רואה רק את שלו.', category: 'צוות', iconName: 'users' as const, relatedIds: [1, 2], status: 'completed' as const, energy: 85 },
  { id: 4, title: 'תזכורות', date: 'מעקב אוטומטי', content: 'מוסיפים תזכורת "להתקשר ביום שלישי" המערכת תזכיר כשמגיע הזמן.', category: 'מעקב', iconName: 'bell' as const, relatedIds: [2, 5], status: 'in-progress' as const, energy: 70 },
  { id: 5, title: 'היסטוריה', date: 'כל שיחה נשמרת', content: 'כל הערה, עדכון סטטוס ושיחה נשמרים על הליד לצמיתות.', category: 'נתונים', iconName: 'clock' as const, relatedIds: [4, 6], status: 'in-progress' as const, energy: 60 },
  { id: 6, title: 'דוחות', date: 'נראות מלאה', content: 'כמה לידים נסגרו החודש? מה שיעור ההמרה? התשובות בלחיצה.', category: 'ניתוח', iconName: 'chart-line' as const, relatedIds: [5], status: 'pending' as const, energy: 40 },
]

const statusLabel = { completed: 'פעיל', 'in-progress': 'בפיתוח', pending: 'בקרוב' } as const

function MobileFeatureCards() {
  return (
    <div className='md:hidden px-6 pt-6 pb-10 space-y-4 max-w-md mx-auto' dir='rtl'>
      {crmTimelineData.map((item, i) => (
        <FadeIn key={item.id} delay={Math.min(i * 0.05, 0.2)}>
          <div className='rounded-2xl border border-white/10 p-5 text-white' style={{ backgroundColor: '#141414' }}>
            <div className='flex items-center justify-between mb-4'>
              <div className='flex h-11 w-11 items-center justify-center rounded-xl' style={{ backgroundColor: '#1f1f22' }}>
                <Icon name={item.iconName} className='size-5 bg-white/80' />
              </div>
              <span className='px-2 py-0.5 rounded-full text-[11px] font-medium border border-white/15 text-white/60'>
                {statusLabel[item.status]}
              </span>
            </div>
            <h3 className='text-lg font-bold mb-1'>{item.title}</h3>
            <p className='text-xs text-white/40 mb-2'>{item.date}</p>
            <p className='text-sm leading-relaxed text-white/60'>{item.content}</p>
          </div>
        </FadeIn>
      ))}
    </div>
  )
}

export function OrbitalFeaturesSection() {
  return (
    <section className='bg-black py-8'>
      <div className='text-center pt-12 pb-2'>
        <FadeIn>
          <span className='inline-block px-3 py-1 rounded-full text-xs font-semibold mb-4 bg-white/10 text-white/60'>הפיצ׳רים</span>
          <h2 className='text-3xl md:text-4xl font-bold text-white mb-3'>כל מה שצריך, כלום מיותר</h2>
          <p className='hidden md:block text-white/40 text-base max-w-md mx-auto'>לחץ על כל עיגול כדי לראות פרטים</p>
        </FadeIn>
      </div>
      <MobileFeatureCards />
      <div className='hidden md:block'>
        <RadialOrbitalTimeline timelineData={crmTimelineData} />
      </div>
    </section>
  )
}
