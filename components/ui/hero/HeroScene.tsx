'use client'

import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { SceneBackdrop } from './scenes/SceneBackdrop'
import { NewLeadRow } from './scenes/NewLeadRow'
import { HubCard } from './scenes/HubCard'
import { ReminderCard } from './scenes/ReminderCard'
import { DealWonCard } from './scenes/DealWonCard'

interface FloatCardProps {
  children: ReactNode
  /** Absolute-position + z-index utilities placing the card in the cluster. */
  className: string
  /** Base tilt in degrees — depth cue, no arrows. */
  baseRot: number
  /** Reveal stagger delay (seconds). */
  delay: number
  /** Continuous float amplitude (px). Kept tiny so the cluster moves as one. */
  floatY: number
  reduce: boolean
}

// Outer motion.div: places + reveals the card (opacity/scale + base rotate).
// Inner motion.div: gentle continuous float (y only, so it never fights the
// base rotate). Disabled entirely under prefers-reduced-motion.
function FloatCard({ children, className, baseRot, delay, floatY, reduce }: FloatCardProps) {
  return (
    <motion.div
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

// The hero visual: a single-silhouette cluster of product cards. The cards
// overlap and share material/shadow so, zoomed out, they read as one object —
// HubCard is the focal point, DealWonCard the emphasized payoff. No arrows, no
// flow lines; depth (scale, z, rotation, overlap) carries the story.
export function HeroScene() {
  const reduce = useReducedMotion() ?? false

  return (
    <div className='relative mx-auto aspect-[4/5] w-full max-w-[440px] sm:aspect-square'>
      <SceneBackdrop />

      {/* Incoming channel leads — fanned across the top, overlapping. The two
          trailing ones drop on small screens so the cluster stays legible. */}
      <FloatCard className='right-[2%] top-[1%] z-20' baseRot={4} delay={0.12} floatY={5} reduce={reduce}>
        <NewLeadRow channel='whatsapp' name='דני לוי' message='היי, מעוניין בפרטים' />
      </FloatCard>
      <FloatCard
        className='left-[1%] top-[14%] z-30 hidden sm:block'
        baseRot={-4}
        delay={0.2}
        floatY={6}
        reduce={reduce}
      >
        <NewLeadRow channel='instagram' name='מיכל אברהם' message='כמה זה עולה?' />
      </FloatCard>
      <FloatCard
        className='right-[6%] top-[26%] z-20 hidden sm:block'
        baseRot={3}
        delay={0.28}
        floatY={5}
        reduce={reduce}
      >
        <NewLeadRow channel='facebook' name='שרה פרץ' message='טופס ליד חדש' />
      </FloatCard>

      {/* Focal point — largest, centered, sits over the channel cards' lower edges */}
      <FloatCard
        className='left-1/2 top-[40%] z-40 -translate-x-1/2'
        baseRot={0}
        delay={0}
        floatY={4}
        reduce={reduce}
      >
        <HubCard />
      </FloatCard>

      {/* Held follow-up */}
      <FloatCard className='left-[2%] top-[64%] z-30' baseRot={-3} delay={0.34} floatY={6} reduce={reduce}>
        <ReminderCard />
      </FloatCard>

      {/* Payoff — forward, highest elevation, brightest note in the cluster */}
      <FloatCard className='bottom-[2%] right-[4%] z-50' baseRot={3} delay={0.42} floatY={5} reduce={reduce}>
        <DealWonCard />
      </FloatCard>
    </div>
  )
}
