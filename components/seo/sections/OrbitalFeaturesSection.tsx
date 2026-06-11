'use client'

import RadialOrbitalTimeline from '@/components/ui/radial-orbital-timeline'
import { FadeIn } from './shared'

const crmTimelineData = [
  { id: 1, title: 'מרכוז לידים', date: 'פייסבוק • וואטסאפ • אקסל', content: 'כל הלידים ממדיה חברתית מגיעים אוטומטית לרשימה אחת. לא עוד חיפוש בצ׳אטים.', category: 'ליבה', iconName: 'inbox' as const, relatedIds: [2, 3], status: 'completed' as const, energy: 100 },
  { id: 2, title: 'עדכון סטטוס', date: 'חדש • בטיפול • סגור • אבוד', content: 'מעדכנים סטטוס בלחיצה אחת. כל שלב במכירה מוגדר וברור לכל הצוות.', category: 'ניהול', iconName: 'circle-check' as const, relatedIds: [1, 4], status: 'completed' as const, energy: 92 },
  { id: 3, title: 'שיוך נציגים', date: 'כל נציג רואה את שלו', content: 'מחלקים לידים בין הצוות. מנהל רואה הכל, נציג רואה רק את שלו.', category: 'צוות', iconName: 'users' as const, relatedIds: [1, 2], status: 'completed' as const, energy: 85 },
  { id: 4, title: 'תזכורות', date: 'מעקב אוטומטי', content: 'מוסיפים תזכורת "להתקשר ביום שלישי" המערכת תזכיר כשמגיע הזמן.', category: 'מעקב', iconName: 'bell' as const, relatedIds: [2, 5], status: 'in-progress' as const, energy: 70 },
  { id: 5, title: 'היסטוריה', date: 'כל שיחה נשמרת', content: 'כל הערה, עדכון סטטוס ושיחה נשמרים על הליד לצמיתות.', category: 'נתונים', iconName: 'clock' as const, relatedIds: [4, 6], status: 'in-progress' as const, energy: 60 },
  { id: 6, title: 'דוחות', date: 'נראות מלאה', content: 'כמה לידים נסגרו החודש? מה שיעור ההמרה? התשובות בלחיצה.', category: 'ניתוח', iconName: 'chart-line' as const, relatedIds: [5], status: 'pending' as const, energy: 40 },
]

export function OrbitalFeaturesSection() {
  return (
    <section className='bg-black py-8'>
      <div className='text-center pt-12 pb-2'>
        <FadeIn>
          <span className='inline-block px-3 py-1 rounded-full text-xs font-semibold mb-4 bg-white/10 text-white/60'>הפיצ׳רים</span>
          <h2 className='text-3xl md:text-4xl font-bold text-white mb-3'>כל מה שצריך, כלום מיותר</h2>
          <p className='text-white/40 text-base max-w-md mx-auto'>לחץ על כל עיגול כדי לראות פרטים</p>
        </FadeIn>
      </div>
      <RadialOrbitalTimeline timelineData={crmTimelineData} />
    </section>
  )
}
