'use client'

import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { SceneBackdrop } from './scenes/SceneBackdrop'
import { PlatformIcon } from './scenes/PlatformIcon'
import { NewLeadRow } from './scenes/NewLeadRow'
import { HubCard } from './scenes/HubCard'
import { ReminderCard } from './scenes/ReminderCard'
import { DealWonCard } from './scenes/DealWonCard'

interface FloatCardProps {
  children: ReactNode
  /** Absolute-position + z-index utilities placing the item in the cluster. */
  className: string
  /** Base tilt in degrees — depth cue, no arrows. */
  baseRot: number
  /** Reveal stagger delay (seconds). */
  delay: number
  /** Continuous float amplitude (px). Kept small so the cluster moves as one. */
  floatY: number
  reduce: boolean
}

// Outer motion.div: places + reveals the item (opacity/scale + base rotate).
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

// The hero visual: a single-silhouette cluster of product cards, with large,
// low-weight platform glyphs floating around it like the sources the leads come
// from. The cards overlap tightly and share material/shadow so, zoomed out, they
// read as one object — HubCard is the focal point, DealWonCard the emphasized
// payoff. No arrows, no flow lines; depth (scale, z, rotation, overlap) carries
// the story.
export function HeroScene() {
  const reduce = useReducedMotion() ?? false

  return (
    <div className='relative mx-auto aspect-[4/5] w-full max-w-[440px] sm:aspect-square'>
      <SceneBackdrop />

      {/* Ambient platform sources — float behind the cards (z-[5]), near the lead
          card they feed. Low opacity, large, never attached to a card. The two
          trailing ones drop on small screens alongside their cards. */}
      <FloatCard className='right-[4%] top-[-3%] z-[5]' baseRot={-8} delay={0.1} floatY={10} reduce={reduce}>
        <PlatformIcon platform='whatsapp' size={92} />
      </FloatCard>
      <FloatCard
        className='left-[-5%] top-[30%] z-[5] hidden sm:block'
        baseRot={7}
        delay={0.18}
        floatY={11}
        reduce={reduce}
      >
        <PlatformIcon platform='instagram' size={84} />
      </FloatCard>
      <FloatCard
        className='bottom-[18%] right-[-5%] z-[5] hidden sm:block'
        baseRot={-5}
        delay={0.24}
        floatY={9}
        reduce={reduce}
      >
        <PlatformIcon platform='facebook' size={88} />
      </FloatCard>

      {/* Incoming channel leads — fanned across the top, tightly overlapping. The
          two trailing ones drop on small screens so the cluster stays legible. */}
      <FloatCard className='right-[3%] top-[3%] z-20' baseRot={4} delay={0.14} floatY={5} reduce={reduce}>
        <NewLeadRow channel='whatsapp' name='דני לוי' message='היי, מעוניין בפרטים' />
      </FloatCard>
      <FloatCard
        className='left-[0%] top-[15%] z-30 hidden sm:block'
        baseRot={-4}
        delay={0.22}
        floatY={6}
        reduce={reduce}
      >
        <NewLeadRow channel='instagram' name='מיכל אברהם' message='כמה זה עולה?' />
      </FloatCard>
      <FloatCard
        className='right-[6%] top-[27%] z-20 hidden sm:block'
        baseRot={3}
        delay={0.3}
        floatY={5}
        reduce={reduce}
      >
        <NewLeadRow channel='facebook' name='שרה פרץ' message='טופס ליד חדש' />
      </FloatCard>

      {/* Focal point — largest, centered, sits over the channel cards' lower edges */}
      <FloatCard
        className='left-1/2 top-[38%] z-40 -translate-x-1/2'
        baseRot={0}
        delay={0}
        floatY={4}
        reduce={reduce}
      >
        <HubCard />
      </FloatCard>

      {/* Held follow-up — overlaps the hub's lower-left */}
      <FloatCard className='left-[2%] top-[60%] z-30' baseRot={-3} delay={0.36} floatY={6} reduce={reduce}>
        <ReminderCard />
      </FloatCard>

      {/* Payoff — forward, highest elevation, the outcome of the story */}
      <FloatCard className='bottom-[2%] right-[3%] z-50' baseRot={3} delay={0.44} floatY={5} reduce={reduce}>
        <DealWonCard />
      </FloatCard>
    </div>
  )
}
