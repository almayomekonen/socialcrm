// Server Component. It became one when `FadeIn` stopped being a `motion.div`:
// nothing here touches state, effects, events or browser APIs, and the
// interactive children below carry their own `'use client'`.
import { StaggerTestimonials } from '@/components/ui/stagger-testimonials'
import { FadeIn } from './shared'

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
