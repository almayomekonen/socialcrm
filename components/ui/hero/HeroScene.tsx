'use client'

import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { SceneBackdrop } from './scenes/SceneBackdrop'
import { NewLeadRow } from './scenes/NewLeadRow'
import { ScreenshotCard } from './scenes/ScreenshotCard'
import { DealWonCard } from './scenes/DealWonCard'

const DASHBOARD_SRC = '/media/social-icons/one1.png'
const LEADS_SRC = '/media/social-icons/two.png'

interface FloatCardProps {
  children: ReactNode
  className: string
  baseRot: number
  delay: number
  floatY: number
  reduce: boolean
  /** Decorative cards (notification popups) are hidden from screen readers. */
  decorative?: boolean
}

function FloatCard({ children, className, baseRot, delay, floatY, reduce, decorative }: FloatCardProps) {
  return (
    <motion.div
      aria-hidden={decorative || undefined}
      className={`absolute ${className}`}
      style={{ rotate: baseRot }}
      initial={reduce ? false : { opacity: 0, scale: 0.9 }}
      whileInView={reduce ? undefined : { opacity: 1, scale: 1 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ delay, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.div
        animate={reduce ? undefined : { y: [0, -floatY, 0] }}
        transition={
          reduce
            ? undefined
            : { duration: 4.5 + floatY * 0.2, delay, repeat: Infinity, ease: 'easeInOut' }
        }
      >
        {children}
      </motion.div>
    </motion.div>
  )
}

export function HeroScene() {
  const reduce = useReducedMotion() ?? false

  return (
    <div className='relative mx-auto h-[360px] w-full max-w-[460px] sm:h-auto sm:aspect-square sm:max-w-[560px]'>
      <SceneBackdrop />

      {/* Secondary screenshot (leads table) — clearly visible behind the dashboard for depth */}
      <FloatCard
        className='left-[-7%] top-[4%] z-20 hidden sm:block'
        baseRot={7}
        delay={0.12}
        floatY={6}
        reduce={reduce}
      >
        <ScreenshotCard src={LEADS_SRC} alt='רשימת הלידים ב-SocialCRM' className='w-[340px]' />
      </FloatCard>

      {/* Focal screenshot (performance dashboard) — shifted right to fill the gap toward the headline */}
      <FloatCard
        className='left-1/2 top-[22%] z-30 -translate-x-1/2 sm:left-[54%] sm:top-[27%]'
        baseRot={-3}
        delay={0}
        floatY={4}
        reduce={reduce}
      >
        <ScreenshotCard
          src={DASHBOARD_SRC}
          alt='לוח הביצועים של SocialCRM'
          className='w-[310px] sm:w-[500px]'
          priority
        />
      </FloatCard>

      {/* Notification popups — decorative, curated so the screenshots stay the star */}
      <FloatCard
        className='left-1/2 top-[4%] z-50 -translate-x-1/2 sm:left-auto sm:right-[-3%] sm:top-[12%] sm:translate-x-0'
        baseRot={4}
        delay={0.34}
        floatY={5}
        reduce={reduce}
        decorative
      >
        <NewLeadRow channel='whatsapp' name='דני לוי' message='היי, מעוניין בפרטים' />
      </FloatCard>
      <FloatCard
        className='left-[-7%] top-[50%] z-50 hidden sm:block'
        baseRot={-4}
        delay={0.4}
        floatY={6}
        reduce={reduce}
        decorative
      >
        <NewLeadRow channel='instagram' name='מיכל אברהם' message='כמה זה עולה?' />
      </FloatCard>

      <FloatCard
        className='left-1/2 bottom-[2%] z-50 -translate-x-1/2 sm:left-[4%] sm:bottom-[6%] sm:translate-x-0'
        baseRot={3}
        delay={0.46}
        floatY={5}
        reduce={reduce}
        decorative
      >
        <DealWonCard />
      </FloatCard>
    </div>
  )
}
