'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { cn } from '@/lib/utils'
import Icon, { IconNames } from '@/lib/Icon'

const FEATURES = [
  {
    id: 'facebook',
    label: 'פייסבוק',
    iconName: 'thumbs-up' as IconNames,
    image: '/media/social/facebook.png',
    description: 'לידים שממלאים טופס Lead Ad מגיעים אוטומטית למערכת תוך שניות מהגשה.',
  },
  {
    id: 'instagram',
    label: 'אינסטגרם',
    iconName: 'at' as IconNames,
    image: '/media/social/instagram.png',
    description: 'לידים מטפסי Lead Ad באינסטגרם מגיעים ישירות למערכת בלי להעתיק ידנית.',
  },
  {
    id: 'whatsapp',
    label: 'וואטסאפ',
    iconName: 'comment-dots' as IconNames,
    image: '/media/social/whatsapp.png',
    description: 'כל שיחת וואטסאפ מחוברת לליד שלה, ואתם עונים ורואים מתי היא נקראה.',
  },
  {
    id: 'excel',
    label: 'אקסל',
    iconName: 'file-excel' as IconNames,
    image: '/media/social/excel.png',
    description: 'יש רשימת לידים ישנה? מעלים קובץ אקסל ובשניות הכל מאורגן במערכת.',
  },
]

const AUTO_PLAY_INTERVAL = 3000
const ITEM_HEIGHT = 88

const wrap = (min: number, max: number, v: number) => {
  const rangeSize = max - min
  return ((((v - min) % rangeSize) + rangeSize) % rangeSize) + min
}

