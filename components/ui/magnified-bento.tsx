'use client'

import React from 'react'
import Icon, { IconNames } from '@/lib/Icon'
import { motion, useMotionValue, useMotionTemplate } from 'motion/react'
import { cn } from '@/lib/utils'

const TAG_ROWS = [
  [
    { id: 'fb', icon: 'facebook-f' as IconNames, label: 'ליד מפייסבוק' },
    { id: 'users', icon: 'users' as IconNames, label: 'ניהול נציגים' },
    { id: 'chart', icon: 'chart-line' as IconNames, label: 'ניתוח ביצועים' },
    { id: 'bell', icon: 'bell' as IconNames, label: 'התראות' },
    { id: 'phone', icon: 'phone' as IconNames, label: 'מעקב שיחות' },
    { id: 'ig', icon: 'instagram' as IconNames, label: 'מאינסטגרם' },
    { id: 'check', icon: 'circle-check' as IconNames, label: 'סגירת עסקה' },
    { id: 'cal', icon: 'calendar' as IconNames, label: 'פולואו-אפ' },
  ],
  [
    { id: 'wa', icon: 'whatsapp' as IconNames, label: 'מוואטסאפ' },
    { id: 'upload', icon: 'upload' as IconNames, label: 'ייבוא מאקסל' },
    { id: 'bolt', icon: 'bolt' as IconNames, label: 'אוטומציה' },
    { id: 'search', icon: 'magnifying-glass' as IconNames, label: 'חיפוש מהיר' },
    { id: 'plug', icon: 'plug' as IconNames, label: 'חיבור מהיר' },
    { id: 'user', icon: 'user' as IconNames, label: 'ניהול ליד' },
    { id: 'chart2', icon: 'chart-line' as IconNames, label: 'דוחות' },
    { id: 'fb2', icon: 'facebook-f' as IconNames, label: 'Lead Ads' },
  ],
  [
    { id: 'check2', icon: 'circle-check' as IconNames, label: 'ליד נסגר' },
    { id: 'users2', icon: 'users' as IconNames, label: 'צוות מכירות' },
    { id: 'bell2', icon: 'bell' as IconNames, label: 'תזכורת' },
    { id: 'cal2', icon: 'calendar' as IconNames, label: 'לוח זמנים' },
    { id: 'ig2', icon: 'instagram' as IconNames, label: 'Instagram Ads' },
    { id: 'phone2', icon: 'phone' as IconNames, label: 'שיחת מכירה' },
    { id: 'wa2', icon: 'whatsapp' as IconNames, label: 'WhatsApp' },
    { id: 'search2', icon: 'magnifying-glass' as IconNames, label: 'מעקב' },
  ],
]

const CONFIG = {
  title: 'כל הלידים שלך, במקום אחד',
  description: 'מפייסבוק, אינסטגרם, וואטסאפ ואקסל הכל מגיע ישירות למערכת, אוטומטית.',
  containerHeight: 'h-[220px]',
  lensSize: 92,
}

// Card and tag colors — all hardcoded, no CSS variables
const CARD_BG = '#1c1c1e'
const INNER_BG = '#141414'
const TAG_BG = 'rgba(255,255,255,0.06)'
const TAG_BORDER = 'rgba(255,255,255,0.10)'
const TAG_TEXT = 'rgba(255,255,255,0.55)'
const REVEAL_BG = 'rgba(255,255,255,0.14)'
const REVEAL_TEXT = 'rgba(255,255,255,1)'
const FADE_COLOR = '#141414'

