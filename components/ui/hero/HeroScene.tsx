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
  className: string
  baseRot: number
  delay: number
  floatY: number
  reduce: boolean
}

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

export function HeroScene() {
  const reduce = useReducedMotion() ?? false

  return (
    <div className='relative mx-auto h-[330px] w-full max-w-[440px] sm:h-auto sm:aspect-square'>
      <SceneBackdrop />

      <FloatCard
        className='right-[-3%] top-[-8%] z-5 hidden sm:block'
        baseRot={-8}
        delay={0.1}
        floatY={9}
        reduce={reduce}
      >
        <PlatformIcon platform='whatsapp' size={72} />
      </FloatCard>
      <FloatCard
        className='left-[-6%] top-[12%] z-5 hidden sm:block'
        baseRot={7}
        delay={0.18}
        floatY={10}
        reduce={reduce}
      >
        <PlatformIcon platform='instagram' size={64} />
      </FloatCard>
      <FloatCard
        className='right-[-4%] top-[24%] z-5 hidden sm:block'
        baseRot={-5}
        delay={0.24}
        floatY={9}
        reduce={reduce}
      >
        <PlatformIcon platform='facebook' size={68} />
      </FloatCard>

      <FloatCard className='left-[2%] top-[8%] z-10 sm:hidden' baseRot={-8} delay={0.1} floatY={8} reduce={reduce}>
        <PlatformIcon platform='whatsapp' size={54} strong />
      </FloatCard>
      <FloatCard className='right-[2%] top-[8%] z-10 sm:hidden' baseRot={8} delay={0.16} floatY={9} reduce={reduce}>
        <PlatformIcon platform='facebook' size={52} strong />
      </FloatCard>
      <FloatCard className='left-[4%] top-[72%] z-10 sm:hidden' baseRot={6} delay={0.22} floatY={8} reduce={reduce}>
        <PlatformIcon platform='instagram' size={52} strong />
      </FloatCard>

      <FloatCard
        className='left-1/2 top-[6%] z-20 -translate-x-1/2 sm:left-auto sm:right-[3%] sm:top-[3%] sm:translate-x-0'
        baseRot={4}
        delay={0.14}
        floatY={5}
        reduce={reduce}
      >
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

      <FloatCard
        className='left-1/2 top-[23%] z-40 -translate-x-1/2 sm:top-[38%]'
        baseRot={0}
        delay={0}
        floatY={4}
        reduce={reduce}
      >
        <HubCard />
      </FloatCard>

      <FloatCard
        className='left-1/2 top-[50%] z-30 -translate-x-1/2 sm:left-[2%] sm:top-[60%] sm:translate-x-0'
        baseRot={-3}
        delay={0.36}
        floatY={6}
        reduce={reduce}
      >
        <ReminderCard />
      </FloatCard>

      <FloatCard
        className='left-1/2 top-[68%] z-50 -translate-x-1/2 sm:left-auto sm:top-auto sm:bottom-[16%] sm:right-[6%] sm:translate-x-0'
        baseRot={3}
        delay={0.44}
        floatY={5}
        reduce={reduce}
      >
        <DealWonCard />
      </FloatCard>
    </div>
  )
}