export function FeatureCarousel() {
  const [step, setStep] = useState(0)
  const [isPaused, setIsPaused] = useState(false)

  const currentIndex = ((step % FEATURES.length) + FEATURES.length) % FEATURES.length

  const nextStep = useCallback(() => {
    setStep((prev) => prev + 1)
  }, [])

  const handleChipClick = (index: number) => {
    const diff = (index - currentIndex + FEATURES.length) % FEATURES.length
    if (diff > 0) setStep((s) => s + diff)
  }

  useEffect(() => {
    if (isPaused) return
    const interval = setInterval(nextStep, AUTO_PLAY_INTERVAL)
    return () => clearInterval(interval)
  }, [nextStep, isPaused])

  const getCardStatus = (index: number) => {
    const diff = index - currentIndex
    const len = FEATURES.length
    let normalizedDiff = diff
    if (diff > len / 2) normalizedDiff -= len
    if (diff < -len / 2) normalizedDiff += len
    if (normalizedDiff === 0) return 'active'
    if (normalizedDiff === -1) return 'prev'
    if (normalizedDiff === 1) return 'next'
    return 'hidden'
  }

  return (
    <div className='w-full max-w-5xl mx-auto md:px-6'>
      <div className='relative overflow-hidden rounded-[2.5rem] lg:rounded-[3rem] flex flex-col lg:flex-row gap-0 min-h-[540px] lg:aspect-video border border-white/10'>

        {/* ── LEFT PANEL ── */}
        <div
          className='w-full lg:w-[40%] min-h-[300px] lg:h-full relative z-30 flex flex-col items-start justify-center overflow-hidden px-8 md:px-14 lg:pl-14'
          style={{ backgroundColor: '#62b2fe' }}
        >
          {/* top fade */}
          <div
            className='absolute inset-x-0 top-0 h-14 md:h-20 z-40 pointer-events-none'
            style={{ background: 'linear-gradient(to bottom, #62b2fe 0%, transparent 100%)' }}
          />
          {/* bottom fade */}
          <div
            className='absolute inset-x-0 bottom-0 h-14 md:h-20 z-40 pointer-events-none'
            style={{ background: 'linear-gradient(to top, #62b2fe 0%, transparent 100%)' }}
          />

          {/* scrolling items */}
          <div className='relative w-full h-full flex items-center justify-center lg:justify-start z-20'>
            {FEATURES.map((feature, index) => {
              const isActive = index === currentIndex
              const distance = index - currentIndex
              const wrappedDistance = wrap(-(FEATURES.length / 2), FEATURES.length / 2, distance)

              return (
                <motion.div
                  key={feature.id}
                  style={{ height: ITEM_HEIGHT, width: 'fit-content' }}
                  animate={{
                    y: wrappedDistance * ITEM_HEIGHT,
                    opacity: 1 - Math.abs(wrappedDistance) * 0.25,
                  }}
                  transition={{ type: 'spring', stiffness: 90, damping: 22, mass: 1 }}
                  className='absolute flex items-center justify-start'
                >
                  <button
                    onClick={() => handleChipClick(index)}
                    onMouseEnter={() => setIsPaused(true)}
                    onMouseLeave={() => setIsPaused(false)}
                    dir='rtl'
                    className={cn(
                      'relative flex items-center justify-center gap-3 min-w-[200px] md:min-w-[240px] lg:min-w-[260px] px-8 md:px-10 lg:px-12 py-4 md:py-5 rounded-full transition-all duration-700 text-right group border',
                      isActive
                        ? 'bg-white border-white z-10'
                        : 'bg-transparent text-white/60 border-white/20 hover:border-white/40 hover:text-white',
                    )}
                  >
                    <Icon
                      name={feature.iconName}
                      className={cn(
                        'size-[18px] shrink-0 transition-colors duration-500',
                        isActive ? 'bg-solid' : 'bg-white/50',
                      )}
                    />
                    <span
                      className={cn(
                        'text-base md:text-lg tracking-tight whitespace-nowrap uppercase font-medium',
                        isActive ? 'text-solid' : 'text-white/60',
                      )}
                    >
                      {feature.label}
                    </span>
                  </button>
                </motion.div>
              )
            })}
          </div>
        </div>

        {/* ── RIGHT PANEL ── */}
        <div
          className='flex-1 min-h-[460px] md:min-h-[540px] lg:h-full relative flex items-center justify-center py-14 md:py-20 lg:py-14 px-6 md:px-10 overflow-hidden'
          style={{ backgroundColor: '#0f0d1a' }}
        >
          <div className='relative w-full max-w-[300px] md:max-w-[340px] aspect-4/5 flex items-center justify-center'>
            {FEATURES.map((feature, index) => {
              const status = getCardStatus(index)
              const isActive = status === 'active'
              const isPrev = status === 'prev'
              const isNext = status === 'next'

              return (
                <motion.div
                  key={feature.id}
                  initial={false}
                  animate={{
                    x: isActive ? 0 : isPrev ? -100 : isNext ? 100 : 0,
                    scale: isActive ? 1 : isPrev || isNext ? 0.85 : 0.7,
                    opacity: isActive ? 1 : isPrev || isNext ? 0.4 : 0,
                    rotate: isPrev ? -3 : isNext ? 3 : 0,
                    zIndex: isActive ? 20 : isPrev || isNext ? 10 : 0,
                    pointerEvents: isActive ? 'auto' : 'none',
                  }}
                  transition={{ type: 'spring', stiffness: 260, damping: 25, mass: 0.8 }}
                  className='absolute inset-0 rounded-4xl md:rounded-[2.5rem] overflow-hidden border-4 md:border-8 origin-center'
                  style={{ borderColor: '#0f0d1a', backgroundColor: '#0f0d1a' }}
                >
                  <img
                    src={feature.image}
                    alt={feature.label}
                    className={cn(
                      'w-full h-full object-cover transition-all duration-700',
                      isActive ? 'grayscale-0' : 'grayscale blur-[2px] brightness-75',
                    )}
                  />

                  {/* Bottom overlay */}
                  <AnimatePresence>
                    {isActive && (
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className='absolute inset-x-0 bottom-0 p-8 pt-28 bg-linear-to-t from-black/90 via-black/40 to-transparent flex flex-col justify-end pointer-events-none'
                        dir='rtl'
                      >
                        <div className='bg-black/80 text-white px-3 py-1.5 rounded-full text-[11px] font-normal uppercase tracking-[0.2em] w-fit shadow-lg mb-3 border border-white/20'>
                          {index + 1} &bull; {feature.label}
                        </div>
                        <p className='text-white font-normal text-lg md:text-xl leading-tight drop-shadow-md tracking-tight'>
                          {feature.description}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export default FeatureCarousel
