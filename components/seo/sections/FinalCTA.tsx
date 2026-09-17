'use client'

import Link from 'next/link'
import { ParticleTextEffect } from '@/components/ui/interactive-text-particle'
import { Btn } from '@/lib/btns/Btn'

export function FinalCTA() {
  return (
    <section className='relative overflow-hidden' style={{ backgroundColor: '#0a0812' }}>
      {/* Particle canvas — md+ only; text renders as illegible noise at phone widths */}
      <div className='relative w-full hidden md:block' style={{ height: '300px' }}>
        <ParticleTextEffect
          text='SocialCRM'
          className='absolute top-0 left-0'
          colors={['3f20f5', '5b3ef7', '7b62f8', '9c87fa', 'bdb0fc', 'd4ccfd', 'bdb0fc', '9c87fa', '3f20f5']}
          animationForce={90}
          particleDensity={3}
        />
      </div>

      {/* Mobile brand headline — same gradient palette as the particles */}
      <div className='md:hidden h-44 flex items-center justify-center'>
        <span
          className='text-5xl font-black bg-clip-text text-transparent'
          style={{ backgroundImage: 'linear-gradient(90deg, #3f20f5, #7b62f8, #bdb0fc)' }}
        >
          SocialCRM
        </span>
      </div>

      {/* CTA buttons */}
      <div className='relative z-10 pb-10 flex flex-col items-center gap-3' dir='rtl'>
        <p className='text-white/40 text-base mb-4 px-6 text-center'>תוך 5 דקות תוכל לייבא את הלידים שלך ולהתחיל לעבוד</p>
        <div className='flex flex-wrap gap-4 justify-center w-full px-6 sm:w-auto sm:px-0'>
          <Btn
            href='/auth'
            lbl='התחל בחינם עכשיו'
            className='w-full sm:w-auto h-auto text-center px-8 py-4 rounded-xl text-base font-bold transition-all duration-200 hover:scale-105'
            style={{ backgroundColor: '#3f20f5', color: 'white' }}
          />
          <Link
            href='/'
            className='w-full sm:w-auto text-center px-8 py-4 rounded-xl text-base font-semibold border border-white/20 text-white/80 hover:border-white/50 hover:text-white transition-all duration-200'
          >
            כל הפיצ׳רים
          </Link>
        </div>
        <p className='text-white/50 text-sm mt-2'>שבעה ימים ללא חיוב. נדרש כרטיס אשראי. אפשר לבטל לפני החיוב הראשון.</p>
      </div>
    </section>
  )
}
