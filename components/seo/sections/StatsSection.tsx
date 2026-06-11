'use client'

import { motion, LayoutGroup } from 'motion/react'
import { TextRotate } from '@/components/ui/text-rotate'

export function StatsSection() {
  return (
    <section className='py-24 px-8 bg-white overflow-hidden'>
      <div className='max-w-5xl mx-auto flex flex-col items-center justify-center text-center'>
        <LayoutGroup>
          <motion.div
            className='flex flex-wrap items-center justify-center gap-x-4 text-4xl sm:text-5xl md:text-6xl font-black text-gray-900 leading-tight'
            layout
            dir='rtl'
          >
            <motion.span layout transition={{ type: 'spring', damping: 30, stiffness: 400 }}>
              ניהול לידים שהוא
            </motion.span>
            <TextRotate
              texts={['מהיר', 'פשוט', 'חכם', 'יעיל', 'מדויק', 'נכון']}
              mainClassName='text-white px-4 py-1 rounded-xl overflow-hidden justify-center bg-[#3f20f5]'
              staggerFrom='last'
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '-120%' }}
              staggerDuration={0.03}
              splitLevelClassName='overflow-hidden pb-1'
              transition={{ type: 'spring', damping: 30, stiffness: 400 }}
              rotationInterval={2000}
            />
          </motion.div>
        </LayoutGroup>
      </div>
    </section>
  )
}
