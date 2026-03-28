'use client'

import { motion, LayoutGroup } from 'motion/react'
import Link from 'next/link'
import Icon from '@/lib/Icon'
import RadialOrbitalTimeline from '@/components/ui/radial-orbital-timeline'
import { HowItWorks } from '@/components/ui/how-it-works'
import { TextRotate } from '@/components/ui/text-rotate'
import { FeatureCarousel } from '@/components/ui/feature-carousel'
import { ParticleTextEffect } from '@/components/ui/interactive-text-particle'
import { StaggerTestimonials } from '@/components/ui/stagger-testimonials'

function FadeIn({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

function SectionHeader({ badge, title, subtitle }: { badge?: string; title: string; subtitle?: string }) {
  return (
    <div className='text-center mb-16'>
      {badge && (
        <span className='inline-block px-3 py-1 rounded-full text-xs font-semibold mb-4 text-white' style={{ backgroundColor: '#3f20f5' }}>
          {badge}
        </span>
      )}
      <h2 className='text-3xl md:text-4xl font-bold mb-4' style={{ color: '#171424' }}>{title}</h2>
      {subtitle && <p className='text-gray-500 text-lg max-w-xl mx-auto'>{subtitle}</p>}
    </div>
  )
}

// ─── Features 7 (replaces TrustStrip + ProblemSection) ───────────
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
          <span className='px-3 py-1 rounded border border-white/20 text-white/60'>ייבוא</span>
          <span className='px-3 py-1 rounded text-white font-semibold' style={{ backgroundColor: '#3f20f5' }}>הוסף ליד</span>
        </div>
      </div>
      {/* header */}
      <div className='grid grid-cols-5 gap-3 px-4 py-2 text-white/30 font-medium border-b border-white/10 bg-[#16122e]'>
        <span>שם הליד</span><span>נציג</span><span>סטטוס</span><span>תאריך</span><span>מקור</span>
      </div>
      {/* rows */}
      {mockLeads.map((lead, i) => (
        <div key={i} className={`grid grid-cols-5 gap-3 px-4 py-2.5 items-center border-b border-white/5 hover:bg-white/5 transition-colors ${i === 0 ? 'bg-white/5' : ''}`}>
          <div className='flex items-center gap-2 font-medium text-white/90'>
            <span className={`w-2 h-2 rounded-full shrink-0 ${lead.color}`} />
            {lead.name}
          </div>
          <span className='text-white/50'>{lead.assignee}</span>
          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium w-fit ${lead.badge}`}>{lead.status}</span>
          <span className='text-white/40'>{lead.date}</span>
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
            <h2 className='text-4xl font-bold text-white lg:text-5xl leading-tight'>
              בנוי כדי שלא תפספס<br />אף ליד
            </h2>
            <p className='mt-5 text-lg text-white/50 leading-relaxed'>
              כל הלידים ממדיה חברתית מגיעים למקום אחד. עדכן סטטוס, שייך נציגים, וסגור יותר עסקאות בלי לחפש בצ׳אטים.
            </p>
          </div>
        </FadeIn>

        {/* 3D skewed product preview */}
        <div className='relative -mx-4 rounded-3xl p-3 md:-mx-8'>
          <div style={{ perspective: '800px' }}>
            <div style={{ transform: 'skewY(-2deg) skewX(-2deg) rotateX(6deg)' }}>
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

// ─── Features Section ─────────────────────────────────────────────
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

// ─── Orbital Features Section ─────────────────────────────────────
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

// ─── How It Works ─────────────────────────────────────────────────
export function HowItWorksSection() {
  return <HowItWorks />
}

// ─── Stats Section ────────────────────────────────────────────────
export function StatsSection() {
  return (
    <section className='py-24 px-8 bg-white overflow-hidden'>
      <div className='max-w-5xl mx-auto flex flex-col items-center justify-center text-center'>
        <LayoutGroup>
          <motion.div
            className='flex flex-wrap items-center justify-center gap-x-4 text-4xl sm:text-5xl md:text-6xl font-black text-gray-900 leading-tight'
            layout
            dir='rtl'
          >
            <motion.span layout transition={{ type: 'spring', damping: 30, stiffness: 400 }}>
              ניהול לידים שהוא
            </motion.span>
            <TextRotate
              texts={['מהיר', 'פשוט', 'חכם', 'יעיל', 'מדויק', 'נכון']}
              mainClassName='text-white px-4 py-1 rounded-xl overflow-hidden justify-center bg-[#3f20f5]'
              staggerFrom='last'
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '-120%' }}
              staggerDuration={0.03}
              splitLevelClassName='overflow-hidden pb-1'
              transition={{ type: 'spring', damping: 30, stiffness: 400 }}
              rotationInterval={2000}
            />
          </motion.div>
        </LayoutGroup>
      </div>
    </section>
  )
}

// ─── Lead Sources ─────────────────────────────────────────────────
export function LeadSourcesSection() {
  return (
    <section className='py-24' style={{ backgroundColor: '#171424' }}>
      <FadeIn>
        <div className='text-center mb-12' dir='rtl'>
          <span className='inline-block px-3 py-1 rounded-full text-xs font-semibold mb-4 bg-white/10 text-white/60'>מקורות לידים</span>
          <h2 className='text-3xl md:text-4xl font-bold text-white mb-3'>מאיפה מגיעים הלידים שלך?</h2>
          <p className='text-white/40 text-base max-w-md mx-auto'>SocialCRM מחובר לכל המקורות שבהם הלידים שלך מגיעים.</p>
        </div>
      </FadeIn>
      <FadeIn delay={0.1}>
        <FeatureCarousel />
      </FadeIn>
    </section>
  )
}

// ─── Testimonials ─────────────────────────────────────────────────
export function TestimonialsSection() {
  return (
    <section style={{ backgroundColor: '#0a0a0a' }}>
      <FadeIn>
        <div className='text-center pt-20 pb-4 px-6' dir='rtl'>
          <span className='inline-block px-3 py-1 rounded-full text-xs font-semibold mb-4 bg-white/10 text-white/60'>המלצות</span>
          <h2 className='text-3xl md:text-4xl font-bold text-white mb-3'>מה אומרים המשתמשים שלנו</h2>
          <p className='text-white/40 text-base max-w-md mx-auto'>עסקים קטנים שעברו מאקסל וצ׳אטים למערכת אחת מסודרת</p>
        </div>
      </FadeIn>
      <StaggerTestimonials />
    </section>
  )
}

// ─── Final CTA ────────────────────────────────────────────────────
export function FinalCTA() {
  return (
    <section className='relative overflow-hidden' style={{ backgroundColor: '#0a0812' }}>
      {/* Particle canvas — full width, fixed height */}
      <div className='relative w-full' style={{ height: '300px' }}>
        <ParticleTextEffect
          text='SocialCRM'
          className='absolute top-0 left-0'
          colors={['3f20f5', '5b3ef7', '7b62f8', '9c87fa', 'bdb0fc', 'd4ccfd', 'bdb0fc', '9c87fa', '3f20f5']}
          animationForce={90}
          particleDensity={3}
        />
      </div>

      {/* CTA buttons */}
      <div className='relative z-10 pb-10 flex flex-col items-center gap-3' dir='rtl'>
        <p className='text-white/40 text-base mb-4'>תוך 5 דקות תוכל לייבא את הלידים שלך ולהתחיל לעבוד</p>
        <div className='flex flex-wrap gap-4 justify-center'>
          <Link
            href='/auth/register'
            className='px-8 py-4 rounded-xl text-base font-bold transition-all duration-200 hover:scale-105'
            style={{ backgroundColor: '#3f20f5', color: 'white' }}
          >
            התחל בחינם עכשיו
          </Link>
          <Link
            href='/features'
            className='px-8 py-4 rounded-xl text-base font-semibold border border-white/20 text-white/80 hover:border-white/50 hover:text-white transition-all duration-200'
          >
            כל הפיצ׳רים
          </Link>
        </div>
        <p className='text-white/50 text-sm mt-2'>ללא כרטיס אשראי. ללא התחייבות.</p>
      </div>
    </section>
  )
}
