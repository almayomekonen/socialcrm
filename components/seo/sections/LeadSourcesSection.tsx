// Server Component. It became one when `FadeIn` stopped being a `motion.div`:
// nothing here touches state, effects, events or browser APIs, and the
// interactive children below carry their own `'use client'`.
import { FeatureCarousel } from '@/components/ui/feature-carousel'
import { FadeIn } from './shared'

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