export function MagnifiedBento({ className }: { className?: string }) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const lensX = useMotionValue(0)
  const lensY = useMotionValue(0)

  const clipPath = useMotionTemplate`circle(30px at calc(50% + ${lensX}px - 10px) calc(50% + ${lensY}px - 10px))`
  const inverseMask = useMotionTemplate`radial-gradient(circle 30px at calc(50% + ${lensX}px - 10px) calc(50% + ${lensY}px - 10px), transparent 100%, black 100%)`

  return (
    <div className={cn('flex items-center justify-center p-4 sm:p-6 w-full', className)}>
      <div
        className='group relative w-full max-w-2xl overflow-hidden rounded-4xl sm:rounded-[2.5rem] p-1.5 sm:p-2 shadow-2xl transition-all duration-500 hover:-translate-y-1'
        style={{ backgroundColor: CARD_BG, border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div
          ref={containerRef}
          className={cn('relative w-full overflow-hidden rounded-[1.6rem] sm:rounded-4xl', CONFIG.containerHeight)}
          style={{ backgroundColor: INNER_BG }}
        >
          <div className='relative h-full w-full flex flex-col items-center justify-center' dir='ltr'>

            {/* Base layer — dimmed outside lens */}
            <motion.div
              style={{ WebkitMaskImage: inverseMask, maskImage: inverseMask }}
              className='flex flex-col gap-4 w-full h-full justify-center overflow-hidden'
            >
              {TAG_ROWS.map((row, rowIndex) => (
                <motion.div
                  key={`row-${rowIndex}`}
                  className='flex gap-4 w-max'
                  animate={{ x: rowIndex % 2 === 0 ? ['0%', '-25%'] : ['-25%', '0%'] }}
                  transition={{ duration: 25, ease: 'linear', repeat: Infinity }}
                >
                  {[...row, ...row, ...row, ...row].map((item, idx) => (
                    <div
                      key={`${item.id}-${idx}`}
                      className='flex gap-2 whitespace-nowrap w-fit p-2 px-3 items-center rounded-full text-xs'
                      style={{ backgroundColor: TAG_BG, border: `1px solid ${TAG_BORDER}`, color: TAG_TEXT }}
                    >
                      <Icon name={item.icon} className='size-[14px] bg-white/55' />
                      <span>{item.label}</span>
                    </div>
                  ))}
                </motion.div>
              ))}
            </motion.div>

            {/* Reveal layer — bright tags shown through lens */}
            <motion.div
              className='absolute inset-0 flex flex-col gap-4 justify-center overflow-hidden pointer-events-none select-none z-10'
              style={{ clipPath }}
            >
              {TAG_ROWS.map((row, rowIndex) => (
                <motion.div
                  key={`row-reveal-${rowIndex}`}
                  className='flex gap-4 w-max'
                  animate={{ x: rowIndex % 2 === 0 ? ['0%', '-25%'] : ['-25%', '0%'] }}
                  transition={{ duration: 25, ease: 'linear', repeat: Infinity }}
                >
                  {[...row, ...row, ...row, ...row].map((item, idx) => (
                    <div
                      key={`${item.id}-${idx}-reveal`}
                      className='flex gap-2 whitespace-nowrap w-fit p-2 px-3 items-center rounded-full text-xs font-medium scale-125 ml-6'
                      style={{
                        backgroundColor: REVEAL_BG,
                        border: '1px solid rgba(255,255,255,0.25)',
                        color: REVEAL_TEXT,
                      }}
                    >
                      <Icon name={item.icon} className='size-[14px] bg-white' />
                      <span>{item.label}</span>
                    </div>
                  ))}
                </motion.div>
              ))}
            </motion.div>

            {/* Draggable magnifying glass */}
            <motion.div
              className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 cursor-grab active:cursor-grabbing drop-shadow-xl'
              drag
              dragMomentum={false}
              dragConstraints={containerRef}
              style={{ x: lensX, y: lensY }}
            >
              <div className='relative'>
                <MagnifyingLens size={CONFIG.lensSize} />
                <div className='absolute top-[6px] left-[6px] w-[60px] h-[60px] rounded-full bg-white/10 pointer-events-none' />
              </div>
            </motion.div>
          </div>

          {/* Fade edges */}
          <div
            className='pointer-events-none absolute inset-y-0 left-0 w-1/4 z-20'
            style={{ background: `linear-gradient(to right, ${FADE_COLOR}, transparent)` }}
          />
          <div
            className='pointer-events-none absolute inset-y-0 right-0 w-1/4 z-20'
            style={{ background: `linear-gradient(to left, ${FADE_COLOR}, transparent)` }}
          />
        </div>

        {/* Footer */}
        <div className='p-4 sm:p-6 px-4 pb-6 sm:pb-8' dir='rtl'>
          <h3 className='text-xl font-medium tracking-tight text-white'>{CONFIG.title}</h3>
          <p className='mt-2 text-sm leading-relaxed' style={{ color: 'rgba(255,255,255,0.45)' }}>
            {CONFIG.description}
          </p>
        </div>
      </div>
    </div>
  )
}

function MagnifyingLens({ size = 92 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox='0 0 512 512' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <path d='M365.424 335.392L342.24 312.192L311.68 342.736L334.88 365.936L365.424 335.392Z' fill='#B0BDC6' />
      <path d='M358.08 342.736L334.88 319.552L319.04 335.392L342.24 358.584L358.08 342.736Z' fill='#DFE9EF' />
      <path d='M352.368 321.808L342.752 312.192L312.208 342.752L321.824 352.36L352.368 321.808Z' fill='#B0BDC6' />
      <path
        d='M332 332C260 404 142.4 404 69.6001 332C-2.3999 260 -2.3999 142.4 69.6001 69.6C141.6 -3.20003 259.2 -2.40002 332 69.6C404.8 142.4 404.8 260 332 332ZM315.2 87.2C252 24 150.4 24 88.0001 87.2C24.8001 150.4 24.8001 252 88.0001 314.4C151.2 377.6 252.8 377.6 315.2 314.4C377.6 252 377.6 150.4 315.2 87.2Z'
        fill='#DFE9EF'
      />
      <path
        d='M319.2 319.2C254.4 384 148.8 384 83.2001 319.2C18.4001 254.4 18.4001 148.8 83.2001 83.2C148 18.4 253.6 18.4 319.2 83.2C384 148.8 384 254.4 319.2 319.2ZM310.4 92C250.4 32 152 32 92.0001 92C32.0001 152 32.0001 250.4 92.0001 310.4C152 370.4 250.4 370.4 310.4 310.4C370.4 250.4 370.4 152 310.4 92Z'
        fill='#7A858C'
      />
      <path d='M484.104 428.784L373.8 318.472L318.36 373.912L428.672 484.216L484.104 428.784Z' fill='#333333' />
      <path d='M471.664 441.224L361.344 330.928L330.8 361.48L441.12 471.76L471.664 441.224Z' fill='#575B5E' />
      <path
        d='M495.2 423.2C504 432 432.8 504 423.2 495.2L417.6 489.6C408.8 480.8 480 408.8 489.6 417.6L495.2 423.2Z'
        fill='#B0BDC6'
      />
      <path
        d='M483.2 435.2C492 444 444.8 492 435.2 483.2L429.6 477.6C420.8 468.8 468 420.8 477.6 429.6L483.2 435.2Z'
        fill='#DFE9EF'
      />
    </svg>
  )
}
