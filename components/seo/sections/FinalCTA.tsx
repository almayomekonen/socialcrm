'use client'

import Link from 'next/link'
import { ParticleTextEffect } from '@/components/ui/interactive-text-particle'

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
