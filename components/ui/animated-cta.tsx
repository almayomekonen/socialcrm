'use client'

import React, { useEffect } from 'react'
import Link from 'next/link'

interface AnimatedCtaProps {
  title: string
  highlight: string
  buttonText: string
  buttonHref: string
}

export function AnimatedCta({ title, highlight, buttonText, buttonHref }: AnimatedCtaProps) {
  useEffect(() => {
    document.querySelectorAll<SVGPathElement>('.line-animation-path').forEach((path) => {
      const len = path.getTotalLength()
      path.style.setProperty('--path-length', `${len}`)
    })
  }, [])

  return (
    <div className='relative text-white font-sans overflow-x-hidden flex items-center justify-center min-h-[85vh] py-20 px-5' style={{ backgroundColor: '#0a0a0a' }}>

      {/* Decorative lines overlay */}
      <div className='absolute inset-0 z-10 pointer-events-none'>

        {/* Corner bracket — left */}
        <div className='absolute top-1/2 left-0 right-0 -translate-y-1/2 h-[80px]'>
          <div className='absolute w-[200px] h-[80px] left-[-120px]'>
            <svg className='absolute inset-0 w-full h-full' viewBox='0 0 177 59' fill='none'>
              <path className='line-background' d='M176 1L53.5359 1C52.4313 1 51.5359 1.89543 51.5359 3L51.5359 56C51.5359 57.1046 50.6405 58 49.5359 58L0 58' />
            </svg>
            <svg className='absolute inset-0 w-full h-full' viewBox='0 0 177 59' fill='none'>
              <path className='line-animation-path' d='M176 1L53.5359 1C52.4313 1 51.5359 1.89543 51.5359 3L51.5359 56C51.5359 57.1046 50.6405 58 49.5359 58L0 58' />
            </svg>
          </div>

          {/* Corner bracket — right */}
          <div className='absolute w-[200px] h-[80px] right-[-120px]'>
            <svg className='absolute inset-0 w-full h-full' viewBox='0 0 176 59' fill='none'>
              <path className='line-background' d='M0 1L122.464 1C123.569 1 124.464 1.89543 124.464 3L124.464 56C124.464 57.1046 125.36 58 126.464 58L176 58' />
            </svg>
            <svg className='absolute inset-0 w-full h-full' viewBox='0 0 176 59' fill='none'>
              <path className='line-animation-path reverse' d='M0 1L122.464 1C123.569 1 124.464 1.89543 124.464 3L124.464 56C124.464 57.1046 125.36 58 126.464 58L176 58' />
            </svg>
          </div>
        </div>

        {/* Stripe line 1 — top 15% */}
        <div className='absolute w-full h-[77px] top-[15%]'>
          <div className='absolute w-full h-full z-20'>
            <svg width='100%' viewBox='0 0 1336 77' fill='none'>
              <defs>
                <linearGradient id='lg1'><stop offset='0%' stopColor='white' stopOpacity='0'/><stop offset='20%' stopColor='white' stopOpacity='1'/><stop offset='40%' stopColor='white' stopOpacity='0'/></linearGradient>
                <mask id='gm1'><rect className='mask-rect' x='0' y='0' width='20%' height='100%' fill='url(#lg1)'/></mask>
              </defs>
              <path d='M0 1H179.567L254.595 76H1081.4L1156.43 1H1336' stroke='currentColor' mask='url(#gm1)'/>
            </svg>
          </div>
          <div className='absolute w-full h-full z-10'>
            <svg width='100%' viewBox='0 0 1336 77' fill='none'>
              <path d='M0 1H179.567L254.595 76H1081.4L1156.43 1H1336' stroke='rgba(255,255,255,0.08)'/>
            </svg>
          </div>
        </div>

        {/* Stripe line 2 — 35% (purple accent) */}
        <div className='absolute w-full h-[98px] top-[35%]'>
          <div className='absolute w-full h-full z-20'>
            <svg width='100%' viewBox='0 0 1336 98' fill='none'>
              <defs>
                <linearGradient id='lg2'><stop offset='0%' stopColor='white' stopOpacity='0'/><stop offset='20%' stopColor='white' stopOpacity='1'/><stop offset='40%' stopColor='white' stopOpacity='0'/></linearGradient>
                <mask id='gm2'><rect className='mask-rect' x='0' y='0' width='20%' height='100%' fill='url(#lg2)'/></mask>
              </defs>
              <path d='M0 1H107.5L182.528 97H1154L1229.03 1H1336' stroke='#3f20f5' mask='url(#gm2)'/>
            </svg>
          </div>
          <div className='absolute w-full h-full z-10'>
            <svg width='100%' viewBox='0 0 1336 98' fill='none'>
              <path d='M0 1H107.5L182.528 97H1154L1229.03 1H1336' stroke='rgba(255,255,255,0.08)'/>
            </svg>
          </div>
        </div>

        {/* Stripe line 3 — 55% (purple accent, inverted) */}
        <div className='absolute w-full h-[98px] top-[55%]'>
          <div className='absolute w-full h-full z-20'>
            <svg width='100%' viewBox='0 0 1336 98' fill='none'>
              <defs>
                <linearGradient id='lg3'><stop offset='0%' stopColor='white' stopOpacity='0'/><stop offset='20%' stopColor='white' stopOpacity='1'/><stop offset='40%' stopColor='white' stopOpacity='0'/></linearGradient>
                <mask id='gm3'><rect className='mask-rect' x='0' y='0' width='20%' height='100%' fill='url(#lg3)'/></mask>
              </defs>
              <path d='M0 97H107.5L182.528 1H1154L1229.03 97H1336' stroke='#3f20f5' mask='url(#gm3)'/>
            </svg>
          </div>
          <div className='absolute w-full h-full z-10'>
            <svg width='100%' viewBox='0 0 1336 98' fill='none'>
              <path d='M0 97H107.5L182.528 1H1154L1229.03 97H1336' stroke='rgba(255,255,255,0.08)'/>
            </svg>
          </div>
        </div>

        {/* Stripe line 4 — 75% */}
        <div className='absolute w-full h-[77px] top-[75%]'>
          <div className='absolute w-full h-full z-20'>
            <svg width='100%' viewBox='0 0 1336 77' fill='none'>
              <defs>
                <linearGradient id='lg4'><stop offset='0%' stopColor='white' stopOpacity='0'/><stop offset='20%' stopColor='white' stopOpacity='1'/><stop offset='40%' stopColor='white' stopOpacity='0'/></linearGradient>
                <mask id='gm4'><rect className='mask-rect' x='0' y='0' width='20%' height='100%' fill='url(#lg4)'/></mask>
              </defs>
              <path d='M1336 76H1156.43L1081.4 1H254.595L179.567 76H0' stroke='#3f20f5' mask='url(#gm4)'/>
            </svg>
          </div>
          <div className='absolute w-full h-full z-10'>
            <svg width='100%' viewBox='0 0 1336 77' fill='none'>
              <path d='M1336 76H1156.43L1081.4 1H254.595L179.567 76H0' stroke='rgba(255,255,255,0.08)'/>
            </svg>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className='relative z-20 max-w-screen-xl w-full text-center' dir='rtl'>
        <h2 className='text-[clamp(2.5rem,7vw,5.5rem)] font-bold leading-tight mb-12'>
          {title}<br />
          <span className='bg-gradient-to-l from-[#3f20f5] via-[#7c5cfc] to-[#a78bfa] bg-clip-text text-transparent'>
            {highlight}
          </span>
        </h2>

        <Link
          href={buttonHref}
          className='inline-block py-4 px-8 bg-white text-black rounded-xl font-bold text-lg transition-all hover:-translate-y-0.5 hover:shadow-xl'
        >
          {buttonText}
        </Link>
      </div>
    </div>
  )
}
