import { MarketingNavbar } from '@/components/marketing/MarketingNavbar'
import { HeroContent } from './HeroContent'
import { HeroScene } from './HeroScene'


export function HeroSection() {
  return (
    <div className='relative overflow-hidden bg-white'>
      <div className='absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(63,32,245,0.06),transparent_60%)]' />

      <div className='relative z-10'>
        <MarketingNavbar />

        <div
          dir='rtl'
          className='mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 lg:grid-cols-2 lg:py-20'
        >
          <HeroContent />
          <HeroScene />
        </div>
      </div>
    </div>
  )
}

export default HeroSection
