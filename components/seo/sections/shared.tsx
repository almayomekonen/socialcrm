'use client'

import { motion } from 'motion/react'

export function FadeIn({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function SectionHeader({ badge, title, subtitle }: { badge?: string; title: string; subtitle?: string }) {
  return (
    <div className='text-center mb-16'>
      {badge && (
        <span className='inline-block px-3 py-1 rounded-full text-xs font-semibold mb-4 text-white' style={{ backgroundColor: '#3f20f5' }}>
          {badge}
        </span>
      )}
      <h2 className='text-3xl md:text-4xl font-bold mb-4' style={{ color: '#171424' }}>{title}</h2>
      {subtitle && <p className='text-gray-500 text-lg max-w-xl mx-auto'>{subtitle}</p>}
    </div>
  )
}
