'use client'

import Icon from '@/lib/Icon'
import { FadeIn } from './shared'

const highlights = [
  { icon: 'bolt' as const, title: 'מהיר להתחלה', desc: 'תוך 5 דקות מהרשמה כל הלידים שלך מאורגנים ומוכנים לעבודה.' },
  { icon: 'layer-group' as const, title: 'מרכוז מלא', desc: 'פייסבוק, וואטסאפ ואקסל הכל מגיע לרשימה אחת ברורה.' },
  { icon: 'bell' as const, title: 'לא תשכח אף ליד', desc: 'תזכורות אוטומטיות מבטיחות שכל ליד מקבל מענה בזמן.' },
  { icon: 'chart-line' as const, title: 'נראות מלאה', desc: 'ראה בדיוק כמה לידים נסגרו, מה שיעור ההמרה, ומה דורש טיפול.' },
]

const mockLeads = [
  { name: 'דני לוי', assignee: 'יוסי כהן', status: 'סגור', date: '26/03/2026', source: 'פייסבוק', color: 'bg-green-500', badge: 'bg-green-900/60 text-green-300' },
  { name: 'מיכל אברהם', assignee: 'רחל גולן', status: 'בטיפול', date: '25/03/2026', source: 'אינסטגרם', color: 'bg-blue-500', badge: 'bg-blue-900/60 text-blue-300' },
  { name: 'אבי שרון', assignee: 'יוסי כהן', status: 'ממתין', date: '24/03/2026', source: 'וואטסאפ', color: 'bg-yellow-500', badge: 'bg-yellow-900/60 text-yellow-300' },
  { name: 'שרה פרץ', assignee: 'רחל גולן', status: 'חדש', date: '26/03/2026', source: 'פייסבוק', color: 'bg-blue-400', badge: 'bg-blue-900/60 text-blue-300' },
  { name: 'נועם ביטון', assignee: 'יוסי כהן', status: 'אבוד', date: '20/03/2026', source: 'וואטסאפ', color: 'bg-gray-500', badge: 'bg-gray-800 text-gray-400' },
  { name: 'לירון כץ', assignee: 'רחל גולן', status: 'בטיפול', date: '23/03/2026', source: 'אינסטגרם', color: 'bg-blue-500', badge: 'bg-blue-900/60 text-blue-300' },
]

function LeadsMockUI() {
  return (
    <div className='w-full rounded-xl overflow-hidden border border-white/10 bg-[#1a1530] text-xs' dir='rtl'>
      {/* toolbar */}
      <div className='flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#14112a]'>
        <div className='flex gap-2'>
          <span className='px-2 py-1 rounded bg-white/10 text-white/60'>נציג</span>
          <span className='px-2 py-1 rounded bg-white/10 text-white/60'>סטטוס</span>
          <span className='px-2 py-1 rounded bg-white/10 text-white/60'>מקור</span>
        </div>
        <div className='flex gap-2'>
          <span className='hidden md:inline px-3 py-1 rounded border border-white/20 text-white/60'>ייבוא</span>
          <span className='px-3 py-1 rounded text-white font-semibold' style={{ backgroundColor: '#3f20f5' }}>הוסף ליד</span>
        </div>
      </div>
      {/* header */}
      <div className='grid grid-cols-3 md:grid-cols-5 gap-3 px-4 py-2 text-white/30 font-medium border-b border-white/10 bg-[#16122e]'>
        <span>שם הליד</span><span className='hidden md:block'>נציג</span><span>סטטוס</span><span className='hidden md:block'>תאריך</span><span>מקור</span>
      </div>
      {/* rows */}
      {mockLeads.map((lead, i) => (
        <div key={i} className={`grid grid-cols-3 md:grid-cols-5 gap-3 px-4 py-2.5 items-center border-b border-white/5 hover:bg-white/5 transition-colors ${i === 0 ? 'bg-white/5' : ''}`}>
          <div className='flex items-center gap-2 font-medium text-white/90'>
            <span className={`w-2 h-2 rounded-full shrink-0 ${lead.color}`} />
            {lead.name}
          </div>
          <span className='hidden md:block text-white/50'>{lead.assignee}</span>
          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium w-fit ${lead.badge}`}>{lead.status}</span>
          <span className='hidden md:block text-white/40'>{lead.date}</span>
          <span className='text-white/50'>{lead.source}</span>
        </div>
      ))}
    </div>
  )
}

export function Features7Section() {
  return (
    <section className='overflow-hidden py-16 md:py-28' style={{ backgroundColor: '#171424' }}>
      <div className='mx-auto max-w-5xl space-y-10 px-6 md:space-y-14'>
        <FadeIn className='relative z-10 max-w-2xl'>
          <div dir='rtl'>
            <h2 className='text-3xl md:text-4xl font-bold text-white lg:text-5xl leading-tight'>
              בנוי כדי שלא תפספס<br />אף ליד
            </h2>
            <p className='mt-5 text-lg text-white/50 leading-relaxed'>
              כל הלידים ממדיה חברתית מגיעים למקום אחד. עדכן סטטוס, שייך נציגים, וסגור יותר עסקאות בלי לחפש בצ׳אטים.
            </p>
          </div>
        </FadeIn>

        {/* 3D skewed product preview — flat below md for readability */}
        <div className='relative -mx-4 rounded-3xl p-3 md:-mx-8'>
          <div style={{ perspective: '800px' }}>
            <div className='md:transform-[skewY(-2deg)_skewX(-2deg)_rotateX(6deg)]'>
              <div className='relative'>
                <div className='absolute inset-0 z-10' style={{ background: 'radial-gradient(ellipse at 75% 25%, transparent 40%, #171424 80%)' }} />
                <LeadsMockUI />
              </div>
            </div>
          </div>
        </div>

        {/* 4 highlights */}
        <FadeIn>
          <div className='grid grid-cols-2 gap-x-6 gap-y-8 sm:gap-8 lg:grid-cols-4' dir='rtl'>
            {highlights.map((h) => (
              <div key={h.title} className='space-y-3'>
                <div className='flex items-center gap-2 text-white/80'>
                  <Icon name={h.icon} className='size-4 bg-white/70' />
                  <h3 className='text-sm font-semibold'>{h.title}</h3>
                </div>
                <p className='text-sm text-white/40 leading-relaxed'>{h.desc}</p>
              </div>
            ))}
          </div>
        </FadeIn>
      </div>
    </section>
  )
}
